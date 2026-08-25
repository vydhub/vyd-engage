import { Task } from '../types';
import { Checkbox } from './ui/checkbox';
import {
  Edit2,
  Trash2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Circle,
  XCircle,
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Flame,
} from 'lucide-react';
import { formatRelativeTime } from '../utils/interactions';

interface TaskCardProps {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  showCheckbox?: boolean;
}

export const getPriorityColor = (priority: Task['priority']) => {
  switch (priority) {
    case 'URGENT':
      return 'badge-priority-urgent';
    case 'HIGH':
      return 'badge-priority-high';
    case 'MEDIUM':
      return 'badge-priority-medium';
    case 'LOW':
      return 'badge-priority-low';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

export const getPriorityLabel = (priority: Task['priority']) => {
  switch (priority) {
    case 'URGENT':
      return 'Urgente';
    case 'HIGH':
      return 'Alta';
    case 'MEDIUM':
      return 'Média';
    case 'LOW':
      return 'Baixa';
    default:
      return priority;
  }
};

export const getPriorityIcon = (priority: Task['priority']) => {
  switch (priority) {
    case 'URGENT':
      return <Flame size={12} className="inline mr-0.5" aria-hidden="true" />;
    case 'HIGH':
      return <ArrowUp size={12} className="inline mr-0.5" aria-hidden="true" />;
    case 'MEDIUM':
      return <ArrowRight size={12} className="inline mr-0.5" aria-hidden="true" />;
    case 'LOW':
      return <ArrowDown size={12} className="inline mr-0.5" aria-hidden="true" />;
    default:
      return null;
  }
};

export const getStatusInfo = (status: Task['status']) => {
  switch (status) {
    case 'COMPLETED':
      return {
        icon: <CheckCircle2 size={12} className="inline mr-0.5" aria-hidden="true" />,
        label: 'Concluída',
        className: 'bg-green-100 text-green-700 border-green-200',
      };
    case 'IN_PROGRESS':
      return {
        icon: <Clock size={12} className="inline mr-0.5" aria-hidden="true" />,
        label: 'Em andamento',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
      };
    case 'PENDING':
      return {
        icon: <Circle size={12} className="inline mr-0.5" aria-hidden="true" />,
        label: 'Pendente',
        className: 'bg-gray-100 text-gray-700 border-gray-200',
      };
    case 'CANCELLED':
      return {
        icon: <XCircle size={12} className="inline mr-0.5" aria-hidden="true" />,
        label: 'Cancelada',
        className: 'bg-destructive/15 text-destructive border-destructive/30',
      };
    default:
      return { icon: null, label: status, className: 'bg-gray-100 text-gray-700 border-gray-200' };
  }
};

export function TaskCard({
  task,
  onToggle,
  onEdit,
  onDelete,
  selected = false,
  onSelect,
  showCheckbox = false,
}: TaskCardProps) {
  const now = new Date();
  const isCompleted = task.status === 'COMPLETED';
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = !isCompleted && dueDate && dueDate < now;
  const isDueToday = !isCompleted && dueDate && dueDate.toDateString() === now.toDateString();

  return (
    <div
      className={`
        p-4 border rounded-lg transition-all
        ${selected ? 'bg-primary/10 border-primary/40' : ''}
        ${
          isCompleted
            ? 'bg-gray-100 border-gray-300 opacity-60'
            : isOverdue
              ? 'bg-destructive/10 border-destructive/40'
              : isDueToday
                ? 'bg-warning/10 border-warning/40'
                : 'bg-card border-gray-300 hover:shadow-md'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {showCheckbox && onSelect ? (
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            className="mt-1"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Selecionar tarefa ${task.title}`}
          />
        ) : null}
        <Checkbox
          checked={isCompleted}
          onCheckedChange={onToggle}
          className="mt-1"
          aria-label={
            isCompleted
              ? `Marcar tarefa "${task.title}" como pendente`
              : `Marcar tarefa "${task.title}" como concluída`
          }
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4
              className={`
                font-medium
                ${isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'}
              `}
            >
              {task.title}
            </h4>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={onEdit}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                aria-label="Editar tarefa"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={onDelete}
                className="p-1 hover:bg-destructive/10 rounded transition-colors"
                aria-label="Deletar tarefa"
              >
                <Trash2 size={14} className="text-destructive" />
              </button>
            </div>
          </div>

          {task.description && (
            <p
              className={`
                text-sm mb-2
                ${isCompleted ? 'text-gray-400' : 'text-gray-600'}
              `}
            >
              {task.description}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar
                size={14}
                className={
                  isOverdue ? 'text-destructive' : isDueToday ? 'text-yellow-600' : 'text-gray-600'
                }
              />
              <span
                className={`
                  text-xs
                  ${
                    isOverdue
                      ? 'text-destructive font-medium'
                      : isDueToday
                        ? 'text-yellow-600 font-medium'
                        : 'text-gray-600'
                  }
                `}
              >
                {isOverdue && dueDate ? (
                  <>
                    <AlertTriangle size={12} className="inline mr-1" aria-hidden="true" />
                    Vencida: {dueDate.toLocaleDateString('pt-BR')}
                  </>
                ) : isDueToday ? (
                  <>
                    <AlertCircle size={12} className="inline mr-1" aria-hidden="true" />
                    Vence hoje
                  </>
                ) : dueDate ? (
                  `Vence em ${formatRelativeTime(task.dueDate!)}`
                ) : (
                  'Sem data de vencimento'
                )}
              </span>
            </div>

            <span
              className={`
                text-xs px-2 py-0.5 rounded border inline-flex items-center gap-0.5
                ${getPriorityColor(task.priority)}
              `}
            >
              <span className="sr-only">Prioridade: </span>
              {getPriorityIcon(task.priority)}
              {getPriorityLabel(task.priority)}
            </span>

            {/* Status badge with icon — feedback beyond color */}
            {(() => {
              const statusInfo = getStatusInfo(task.status);
              return (
                <span
                  className={`
                    text-xs px-2 py-0.5 rounded border inline-flex items-center gap-0.5
                    ${statusInfo.className}
                  `}
                >
                  {statusInfo.icon}
                  {statusInfo.label}
                </span>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
