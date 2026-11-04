import { DealStage, DealStatus, DemandaCenario, DemandaEstado, Prisma } from '@prisma/client';

/**
 * Tabela M-04 da spec-mãe: o que cada estado significa para o Negócio.
 *
 * `DealStage` não está na tabela, mas os relatórios comerciais atuais leem `stage`
 * (getStats, metas, performance), então ele acompanha `status`:
 *   recebida, em_triagem → QUALIFICATION · em_orcamento → PROPOSAL ·
 *   orcamento_enviado → NEGOTIATION · ganha → WON · perdida, declinada, cancelada → LOST.
 * `descartada` não mexe em nada além de `deletedAt`.
 */
export const ESTADOS_ENCERRADOS: ReadonlySet<DemandaEstado> = new Set([
  DemandaEstado.ganha,
  DemandaEstado.perdida,
  DemandaEstado.declinada,
  DemandaEstado.cancelada,
  DemandaEstado.descartada,
]);

export const PROBABILIDADE_DO_STAGE: Record<DealStage, number> = {
  QUALIFICATION: 20,
  PROPOSAL: 40,
  NEGOTIATION: 60,
  CLOSING: 80,
  WON: 100,
  LOST: 0,
};

/** Rótulos fixos da M-04 para o motivo no Negócio. */
export const MOTIVO_DECLINADA = 'Declinada';
export const MOTIVO_CANCELADA = 'Cliente cancelou';
export const MOTIVOS_FIXOS = [MOTIVO_DECLINADA, MOTIVO_CANCELADA];

export interface EfeitoNoDeal {
  status: DealStatus;
  stage: DealStage;
}

export function efeitoNoDeal(estado: Exclude<DemandaEstado, 'descartada'>): EfeitoNoDeal {
  switch (estado) {
    case DemandaEstado.recebida:
    case DemandaEstado.em_triagem:
      return { status: DealStatus.OPEN, stage: DealStage.QUALIFICATION };
    case DemandaEstado.em_orcamento:
      return { status: DealStatus.OPEN, stage: DealStage.PROPOSAL };
    case DemandaEstado.orcamento_enviado:
      return { status: DealStatus.OPEN, stage: DealStage.NEGOTIATION };
    case DemandaEstado.ganha:
      return { status: DealStatus.WON, stage: DealStage.WON };
    case DemandaEstado.perdida:
    case DemandaEstado.declinada:
    case DemandaEstado.cancelada:
      return { status: DealStatus.LOST, stage: DealStage.LOST };
  }
}

export const NOME_DO_FUNIL: Record<DemandaCenario, string> = {
  [DemandaCenario.contrato_novo]: 'Contrato novo',
  [DemandaCenario.chamado_lta]: 'Chamados',
};

interface ColunaPadrao {
  title: string;
  color: string;
  capturaEstado: DemandaEstado;
}

/**
 * Colunas iniciais dos funis (E-12). "Contrato novo" espera as etapas do PX-SGI-0025
 * (P-11, ainda não entregues): "Iniciação" é a única definida na filha 01, e as demais
 * são provisórias, uma por estado. Quem criar as colunas definitivas renomeia estas ou
 * mapeia outras pelo campo `capturaEstado`; garantirFunis só acrescenta o que falta.
 */
export const COLUNAS_PADRAO: Record<DemandaCenario, ColunaPadrao[]> = {
  [DemandaCenario.contrato_novo]: [
    { title: 'Iniciação', color: '#3B82F6', capturaEstado: DemandaEstado.recebida },
    { title: 'Decisão Go / No-Go', color: '#8B5CF6', capturaEstado: DemandaEstado.em_triagem },
    { title: 'Em orçamento', color: '#F59E0B', capturaEstado: DemandaEstado.em_orcamento },
    {
      title: 'Orçamento enviado',
      color: '#EC4899',
      capturaEstado: DemandaEstado.orcamento_enviado,
    },
    { title: 'Ganha', color: '#10B981', capturaEstado: DemandaEstado.ganha },
    { title: 'Perdida', color: '#EF4444', capturaEstado: DemandaEstado.perdida },
    { title: 'Declinada', color: '#6B7280', capturaEstado: DemandaEstado.declinada },
    { title: 'Cancelada', color: '#9CA3AF', capturaEstado: DemandaEstado.cancelada },
  ],
  [DemandaCenario.chamado_lta]: [
    { title: 'Recebido', color: '#3B82F6', capturaEstado: DemandaEstado.recebida },
    { title: 'Aceite do gerente', color: '#8B5CF6', capturaEstado: DemandaEstado.em_triagem },
    { title: 'Em orçamento', color: '#F59E0B', capturaEstado: DemandaEstado.em_orcamento },
    {
      title: 'Orçamento enviado',
      color: '#EC4899',
      capturaEstado: DemandaEstado.orcamento_enviado,
    },
    { title: 'Aprovado', color: '#10B981', capturaEstado: DemandaEstado.ganha },
    { title: 'Reprovado', color: '#EF4444', capturaEstado: DemandaEstado.perdida },
    { title: 'Recusado por escopo', color: '#6B7280', capturaEstado: DemandaEstado.declinada },
    { title: 'Cancelado', color: '#9CA3AF', capturaEstado: DemandaEstado.cancelada },
  ],
};

/** Origem do Negócio em `DealSource` (E-13). O produto aparece como Radar (emenda de 03/11). */
export const NOME_DA_FONTE = 'Radar';

/**
 * E-17: Negócio de demanda descartada sai dos números comerciais. Só ele: Negócio comum na
 * lixeira continua contando onde já contava (decisão de 03/11).
 */
export const SEM_DEMANDA_DESCARTADA: Prisma.DealWhereInput = {
  NOT: { deletedAt: { not: null }, demanda: { isNot: null } },
};
