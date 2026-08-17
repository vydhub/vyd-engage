import { LEAD_STATUS_LABELS, LeadStatus } from '../types';

interface LeadStatusBadgeProps {
  status: string;
}

// Régua nova da área comercial (specs/leads-oportunidade req. 7). Reusa as
// classes de badge existentes em globals.css (tokens semânticos); Pausado usa
// a mesma base neutra do priority-low para não criar cor nova.
const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  NOVO: { label: LEAD_STATUS_LABELS.NOVO, className: 'badge-status-novo' },
  EM_ANDAMENTO: { label: LEAD_STATUS_LABELS.EM_ANDAMENTO, className: 'badge-status-contato' },
  PAUSADO: { label: LEAD_STATUS_LABELS.PAUSADO, className: 'badge-priority-low' },
  CANCELADO: { label: LEAD_STATUS_LABELS.CANCELADO, className: 'badge-status-perdido' },
  ENCERRADO: { label: LEAD_STATUS_LABELS.ENCERRADO, className: 'badge-status-fechado' },
};

// Compat: valores LEGADOS (pré-migração) ainda podem chegar de caches/props
// antigas — traduz para a régua nova em vez de mostrar "Desconhecido".
const legacyMapping: Record<string, LeadStatus> = {
  NEW: 'NOVO',
  CONTACTED: 'EM_ANDAMENTO',
  QUALIFIED: 'EM_ANDAMENTO',
  PROPOSAL: 'EM_ANDAMENTO',
  NEGOTIATION: 'EM_ANDAMENTO',
  WON: 'ENCERRADO',
  LOST: 'CANCELADO',
  novo: 'NOVO',
  contato: 'EM_ANDAMENTO',
  fechado: 'ENCERRADO',
  perdido: 'CANCELADO',
};

export function LeadStatusBadge({ status }: LeadStatusBadgeProps) {
  const upper = (status || '').toUpperCase();
  const normalized = (
    upper in statusConfig ? upper : (legacyMapping[upper] ?? legacyMapping[status?.toLowerCase()])
  ) as LeadStatus | undefined;
  const config = normalized
    ? statusConfig[normalized]
    : { label: status || 'Desconhecido', className: 'badge-priority-low' };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      <span className="sr-only">Status: </span>
      {config.label}
    </span>
  );
}
