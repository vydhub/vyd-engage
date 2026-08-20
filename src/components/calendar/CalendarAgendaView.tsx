import { useMemo } from 'react';
import type { Task } from '../../types';
import { addDays, format, formatDayHeader, groupTasksByDate } from './calendarUtils';
import { Plus } from 'lucide-react';

interface CalendarAgendaViewProps {
  startDate: Date;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onDateClick: (date: Date) => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  URGENT: 'Urgente',
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
};

const PRIORITY_BADGE: Record<string, string> = {
  URGENT: 'bg-destructive/15 text-destructive',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
};

export function CalendarAgendaView({
  startDate,
  tasks,
  onTaskClick,
  onDateClick,
}: CalendarAgendaViewProps) {
  const tasksByDate = useMemo(() => groupTasksByDate(tasks), [tasks]);

  const days = useMemo(() => {
    const result: Date[] = [];
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      result.push(addDays(start, i));
    }
    return result;
  }, [startDate]);

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const dayTasks = tasksByDate.get(dateKey) || [];

        return (
          <div key={dateKey} className="bg-card rounded-lg border border-gray-300 overflow-hidden">
            {/* Day header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 capitalize">
                {formatDayHeader(day)}
              </h3>
              <button
                className="p-1 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
                onClick={() => onDateClick(day)}
                title="Adicionar tarefa"
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Tasks */}
            {dayTasks.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400">Sem tarefas</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {dayTasks.map((task) => {
                  const isCompleted = task.status === 'COMPLETED';

                  return (
                    <button
                      key={task.id}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                      onClick={() => onTaskClick(task)}
                    >
                      {/* Completed indicator */}
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          isCompleted
                            ? 'bg-gray-400'
                            : task.priority === 'URGENT'
                              ? 'bg-destructive/100'
                              : task.priority === 'HIGH'
                                ? 'bg-warning/100'
                                : task.priority === 'MEDIUM'
                                  ? 'bg-yellow-400'
                                  : 'bg-blue-400'
                        }`}
                      />

                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-sm font-medium truncate ${
                            isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'
                          }`}
                        >
                          {task.title}
                        </div>
                        {task.description && (
                          <div className="text-xs text-gray-500 truncate mt-0.5">
                            {task.description}
                          </div>
                        )}
                      </div>

                      <span
                        className={`text-[11px] px-2 py-0.5 rounded flex-shrink-0 ${
                          isCompleted
                            ? 'bg-gray-100 text-gray-400'
                            : PRIORITY_BADGE[task.priority] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {isCompleted
                          ? 'Concluída'
                          : PRIORITY_LABELS[task.priority] || task.priority}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
