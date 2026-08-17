import { LeadStatus, LeadSource } from '@prisma/client';

/**
 * Compat com a régua antiga de status/origem de lead (pré "Leads como
 * Oportunidade"). Visualizações salvas (SavedView) e automações gravadas antes
 * da migração ainda carregam os valores antigos em filtros/trigger.status —
 * estes mapas os traduzem para a régua nova em vez de quebrar com 400.
 * Mapeamento idêntico ao da migração 20260817000000_leads_oportunidade.
 */
const LEGACY_STATUS_MAP: Record<string, LeadStatus> = {
  NEW: LeadStatus.NOVO,
  CONTACTED: LeadStatus.EM_ANDAMENTO,
  QUALIFIED: LeadStatus.EM_ANDAMENTO,
  PROPOSAL: LeadStatus.EM_ANDAMENTO,
  NEGOTIATION: LeadStatus.EM_ANDAMENTO,
  WON: LeadStatus.ENCERRADO,
  LOST: LeadStatus.CANCELADO,
};

const LEGACY_SOURCE_MAP: Record<string, LeadSource> = {
  WEBSITE: LeadSource.OUTROS,
  SOCIAL_MEDIA: LeadSource.PORTAL_NOTICIAS_LINKEDIN,
  REFERRAL: LeadSource.INDICACAO_PARCEIROS,
  EMAIL: LeadSource.PROSPECCAO_ATIVA,
  PHONE: LeadSource.PROSPECCAO_ATIVA,
  OTHER: LeadSource.OUTROS,
};

/** Traduz um status legado para a régua nova; valores atuais passam intactos. */
export function normalizeLeadStatus(value: unknown): unknown {
  if (typeof value === 'string' && value in LEGACY_STATUS_MAP) {
    return LEGACY_STATUS_MAP[value];
  }
  return value;
}

/** Traduz uma origem legada para a régua nova; valores atuais passam intactos. */
export function normalizeLeadSource(value: unknown): unknown {
  if (typeof value === 'string' && value in LEGACY_SOURCE_MAP) {
    return LEGACY_SOURCE_MAP[value];
  }
  return value;
}
