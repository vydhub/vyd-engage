import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileEdit, X } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../contexts/AuthContext';
import { discardDraft, listDrafts } from '../hooks/useFormDraft';

/**
 * Aviso de retomada: a listagem informa que existe um formulário preenchido
 * pela metade e leva de volta a ele. Complementa o `useFormDraft` — o rascunho
 * sobrevive à navegação, mas o usuário precisa SABER que ele existe ao voltar
 * para a rota, em vez de ter que lembrar sozinho.
 */
interface DraftResumeBannerProps {
  /** Prefixo das chaves observadas (TASK_DRAFT_PREFIX, LEAD_DRAFT_PREFIX…). */
  prefix: string;
  /** Rótulo do que está pendente, no singular ('tarefa', 'lead'). */
  entityLabel: string;
  /** Rota de retomada a partir da chave do rascunho ('task.new' → /app/tasks/new). */
  toRoute: (key: string) => string;
  /** Texto de apoio (ex.: o título digitado), extraído dos valores do rascunho. */
  describe?: (values: Record<string, unknown>) => string | undefined;
}

export function DraftResumeBanner({
  prefix,
  entityLabel,
  toRoute,
  describe,
}: DraftResumeBannerProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Leitura na montagem (lazy init, sem efeito): o componente remonta a cada
  // entrada na rota, que é exatamente quando o rascunho precisa ser detectado.
  const [drafts, setDrafts] = useState<
    Array<{ key: string; values: Record<string, unknown>; savedAt: number }>
  >(() => listDrafts<Record<string, unknown>>(prefix, user?.id));

  const refresh = useCallback(() => {
    setDrafts(listDrafts<Record<string, unknown>>(prefix, user?.id));
  }, [prefix, user?.id]);

  if (drafts.length === 0) return null;

  const draft = drafts[0];
  const detalhe = describe?.(draft.values);

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
      <FileEdit size={18} className="shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          Você tem {drafts.length > 1 ? `${drafts.length} ${entityLabel}s` : `uma ${entityLabel}`}{' '}
          em edição, sem salvar
        </p>
        {detalhe ? <p className="truncate text-xs text-gray-600">{detalhe}</p> : null}
      </div>
      <Button size="sm" onClick={() => navigate(toRoute(draft.key))} className="shrink-0">
        Retomar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        aria-label="Descartar rascunho"
        onClick={() => {
          drafts.forEach((d) => discardDraft(d.key, user?.id));
          refresh();
        }}
      >
        <X size={16} />
      </Button>
    </div>
  );
}
