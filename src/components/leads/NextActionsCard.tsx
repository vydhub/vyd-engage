import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ListTodo, Loader2 } from 'lucide-react';
import { apiClient } from '../../services/api/client';

/**
 * Card "Próximas ações" do detalhe do lead (specs/leads-oportunidade req. 43):
 * tarefas pendentes/em andamento do lead, ordenadas por vencimento (sem
 * vencimento por último), com badge "Atrasada" (derivada de dueDate < hoje —
 * req. 39), criação rápida (+ Tarefa) e link "Ver todas".
 */

interface LeadTask {
  id: string;
  title: string;
  dueDate?: string | null;
  status: string;
  priority?: string;
}

interface NextActionsCardProps {
  leadId: string;
  /** Incrementado pelo pai para recarregar (ex.: após criar uma tarefa). */
  refreshToken?: number;
  /** Abre o fluxo de criação de atividade já no tipo Tarefa. */
  onCreateTask: () => void;
}

function formatDueDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function NextActionsCard({ leadId, refreshToken = 0, onCreateTask }: NextActionsCardProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Filtro leadId no backend (não filtrar a lista inteira client-side)
        const result = await apiClient.getTasks({ leadId, limit: 50 });
        if (cancelled) return;
        const list = ((result.tasks as unknown as LeadTask[]) || [])
          .filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS')
          .sort((a, b) => {
            // Vencimento asc; sem vencimento por último
            const at = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
            const bt = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
            return at - bt;
          });
        setTasks(list);
      } catch {
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, refreshToken]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isOverdue = (t: LeadTask) =>
    Boolean(t.dueDate && new Date(t.dueDate).getTime() < todayStart.getTime());

  return (
    <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <ListTodo size={15} aria-hidden="true" />
          Próximas ações
        </h3>
        <button
          type="button"
          onClick={onCreateTask}
          className="text-xs text-primary hover:underline font-medium"
        >
          + Tarefa
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={18} className="animate-spin text-gray-400" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhuma tarefa pendente para este lead.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => navigate(`/app/tasks/${task.id}/edit`)}
                className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-900 truncate">{task.title}</span>
                  {isOverdue(task) && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 flex-shrink-0">
                      Atrasada
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span>
                    {task.dueDate
                      ? `Vencimento: ${formatDueDate(task.dueDate)}`
                      : 'Sem vencimento'}
                  </span>
                  {task.status === 'IN_PROGRESS' && <span>· Em andamento</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 pt-2 border-t border-gray-200">
        <button
          type="button"
          onClick={() => navigate('/app/tasks')}
          className="text-xs text-primary hover:underline font-medium"
        >
          Ver todas
        </button>
      </div>
    </div>
  );
}
