-- Leads como Oportunidade (specs/leads-oportunidade-inteligencia-mercado.md)
-- Migração idempotente e aditiva sobre dados:
--   1. novos enums (LeadStatusReason, MeetingModality, CallReason) e valores de TaskType;
--   2. substituição de LeadStatus (5 valores) e LeadSource (7 valores) com
--      remapeamento dos dados existentes (Lead.status/source e FunnelColumn.mappedStatus);
--   3. campos de oportunidade no Lead (contactId, statusReason, valores estimados);
--   4. campos estruturados de atividade na Interaction + tabela interaction_participants;
--   5. vínculos leadId/interactionId em attachments;
--   6. backfill de statusReason para leads migrados a estados terminais.

-- 1) Enums novos ------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "LeadStatusReason" AS ENUM (
    'CONVERTIDO_EM_OPORTUNIDADE','PAUSADO_PELO_CLIENTE','PROJETO_SUSPENSO',
    'SEM_ADERENCIA_TECNICA','CONCORRENTE_ESCOLHIDO','PRECO','PRAZO',
    'DECISAO_INTERNA_CLIENTE','SEM_RETORNO','OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MeetingModality" AS ENUM ('PRESENCIAL','ONLINE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CallReason" AS ENUM (
    'PRIMEIRO_CONTATO','SOLICITACAO_INFORMACOES','FOLLOW_UP','SUPORTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TaskType: valores novos (PG12+ aceita ADD VALUE em transação; não são usados
-- nesta própria migração)
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'PREPARACAO_DOCUMENTO';
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'VISITA_TECNICA';

-- 2) Colunas novas no Lead --------------------------------------------------

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "statusReason" "LeadStatusReason";
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "statusReasonNote" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "estimatedValue" DECIMAL(12,2);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "estimatedTimeline" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "probabilityGoGet" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Lead"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Lead_contactId_idx" ON "Lead"("contactId");

-- 3) LeadStatus: substituição com remapeamento ------------------------------
-- Guardada por checagem de valor para ser idempotente (runbook P3009).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LeadStatus' AND e.enumlabel = 'NOVO'
  ) THEN
    CREATE TYPE "LeadStatus_new" AS ENUM (
      'NOVO','EM_ANDAMENTO','PAUSADO','CANCELADO','ENCERRADO');

    ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus_new"
      USING (CASE "status"::text
        WHEN 'NEW'         THEN 'NOVO'
        WHEN 'CONTACTED'   THEN 'EM_ANDAMENTO'
        WHEN 'QUALIFIED'   THEN 'EM_ANDAMENTO'
        WHEN 'PROPOSAL'    THEN 'EM_ANDAMENTO'
        WHEN 'NEGOTIATION' THEN 'EM_ANDAMENTO'
        WHEN 'WON'         THEN 'ENCERRADO'
        WHEN 'LOST'        THEN 'CANCELADO'
        ELSE 'NOVO' END)::"LeadStatus_new";

    ALTER TABLE "FunnelColumn" ALTER COLUMN "mappedStatus" TYPE "LeadStatus_new"
      USING (CASE "mappedStatus"::text
        WHEN 'NEW'         THEN 'NOVO'
        WHEN 'CONTACTED'   THEN 'EM_ANDAMENTO'
        WHEN 'QUALIFIED'   THEN 'EM_ANDAMENTO'
        WHEN 'PROPOSAL'    THEN 'EM_ANDAMENTO'
        WHEN 'NEGOTIATION' THEN 'EM_ANDAMENTO'
        WHEN 'WON'         THEN 'ENCERRADO'
        WHEN 'LOST'        THEN 'CANCELADO'
        ELSE NULL END)::"LeadStatus_new";

    DROP TYPE "LeadStatus";
    ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";
    ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'NOVO';
  END IF;
END $$;

-- 4) LeadSource: substituição com remapeamento ------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LeadSource' AND e.enumlabel = 'OUTROS'
  ) THEN
    CREATE TYPE "LeadSource_new" AS ENUM (
      'PROSPECCAO_ATIVA','PORTAL_NOTICIAS_LINKEDIN','EVENTO_FEIRA_SETORIAL',
      'NETWORKING_PESSOAL','CLIENTE_RECORRENTE','INDICACAO_PARCEIROS','OUTROS');

    ALTER TABLE "Lead" ALTER COLUMN "source" DROP DEFAULT;
    ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource_new"
      USING (CASE "source"::text
        WHEN 'WEBSITE'      THEN 'OUTROS'
        WHEN 'SOCIAL_MEDIA' THEN 'PORTAL_NOTICIAS_LINKEDIN'
        WHEN 'REFERRAL'     THEN 'INDICACAO_PARCEIROS'
        WHEN 'EMAIL'        THEN 'PROSPECCAO_ATIVA'
        WHEN 'PHONE'        THEN 'PROSPECCAO_ATIVA'
        WHEN 'OTHER'        THEN 'OUTROS'
        ELSE 'OUTROS' END)::"LeadSource_new";

    DROP TYPE "LeadSource";
    ALTER TYPE "LeadSource_new" RENAME TO "LeadSource";
    ALTER TABLE "Lead" ALTER COLUMN "source" SET DEFAULT 'OUTROS';
  END IF;
END $$;

-- 5) Interaction: campos estruturados de atividade ---------------------------

ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "modality" "MeetingModality";
ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "callReason" "CallReason";
ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3);

-- 6) Participantes de atividade ----------------------------------------------

CREATE TABLE IF NOT EXISTS "interaction_participants" (
  "id"            TEXT NOT NULL,
  "interactionId" TEXT NOT NULL,
  "leadId"        TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interaction_participants_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "interaction_participants"
    ADD CONSTRAINT "interaction_participants_interactionId_fkey"
    FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interaction_participants"
    ADD CONSTRAINT "interaction_participants_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "interaction_participants_interactionId_leadId_key"
  ON "interaction_participants"("interactionId","leadId");
CREATE INDEX IF NOT EXISTS "interaction_participants_interactionId_idx"
  ON "interaction_participants"("interactionId");
CREATE INDEX IF NOT EXISTS "interaction_participants_leadId_idx"
  ON "interaction_participants"("leadId");

-- 7) Anexos: vínculo a lead/atividade ----------------------------------------

ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "leadId" TEXT;
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "interactionId" TEXT;
CREATE INDEX IF NOT EXISTS "attachments_tenantId_leadId_idx"
  ON "attachments"("tenantId","leadId");
CREATE INDEX IF NOT EXISTS "attachments_tenantId_interactionId_idx"
  ON "attachments"("tenantId","interactionId");

-- 8) Backfill: motivo dos leads migrados a estados terminais ------------------

UPDATE "Lead"
SET "statusReason" = 'OUTRO',
    "statusReasonNote" = 'migração de status legado'
WHERE "status"::text IN ('PAUSADO','CANCELADO','ENCERRADO')
  AND "statusReason" IS NULL;
