import { ExternalLink, Lock } from 'lucide-react';
import { formatCurrency } from '../../utils/format';
import { ROTULO_ESTADO, type DemandaDoNegocio } from '../../types/captura';

/**
 * Aviso da via única (spec captura-demandas, E-16): o andamento deste Negócio vem do Flow.
 * Etapa, status e valores só mudam por lá. Notas, tarefas e interações continuam livres.
 */
const FLOW_URL = (import.meta.env.VITE_FLOW_URL || 'https://flow.vydhub.com').replace(/\/+$/, '');

export function linkDoCard(flowCardId: string): string {
  return `${FLOW_URL}/card/${flowCardId}`;
}

/** O link vem de fora: só `http` e `https` viram `href`. */
function linkSeguro(link: string | null | undefined): string | null {
  return link && /^https?:\/\//i.test(link) ? link : null;
}

/** Mesmo formato das outras datas da tela do Negócio (`formatDate` em DealDetail). */
function formatarData(dataIso: string): string {
  return new Date(dataIso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AvisoFlow({ demanda }: { demanda: DemandaDoNegocio }) {
  const original = linkSeguro(demanda.linkOriginal);
  const enviado = demanda.valorEnviado != null ? Number(demanda.valorEnviado) : null;
  const aprovado = demanda.valorAprovado != null ? Number(demanda.valorAprovado) : null;
  // W-39 (filha 08): só informa a situação no portal do cliente; o andamento segue vindo do Flow.
  const situacao = demanda.situacaoOrigem?.trim() || null;

  return (
    <div
      role="status"
      className="mb-6 rounded-md border border-border bg-card p-4 flex flex-wrap items-start justify-between gap-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <Lock size={16} className="text-warning mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Andamento controlado pelo Flow</p>
          <p className="text-xs text-foreground mt-0.5">
            {demanda.estado ? `Estado atual: ${ROTULO_ESTADO[demanda.estado]}. ` : ''}
            Etapa, status e valores mudam só no card. Notas, tarefas e interações continuam livres
            aqui.
          </p>
          {(enviado !== null || aprovado !== null) && (
            <p className="text-xs text-foreground mt-1">
              {enviado !== null && <>Valor enviado: {formatCurrency(enviado)}</>}
              {enviado !== null && aprovado !== null && ' · '}
              {aprovado !== null && <>Valor aprovado: {formatCurrency(aprovado)}</>}
            </p>
          )}
          {situacao && (
            <p className="text-xs text-foreground mt-1">
              Situação no portal: {situacao}
              {demanda.situacaoOrigemEm && <> desde {formatarData(demanda.situacaoOrigemEm)}</>}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {original && (
          <a
            href={original}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Original <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
        {demanda.flowCardId ? (
          <a
            href={linkDoCard(demanda.flowCardId)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Abrir o card no Flow <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">Card ainda não vinculado</span>
        )}
      </div>
    </div>
  );
}
