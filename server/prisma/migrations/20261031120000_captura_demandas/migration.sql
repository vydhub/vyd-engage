-- Captura de Demandas K2+ (spec captura-demandas, filha 02).
--
-- Só acrescenta: tipos, tabelas e duas colunas novas ("Tenant"."capturaCalendario", com
-- valor padrão, e "FunnelColumn"."capturaEstado", anulável). Nada do site ou do serviço
-- antigos lê ou depende destes objetos.
--
-- lock_timeout: o ADD COLUMN e as FKs pegam travas curtas em tabelas movimentadas. Com
-- query longa concorrente, falha rápido e com rollback limpo em vez de congelar o tráfego.
DO $$ BEGIN EXECUTE 'SET LOCAL lock_timeout = ''5s'''; END $$;

-- CreateEnum
CREATE TYPE "ContratoTipo" AS ENUM ('LTA', 'GUARDA_CHUVA');

-- CreateEnum
CREATE TYPE "ContratoMovimentoTipo" AS ENUM ('ADITIVO', 'AJUSTE', 'CONSUMO');

-- CreateEnum
CREATE TYPE "DemandaCenario" AS ENUM ('contrato_novo', 'chamado_lta');

-- CreateEnum
CREATE TYPE "DemandaEstado" AS ENUM ('recebida', 'em_triagem', 'em_orcamento', 'orcamento_enviado', 'ganha', 'perdida', 'declinada', 'cancelada', 'descartada');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "capturaCalendario" JSONB NOT NULL DEFAULT '{"diasUteis":[1,2,3,4,5],"inicio":"08:00","fim":"18:00","fuso":"America/Sao_Paulo","excluirFeriadosNacionais":true,"feriadosExtras":[]}';

-- AlterTable
ALTER TABLE "FunnelColumn" ADD COLUMN     "capturaEstado" "DemandaEstado";

-- CreateTable
CREATE TABLE "Contrato" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "numeroCliente" TEXT,
    "tipo" "ContratoTipo" NOT NULL DEFAULT 'LTA',
    "objeto" TEXT,
    "escopo" TEXT,
    "vigenciaInicio" DATE,
    "vigenciaFim" DATE,
    "valorContratado" DECIMAL(14,2),
    "slaRespostaHoras" INTEGER,
    "gerenteNome" TEXT,
    "gerenteEmail" TEXT,
    "planejadorNome" TEXT,
    "planejadorEmail" TEXT,
    "flowRecordId" TEXT,
    "espelhoRecusadoNaVersao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoSolicitante" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "nome" TEXT,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoSolicitante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoItem" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "disciplina" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoMovimento" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "tipo" "ContratoMovimentoTipo" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "motivo" TEXT,
    "autorId" TEXT,
    "dealId" TEXT,
    "demandaEventoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContratoMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demanda" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "chaveDedup" TEXT NOT NULL,
    "idCaptura" TEXT NOT NULL,
    "flowCardId" TEXT,
    "cenario" "DemandaCenario" NOT NULL,
    "fonte" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "recebidoEmOrigem" TIMESTAMP(3) NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL,
    "triagemEm" TIMESTAMP(3),
    "orcamentoEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "valorEstimado" DECIMAL(12,2),
    "valorEnviado" DECIMAL(14,2),
    "aprovadoEm" TIMESTAMP(3),
    "valorAprovado" DECIMAL(14,2),
    "encerradoEm" TIMESTAMP(3),
    "estado" "DemandaEstado" NOT NULL DEFAULT 'recebida',
    "motivo" TEXT,
    "contratoId" TEXT,
    "linkOriginal" TEXT,
    "ultimoEventoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandaEvento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "estado" "DemandaEstado" NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "flowCardId" TEXT,
    "valorEnviado" DECIMAL(14,2),
    "valorAprovado" DECIMAL(14,2),
    "motivo" TEXT,
    "autorEmail" TEXT,
    "aplicado" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandaEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_flowRecordId_key" ON "Contrato"("flowRecordId");

-- CreateIndex
CREATE INDEX "Contrato_tenantId_idx" ON "Contrato"("tenantId");

