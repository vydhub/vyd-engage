import type { Task } from '../../types';
import { format } from './calendarUtils';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Edit2, CheckCircle, RotateCcw, Trash2, Calendar } from 'lucide-react';

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  URGENT: { label: 'Urgente', className: 'bg-destructive/15 text-destructive' },
  HIGH: { label: 'Alta', className: 'bg-orange-100 text-orange-700' },
  MEDIUM: { label: 'Média', className: 'bg-yellow-100 text-yellow-700' },
  LOW: { label: 'Baixa', className: 'bg-blue-100 text-blue-700' },
};

interface CalendarTaskPopoverProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function CalendarTaskPopover({
  task,
  open,
  onClose,
  onEdit,
  onComplete,
  onDelete,
}: CalendarTaskPopoverProps) {
  if (!task) return null;

  const isCompleted = task.status === 'COMPLETED';
  const priority = PRIORITY_BADGE[task.priority] || {
    label: task.priority,
    className: 'bg-gray-100 text-gray-600',
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={isCompleted ? 'line-through text-gray-400' : ''}>
            {task.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {task.description && (
            <p className="text-sm text-gray-600 line-clamp-3">{task.description}</p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${priority.className}`}>
              {priority.label}
            </span>

            {task.dueDate && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar size={12} />
                {format(new Date(task.dueDate), 'dd/MM/yyyy')}
              </span>
            )}

            {isCompleted && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                Concluída
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onEdit(task);
              onClose();
            }}
          >
            <Edit2 size={14} className="mr-1" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onComplete(task);
              onClose();
            }}
          >
            {isCompleted ? (
              <>
                <RotateCcw size={14} className="mr-1" />
                Reabrir
              </>
            ) : (
              <>
                <CheckCircle size={14} className="mr-1" />
                Concluir
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              onDelete(task);
              onClose();
            }}
          >
            <Trash2 size={14} className="mr-1" />
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
