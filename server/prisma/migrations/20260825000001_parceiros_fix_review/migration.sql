-- Ajustes da revisão do módulo de Parceiros Comerciais (aditivo, sem DROP).
-- 1) Participantes das reuniões (req 27)
ALTER TABLE "consultor_reunioes" ADD COLUMN "participantes" JSONB;

-- 2) Limiar de queda de score p/ alerta por tendência (req 26)
ALTER TABLE "parceiro_configs" ADD COLUMN "quedaLimiarPontos" INTEGER NOT NULL DEFAULT 15;

-- 3) Trilha de alterações sensíveis do consultor (% base de comissão) — req 30
CREATE TABLE "consultor_auditorias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "detalhe" TEXT,
    "valorAntigo" TEXT,
    "valorNovo" TEXT,
    "autorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultor_auditorias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consultor_auditorias_tenantId_consultorId_idx" ON "consultor_auditorias"("tenantId", "consultorId");

ALTER TABLE "consultor_auditorias" ADD CONSTRAINT "consultor_auditorias_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
