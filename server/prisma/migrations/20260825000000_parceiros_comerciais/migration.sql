-- CreateEnum
CREATE TYPE "ConsultorStatus" AS ENUM ('ATIVO', 'SUSPENSO', 'INATIVO');

-- CreateEnum
CREATE TYPE "NdaStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'ASSINADO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "RegistroStatus" AS ENUM ('SUBMETIDO', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'EXPIRADO', 'GANHO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "ExtensaoStatus" AS ENUM ('PENDENTE', 'APROVADA', 'NEGADA');

-- CreateEnum
CREATE TYPE "ConflitoTipo" AS ENUM ('EXTERNO_EXTERNO', 'EXTERNO_INTERNO');

-- CreateEnum
CREATE TYPE "ConflitoStatus" AS ENUM ('ABERTO', 'RESOLVIDO');

-- CreateEnum
CREATE TYPE "ConflitoDecisao" AS ENUM ('MANTER', 'REJEITAR', 'INDEPENDENTE');

-- CreateEnum
CREATE TYPE "MatchForca" AS ENUM ('FORTE', 'FRACO');

-- CreateEnum
CREATE TYPE "PlanoAcaoStatus" AS ENUM ('PENDENTE', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PapelAtribuicao" AS ENUM ('ORIGINADOR', 'DESENVOLVEDOR');

-- CreateEnum
CREATE TYPE "ComissaoStatus" AS ENUM ('A_PAGAR', 'PAGA');

-- CreateEnum
CREATE TYPE "ReuniaoStatus" AS ENUM ('AGENDADA', 'REALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PresencaStatus" AS ENUM ('PRESENTE', 'FALTOU');

-- CreateEnum
CREATE TYPE "ScoreFaixa" AS ENUM ('SAUDAVEL', 'ATENCAO', 'ESFRIANDO', 'FRIO');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CONSULTOR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_REGISTRO_SUBMETIDO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_REGISTRO_DECIDIDO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_UPDATE_PENDENTE';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_EXPIRACAO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_CONFLITO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_SCORE';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_REUNIAO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_COMISSAO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_EXTENSAO';
ALTER TYPE "NotificationType" ADD VALUE 'PARCEIRO_ACAO_VENCIDA';

-- CreateTable
CREATE TABLE "consultores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "telefoneDigits" TEXT,
    "cpfCnpj" TEXT,
    "empresa" TEXT,
    "nivel" TEXT,
    "comissaoBase" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" "ConsultorStatus" NOT NULL DEFAULT 'ATIVO',
    "inicioParceria" TIMESTAMP(3),
    "ndaStatus" "NdaStatus" NOT NULL DEFAULT 'PENDENTE',
    "ndaEnvelopeId" TEXT,
    "ndaAttachmentId" TEXT,
    "cadenciaReuniaoDias" INTEGER,
    "score" DOUBLE PRECISION,
    "scoreFaixa" "ScoreFaixa",
    "ultimaAtividadeEm" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_oportunidades" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "clienteNome" TEXT NOT NULL,
    "clienteCnpj" TEXT,
    "clienteCnpjDigits" TEXT,
    "clienteContato" TEXT,
    "descricao" TEXT NOT NULL,
    "valorEstimado" DECIMAL(14,2),
    "observacoes" TEXT,
    "status" "RegistroStatus" NOT NULL DEFAULT 'SUBMETIDO',
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "motivoDecisao" TEXT,
    "protecaoDias" INTEGER,
    "protecaoFim" TIMESTAMP(3),
    "avisoExpiracaoEnviadoEm" TIMESTAMP(3),
    "updateCadenciaDias" INTEGER,
    "proximoUpdateEm" TIMESTAMP(3),
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dealId" TEXT,
    "valorContrato" DECIMAL(14,2),
    "ganhoEm" TIMESTAMP(3),
    "splitOriginador" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registro_oportunidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_updates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "autorId" TEXT,
    "texto" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_extensoes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL,
    "diasSolicitados" INTEGER,
    "status" "ExtensaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "motivoDecisao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_extensoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "detalhe" TEXT,
    "autorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflito_candidatos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "tipo" "ConflitoTipo" NOT NULL,
    "alvoRegistroId" TEXT,
    "alvoDealId" TEXT,
    "alvoCompanyId" TEXT,
    "matchForca" "MatchForca" NOT NULL,
    "matchChave" TEXT NOT NULL,
    "status" "ConflitoStatus" NOT NULL DEFAULT 'ABERTO',
    "decisao" "ConflitoDecisao",
    "rationale" TEXT,
    "resolvidoPorId" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflito_candidatos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_acao_itens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "responsavelConsultor" BOOLEAN NOT NULL DEFAULT true,
    "responsavelUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "PlanoAcaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "concluidaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plano_acao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_atribuicoes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "papel" "PapelAtribuicao" NOT NULL,
    "percentualOverride" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_atribuicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parceiro_recebimentos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "referencia" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parceiro_recebimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comissao_parcelas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "papel" "PapelAtribuicao" NOT NULL,
    "percentualAplicado" DECIMAL(5,2) NOT NULL,
    "fracaoPapel" INTEGER NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "status" "ComissaoStatus" NOT NULL DEFAULT 'A_PAGAR',
    "marcadaPagaPorId" TEXT,
    "marcadaPagaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comissao_parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultor_reunioes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL,
    "pauta" TEXT,
    "status" "ReuniaoStatus" NOT NULL DEFAULT 'AGENDADA',
    "presenca" "PresencaStatus",
    "observacoes" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultor_reunioes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultor_metas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "alvoRegistros" INTEGER NOT NULL DEFAULT 0,
    "alvoPipeline" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "alvoGanho" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultor_metas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultor_documentos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultor_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultor_score_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL,
    "faixa" "ScoreFaixa" NOT NULL,
    "sinais" JSONB,

    CONSTRAINT "consultor_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parceiro_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "protecaoDiasPadrao" INTEGER NOT NULL DEFAULT 90,
    "updateCadenciaDias" INTEGER NOT NULL DEFAULT 30,
    "avisoExpiracaoDias" INTEGER NOT NULL DEFAULT 7,
    "splitOriginadorPadrao" INTEGER NOT NULL DEFAULT 60,
    "reuniaoCadenciaDias" INTEGER NOT NULL DEFAULT 30,
    "scorePesos" JSONB NOT NULL DEFAULT '{"novasOportunidades":25,"updatesCumpridos":25,"presencaReunioes":25,"progressaoPipeline":25}',
    "scoreLimiares" JSONB NOT NULL DEFAULT '{"saudavel":75,"atencao":50,"esfriando":25}',
    "decaimentoPontosPorDia" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "decaimentoMaxPontos" INTEGER NOT NULL DEFAULT 30,
    "conflitoInternoUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parceiro_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultores_userId_key" ON "consultores"("userId");

-- CreateIndex
CREATE INDEX "consultores_tenantId_idx" ON "consultores"("tenantId");

-- CreateIndex
CREATE INDEX "consultores_tenantId_status_idx" ON "consultores"("tenantId", "status");

-- CreateIndex
CREATE INDEX "consultores_tenantId_telefoneDigits_idx" ON "consultores"("tenantId", "telefoneDigits");

-- CreateIndex
CREATE INDEX "consultores_ndaEnvelopeId_idx" ON "consultores"("ndaEnvelopeId");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_idx" ON "registro_oportunidades"("tenantId");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_consultorId_idx" ON "registro_oportunidades"("tenantId", "consultorId");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_status_idx" ON "registro_oportunidades"("tenantId", "status");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_clienteCnpjDigits_idx" ON "registro_oportunidades"("tenantId", "clienteCnpjDigits");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_protecaoFim_idx" ON "registro_oportunidades"("tenantId", "protecaoFim");

-- CreateIndex
CREATE INDEX "registro_oportunidades_tenantId_dealId_idx" ON "registro_oportunidades"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "registro_updates_tenantId_registroId_idx" ON "registro_updates"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "registro_extensoes_tenantId_registroId_idx" ON "registro_extensoes"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "registro_extensoes_tenantId_status_idx" ON "registro_extensoes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "registro_auditoria_tenantId_registroId_idx" ON "registro_auditoria"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "conflito_candidatos_tenantId_status_idx" ON "conflito_candidatos"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conflito_candidatos_tenantId_registroId_idx" ON "conflito_candidatos"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "plano_acao_itens_tenantId_registroId_idx" ON "plano_acao_itens"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "plano_acao_itens_tenantId_status_dueDate_idx" ON "plano_acao_itens"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "registro_atribuicoes_tenantId_consultorId_idx" ON "registro_atribuicoes"("tenantId", "consultorId");

-- CreateIndex
CREATE UNIQUE INDEX "registro_atribuicoes_registroId_consultorId_papel_key" ON "registro_atribuicoes"("registroId", "consultorId", "papel");

-- CreateIndex
CREATE INDEX "parceiro_recebimentos_tenantId_registroId_idx" ON "parceiro_recebimentos"("tenantId", "registroId");

-- CreateIndex
CREATE INDEX "comissao_parcelas_tenantId_consultorId_idx" ON "comissao_parcelas"("tenantId", "consultorId");

-- CreateIndex
CREATE INDEX "comissao_parcelas_tenantId_status_idx" ON "comissao_parcelas"("tenantId", "status");

-- CreateIndex
CREATE INDEX "consultor_reunioes_tenantId_consultorId_idx" ON "consultor_reunioes"("tenantId", "consultorId");

-- CreateIndex
CREATE INDEX "consultor_reunioes_tenantId_status_dataHora_idx" ON "consultor_reunioes"("tenantId", "status", "dataHora");

-- CreateIndex
CREATE INDEX "consultor_metas_tenantId_consultorId_idx" ON "consultor_metas"("tenantId", "consultorId");

-- CreateIndex
CREATE UNIQUE INDEX "consultor_metas_tenantId_consultorId_month_year_key" ON "consultor_metas"("tenantId", "consultorId", "month", "year");

-- CreateIndex
CREATE INDEX "consultor_documentos_tenantId_ativo_idx" ON "consultor_documentos"("tenantId", "ativo");

-- CreateIndex
CREATE INDEX "consultor_score_snapshots_tenantId_consultorId_data_idx" ON "consultor_score_snapshots"("tenantId", "consultorId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "parceiro_configs_tenantId_key" ON "parceiro_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "consultores" ADD CONSTRAINT "consultores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_oportunidades" ADD CONSTRAINT "registro_oportunidades_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_oportunidades" ADD CONSTRAINT "registro_oportunidades_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_updates" ADD CONSTRAINT "registro_updates_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_extensoes" ADD CONSTRAINT "registro_extensoes_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflito_candidatos" ADD CONSTRAINT "conflito_candidatos_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_acao_itens" ADD CONSTRAINT "plano_acao_itens_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_atribuicoes" ADD CONSTRAINT "registro_atribuicoes_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_atribuicoes" ADD CONSTRAINT "registro_atribuicoes_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parceiro_recebimentos" ADD CONSTRAINT "parceiro_recebimentos_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissao_parcelas" ADD CONSTRAINT "comissao_parcelas_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "registro_oportunidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissao_parcelas" ADD CONSTRAINT "comissao_parcelas_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissao_parcelas" ADD CONSTRAINT "comissao_parcelas_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "parceiro_recebimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultor_reunioes" ADD CONSTRAINT "consultor_reunioes_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultor_metas" ADD CONSTRAINT "consultor_metas_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultor_documentos" ADD CONSTRAINT "consultor_documentos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultor_score_snapshots" ADD CONSTRAINT "consultor_score_snapshots_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "consultores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parceiro_configs" ADD CONSTRAINT "parceiro_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

