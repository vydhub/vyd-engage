import {
  Newspaper,
  Globe,
  PhoneOutgoing,
  Users,
  Calendar,
  Repeat,
  Handshake,
  LucideIcon,
} from 'lucide-react';
import { LEAD_SOURCE_LABELS, LeadSource } from '../types';

interface LeadSourceBadgeProps {
  // Valores do enum LeadSource novo; aceita legados (pré-migração) por compat.
  source: string;
}

type SourceStyle = { label: string; icon: LucideIcon; className: string };

const BLUE = 'bg-blue-50 text-blue-600 border-blue-200';
const GREEN = 'bg-green-50 text-green-600 border-green-200';
const GRAY = 'bg-gray-50 text-gray-600 border-gray-200';

// Régua nova da área comercial (specs/leads-oportunidade req. 8)
const sourceConfig: Record<LeadSource, SourceStyle> = {
  PROSPECCAO_ATIVA: {
    label: LEAD_SOURCE_LABELS.PROSPECCAO_ATIVA,
    icon: PhoneOutgoing,
    className: BLUE,
  },
  PORTAL_NOTICIAS_LINKEDIN: {
    label: LEAD_SOURCE_LABELS.PORTAL_NOTICIAS_LINKEDIN,
    icon: Newspaper,
    className: BLUE,
  },
  EVENTO_FEIRA_SETORIAL: {
    label: LEAD_SOURCE_LABELS.EVENTO_FEIRA_SETORIAL,
    icon: Calendar,
    className: GREEN,
  },
  NETWORKING_PESSOAL: {
    label: LEAD_SOURCE_LABELS.NETWORKING_PESSOAL,
    icon: Users,
    className: GREEN,
  },
  CLIENTE_RECORRENTE: {
    label: LEAD_SOURCE_LABELS.CLIENTE_RECORRENTE,
    icon: Repeat,
    className: GREEN,
  },
  INDICACAO_PARCEIROS: {
    label: LEAD_SOURCE_LABELS.INDICACAO_PARCEIROS,
    icon: Handshake,
    className: GRAY,
  },
  OUTROS: { label: LEAD_SOURCE_LABELS.OUTROS, icon: Globe, className: GRAY },
};

// Compat com valores legados (mesmo mapa da migração)
const legacyMapping: Record<string, LeadSource> = {
  WEBSITE: 'OUTROS',
  SOCIAL_MEDIA: 'PORTAL_NOTICIAS_LINKEDIN',
  REFERRAL: 'INDICACAO_PARCEIROS',
  EMAIL: 'PROSPECCAO_ATIVA',
  PHONE: 'PROSPECCAO_ATIVA',
  OTHER: 'OUTROS',
  meta: 'PORTAL_NOTICIAS_LINKEDIN',
  google: 'OUTROS',
  organico: 'OUTROS',
  manual: 'OUTROS',
};

export function LeadSourceBadge({ source }: LeadSourceBadgeProps) {
  const upper = (source || '').toUpperCase();
  const normalized = (
    upper in sourceConfig ? upper : (legacyMapping[upper] ?? legacyMapping[source?.toLowerCase()])
  ) as LeadSource | undefined;
  // Fallback: qualquer source desconhecido vira um badge genérico em vez de quebrar.
  const config = normalized
    ? sourceConfig[normalized]
    : { label: source || 'Origem', icon: Globe, className: GRAY };
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${config.className}`}
    >
      <Icon size={12} aria-hidden="true" />
      <span className="sr-only">Origem: </span>
      {config.label}
    </span>
  );
}