-- CreateIndex
CREATE INDEX "Contrato_tenantId_companyId_idx" ON "Contrato"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "Contrato_tenantId_updatedAt_idx" ON "Contrato"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contrato_tenantId_vigenciaFim_idx" ON "Contrato"("tenantId", "vigenciaFim");

-- CreateIndex
CREATE INDEX "Contrato_tenantId_deletedAt_idx" ON "Contrato"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_tenantId_numero_key" ON "Contrato"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "ContratoSolicitante_email_idx" ON "ContratoSolicitante"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ContratoSolicitante_contratoId_email_key" ON "ContratoSolicitante"("contratoId", "email");

-- CreateIndex
CREATE INDEX "ContratoItem_contratoId_idx" ON "ContratoItem"("contratoId");

-- CreateIndex
CREATE INDEX "ContratoMovimento_contratoId_idx" ON "ContratoMovimento"("contratoId");

-- CreateIndex
CREATE INDEX "ContratoMovimento_contratoId_tipo_idx" ON "ContratoMovimento"("contratoId", "tipo");

-- CreateIndex
CREATE INDEX "ContratoMovimento_dealId_idx" ON "ContratoMovimento"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Demanda_dealId_key" ON "Demanda"("dealId");

-- CreateIndex
CREATE INDEX "Demanda_tenantId_idx" ON "Demanda"("tenantId");

-- CreateIndex
CREATE INDEX "Demanda_tenantId_estado_idx" ON "Demanda"("tenantId", "estado");

-- CreateIndex
CREATE INDEX "Demanda_tenantId_cenario_idx" ON "Demanda"("tenantId", "cenario");

-- CreateIndex
CREATE INDEX "Demanda_tenantId_contratoId_idx" ON "Demanda"("tenantId", "contratoId");

-- CreateIndex
CREATE INDEX "Demanda_tenantId_recebidoEmOrigem_idx" ON "Demanda"("tenantId", "recebidoEmOrigem");

-- CreateIndex
CREATE INDEX "Demanda_flowCardId_idx" ON "Demanda"("flowCardId");

-- CreateIndex
CREATE UNIQUE INDEX "Demanda_tenantId_chaveDedup_key" ON "Demanda"("tenantId", "chaveDedup");

-- CreateIndex
CREATE INDEX "DemandaEvento_demandaId_idx" ON "DemandaEvento"("demandaId");

-- CreateIndex
CREATE INDEX "DemandaEvento_demandaId_ocorridoEm_idx" ON "DemandaEvento"("demandaId", "ocorridoEm");

-- CreateIndex
CREATE UNIQUE INDEX "DemandaEvento_tenantId_eventoId_key" ON "DemandaEvento"("tenantId", "eventoId");

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoSolicitante" ADD CONSTRAINT "ContratoSolicitante_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoItem" ADD CONSTRAINT "ContratoItem_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoMovimento" ADD CONSTRAINT "ContratoMovimento_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoMovimento" ADD CONSTRAINT "ContratoMovimento_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoMovimento" ADD CONSTRAINT "ContratoMovimento_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoMovimento" ADD CONSTRAINT "ContratoMovimento_demandaEventoId_fkey" FOREIGN KEY ("demandaEventoId") REFERENCES "DemandaEvento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaEvento" ADD CONSTRAINT "DemandaEvento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaEvento" ADD CONSTRAINT "DemandaEvento_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cobertura de RLS para as tabelas novas com "tenantId" (Contrato, Demanda, DemandaEvento).
-- Mesmo bloco dinâmico e idempotente de 20260825000002_parceiros_rls: é o remédio previsto
-- lá para tabelas criadas depois, porque a varredura só alcança o que já existe quando roda.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables pt
      ON pt.schemaname = 'public' AND pt.tablename = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class pc
      WHERE pc.relname = t.table_name
        AND pc.relnamespace = 'public'::regnamespace
        AND pc.relrowsecurity
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
        'tenant_isolation_' || lower(t.table_name),
        t.table_name
      );
    END IF;
  END LOOP;
END $$;
