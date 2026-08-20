import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { useAuth } from '../contexts/AuthContext';
import { Input } from '../components/ui/input';
import {
  TaskCard,
  getPriorityColor,
  getPriorityLabel,
  getPriorityIcon,
  getStatusInfo,
} from '../components/TaskCard';
import { PageSkeleton } from '../components/PageSkeleton';
import { useTasks } from '../hooks/useTasks';
import { DraftResumeBanner } from '../components/DraftResumeBanner';
import { TASK_DRAFT_PREFIX } from '../utils/draftKeys';
import { Task } from '../types';
import {
  Plus,
  Calendar as CalendarIcon,
  AlertCircle,
  List,
  CalendarDays,
  CalendarRange,
  LayoutList,
  AlertTriangle,
  Edit2,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { EmptyState } from '../components/EmptyState';
import { ExportButton } from '../components/ExportButton';
import { apiClient } from '../services/api/client';
import { useIsMobile } from '../components/ui/use-mobile';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { formatRelativeTime } from '../utils/interactions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import type { CalendarViewMode } from '../components/calendar/calendarUtils';
import {
  getDateRangeForView,
  formatMonthTitle,
  formatWeekTitle,
  startOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
} from '../components/calendar/calendarUtils';
import { CalendarHeader } from '../components/calendar/CalendarHeader';
import { CalendarMonthView } from '../components/calendar/CalendarMonthView';
import { CalendarWeekView } from '../components/calendar/CalendarWeekView';
import { CalendarAgendaView } from '../components/calendar/CalendarAgendaView';
import { CalendarTaskPopover } from '../components/calendar/CalendarTaskPopover';
import { CalendarQuickAdd } from '../components/calendar/CalendarQuickAdd';

export function Tasks() {
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    uncompleteTask,
    refetch,
    fetchTasks,
  } = useTasks();
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => (isMobile ? 'agenda' : 'list'));
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState<Date>(new Date());
  const [popoverTask, setPopoverTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today' | 'pending' | 'completed'>(
    'all'
  );
  const [priorityFilter, setPriorityFilter] = useState<
    'all' | 'HIGH' | 'MEDIUM' | 'LOW' | 'URGENT'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingTask, setDeletingTask] = useState<Task | undefined>();
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);

  // Helper functions for filtering
  const getTasksDueToday = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tasks.filter((task) => {
      if (task.status === 'COMPLETED' || !task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= today && dueDate < tomorrow;
    });
  }, [tasks]);

  const getOverdueTasks = useCallback(() => {
    const now = new Date();
    return tasks.filter(
      (task) => task.status !== 'COMPLETED' && task.dueDate && new Date(task.dueDate) < now
    );
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Filtro por status
      if (filter === 'overdue') {
        const isOverdue =
          task.status !== 'COMPLETED' && task.dueDate && new Date(task.dueDate) < new Date();
        if (!isOverdue) return false;
      } else if (filter === 'today') {
        const today = getTasksDueToday();
        if (!today.find((t) => t.id === task.id)) return false;
      } else if (filter === 'pending' && task.status === 'COMPLETED') return false;
      else if (filter === 'completed' && task.status !== 'COMPLETED') return false;

      // Filtro por prioridade
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;

      // Busca
      if (
        searchQuery &&
        !task.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !task.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [tasks, filter, priorityFilter, searchQuery, getTasksDueToday]);

  const groupedTasks = useMemo(() => {
    const overdue = getOverdueTasks();
    const today = getTasksDueToday();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      overdue: filteredTasks.filter(
        (t) => t.status !== 'COMPLETED' && t.dueDate && new Date(t.dueDate) < new Date()
      ),
      today: filteredTasks.filter((t) => today.find((task) => task.id === t.id) !== undefined),
      upcoming: filteredTasks.filter((t) => {
        if (t.status === 'COMPLETED' || !t.dueDate) return false;
        const dueDate = new Date(t.dueDate);
        return dueDate >= tomorrow;
      }),
      completed: filteredTasks.filter((t) => t.status === 'COMPLETED'),
    };
  }, [filteredTasks, getOverdueTasks, getTasksDueToday]);

  const handleToggle = async (task: Task) => {
    try {
      if (task.status === 'COMPLETED') {
        await uncompleteTask(task.id);
      } else {
        await completeTask(task.id);
      }
    } catch (error) {
      // Error already handled by hook — optimistic rollback in useTasks
    }
  };

  const handleEdit = (task: Task) => {
    navigate(`/app/tasks/${task.id}/edit`);
  };

  const handleDelete = async () => {
    if (!deletingTask) return;
    setDeletingTask(undefined);
    try {
      await deleteTask(deletingTask.id);
    } catch (error) {
      // Error already handled by hook — optimistic rollback in useTasks
    }
  };

  const handleSelectTask = (taskId: string, selected: boolean) => {
    setSelectedTasks((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(taskId);
      } else {
        newSet.delete(taskId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const pendingTasks = filteredTasks.filter((t) => t.status !== 'COMPLETED');
    const allSelected = pendingTasks.every((t) => selectedTasks.has(t.id));

    if (allSelected) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(pendingTasks.map((t) => t.id)));
    }
  };

  const handleCompleteSelected = async () => {
    try {
      await Promise.all(Array.from(selectedTasks).map((taskId) => completeTask(taskId)));
      setSelectedTasks(new Set());
      setIsSelectMode(false);
      await refetch();
    } catch (error) {
      // Error already handled by hook
    }
  };

  const handleUncompleteSelected = async () => {
    try {
      await Promise.all(Array.from(selectedTasks).map((taskId) => uncompleteTask(taskId)));
      setSelectedTasks(new Set());
      setIsSelectMode(false);
      await refetch();
    } catch (error) {
      // Error already handled by hook
    }
  };

  // Refetch baseado no viewMode, calendarDate e myTasksOnly
  useEffect(() => {
    const assignedTo = myTasksOnly && user?.id ? user.id : undefined;
    if (viewMode === 'list') {
      fetchTasks(assignedTo ? { assignedTo } : undefined, { silent: true });
    } else {
      const { startDate, endDate } = getDateRangeForView(viewMode, calendarDate);
      fetchTasks(
        { startDate, endDate, limit: 200, ...(assignedTo ? { assignedTo } : {}) },
        { silent: true }
      );
    }
  }, [viewMode, calendarDate, fetchTasks, myTasksOnly, user?.id]);

  // Navegação do calendário
  const handleCalendarNavigate = useCallback(
    (direction: 'prev' | 'next' | 'today') => {
      setCalendarDate((prev) => {
        if (direction === 'today') return new Date();
        if (viewMode === 'month')
          return direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1);
        if (viewMode === 'week')
          return direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1);
        return direction === 'next' ? addDays(prev, 14) : subDays(prev, 14);
      });
    },
    [viewMode]
  );

  // Título do calendário
  const calendarTitle = useMemo(() => {
    if (viewMode === 'month') return formatMonthTitle(calendarDate);
    if (viewMode === 'week') return formatWeekTitle(startOfWeek(calendarDate, { weekStartsOn: 0 }));
    return 'Agenda';
  }, [viewMode, calendarDate]);

  // Drag-and-drop handler
  const handleTaskDrop = useCallback(
    async (taskId: string, newDate: Date) => {
      try {
        await updateTask(taskId, { dueDate: newDate.toISOString() });
        toast.success('Tarefa reagendada');
      } catch {
        // Error handled by hook
      }
    },
    [updateTask]
  );

  // Quick add handler
  const handleQuickAdd = useCallback(
    async (data: { title: string; priority: string; dueDate: string }) => {
      try {
        await createTask({
          title: data.title,
          priority: data.priority as Task['priority'],
          dueDate: data.dueDate,
        });
      } catch {
        // Error handled by hook
      }
    },
    [createTask]
  );

  // Calendar date click -> quick add
  const handleCalendarDateClick = useCallback((date: Date) => {
    setQuickAddDate(date);
    setQuickAddOpen(true);
  }, []);

  // Calendar task click -> popover
  const handleCalendarTaskClick = useCallback((task: Task) => {
    setPopoverTask(task);
  }, []);

  // Mobile card renderer for tasks (compact, touch-friendly)
  const renderMobileTaskCard = (task: Task) => {
    const now = new Date();
    const isCompleted = task.status === 'COMPLETED';
    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const isOverdue = !isCompleted && dueDate && dueDate < now;
    const isDueToday = !isCompleted && dueDate && dueDate.toDateString() === now.toDateString();
    const statusInfo = getStatusInfo(task.status);

    return (
      <div
        key={task.id}
        className={`
          border rounded-lg p-4 space-y-2 transition-all
          ${
            isCompleted
              ? 'bg-gray-100 border-gray-300 opacity-60'
              : isOverdue
                ? 'bg-destructive/10 border-destructive/40'
                : isDueToday
                  ? 'bg-warning/10 border-warning/40'
                  : 'bg-gray-50 border-gray-300'
          }
        `}
      >
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <Checkbox
              checked={isCompleted}
              onCheckedChange={() => handleToggle(task)}
              className="mt-0.5"
              aria-label={
                isCompleted
                  ? `Marcar tarefa "${task.title}" como pendente`
                  : `Marcar tarefa "${task.title}" como concluída`
              }
            />
            <h3
              className={`font-medium text-sm leading-tight ${isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'}`}
            >
              {task.title}
            </h3>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded border inline-flex items-center gap-0.5 flex-shrink-0 ${getPriorityColor(task.priority)}`}
          >
            {getPriorityIcon(task.priority)}
            {getPriorityLabel(task.priority)}
          </span>
        </div>

        {task.description && (
          <p className={`text-xs pl-7 ${isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>
            {task.description.length > 80
              ? task.description.substring(0, 80) + '...'
              : task.description}
          </p>
        )}

        <div className="flex items-center gap-2 pl-7 flex-wrap">
          {/* Due date with a11y icon */}
          <span
            className={`text-xs inline-flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : isDueToday ? 'text-yellow-600 font-medium' : 'text-gray-500'}`}
          >
            {isOverdue ? (
              <>
                <AlertTriangle size={12} aria-hidden="true" />
                Vencida: {dueDate!.toLocaleDateString('pt-BR')}
              </>
            ) : isDueToday ? (
              <>
                <AlertCircle size={12} aria-hidden="true" />
                Vence hoje
              </>
            ) : dueDate ? (
              <>
                <CalendarIcon size={12} aria-hidden="true" />
                {formatRelativeTime(task.dueDate!)}
              </>
            ) : (
              <>
                <CalendarIcon size={12} aria-hidden="true" />
                Sem data
              </>
            )}
          </span>

          {/* Status badge with icon */}
          <span
            className={`text-xs px-2 py-0.5 rounded border inline-flex items-center gap-0.5 ${statusInfo.className}`}
          >
            {statusInfo.icon}
            {statusInfo.label}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(task)}
            className="h-8 px-2 text-xs"
            aria-label="Editar tarefa"
          >
            <Edit2 size={14} className="mr-1" />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeletingTask(task)}
            className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            aria-label="Deletar tarefa"
          >
            <Trash2 size={14} className="mr-1" />
            Deletar
          </Button>
        </div>
      </div>
    );
  };

  // Renders a task group section with desktop and mobile views
  const renderTaskGroup = (
    title: string,
    taskList: Task[],
    titleClassName: string,
    icon?: ReactNode
  ) => {
    if (taskList.length === 0) return null;
    return (
      <div>
        <h3 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${titleClassName}`}>
          {icon}
          {title} ({taskList.length})
        </h3>
        {/* Desktop: full TaskCard */}
        <div className="hidden md:block space-y-3">
          {taskList.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => handleToggle(task)}
              onEdit={() => handleEdit(task)}
              onDelete={() => setDeletingTask(task)}
              selected={selectedTasks.has(task.id)}
              onSelect={(selected) => handleSelectTask(task.id, selected)}
              showCheckbox={isSelectMode}
            />
          ))}
        </div>
        {/* Mobile: compact card view */}
        <div className="block md:hidden space-y-3">
          {taskList.map((task) => renderMobileTaskCard(task))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Tarefas" subtitle="Gerencie todas as suas tarefas e lembretes" />
        <PageSkeleton type="cards" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Tarefas" subtitle="Gerencie todas as suas tarefas e lembretes" />

      <div className="p-8 overflow-visible">
        {/* Filters */}
        <DraftResumeBanner
          prefix={TASK_DRAFT_PREFIX}
          entityLabel="tarefa"
          toRoute={(key) => {
            const id = key.slice(TASK_DRAFT_PREFIX.length);
            return id === 'new' ? '/app/tasks/new' : `/app/tasks/${id}/edit`;
          }}
          describe={(values) => (values.title as string) || undefined}
        />

        <div className="bg-gray-50 rounded-lg p-4 shadow-sm border border-gray-300 mb-6 overflow-visible relative z-10">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Buscar tarefas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar tarefas"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('all')}
                className="whitespace-nowrap"
              >
                Todas
              </Button>
              <Button
                variant={filter === 'overdue' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('overdue')}
                className={`whitespace-nowrap ${filter === 'overdue' ? 'bg-red-600 hover:bg-red-700' : ''}`}
              >
                <AlertCircle size={14} className="mr-1" />
                Vencidas ({getOverdueTasks().length})
              </Button>
              <Button
                variant={filter === 'today' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('today')}
                className="whitespace-nowrap"
              >
                <CalendarIcon size={14} className="mr-1" />
                Hoje ({getTasksDueToday().length})
              </Button>
              <Button
                variant={filter === 'pending' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('pending')}
                className="whitespace-nowrap"
              >
                Pendentes
              </Button>
              <Button
                variant={filter === 'completed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('completed')}
                className="whitespace-nowrap"
              >
                Concluídas
              </Button>
            </div>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
              className="px-3 py-2 border border-gray-300 rounded-md bg-card whitespace-nowrap"
              aria-label="Filtrar por prioridade"
            >
              <option value="all">Todas as prioridades</option>
              <option value="URGENT">Urgente</option>
              <option value="HIGH">Alta</option>
              <option value="MEDIUM">Média</option>
              <option value="LOW">Baixa</option>
            </select>

            <div className="flex gap-2">
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="whitespace-nowrap"
              >
                <List size={14} className="mr-1" />
                Lista
              </Button>
              <Button
                variant={viewMode === 'month' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('month')}
                className="whitespace-nowrap"
              >
                <CalendarDays size={14} className="mr-1" />
                Mês
              </Button>
              <Button
                variant={viewMode === 'week' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('week')}
                className="whitespace-nowrap"
              >
                <CalendarRange size={14} className="mr-1" />
                Semana
              </Button>
              <Button
                variant={viewMode === 'agenda' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('agenda')}
                className="whitespace-nowrap"
              >
                <LayoutList size={14} className="mr-1" />
                Agenda
              </Button>
              {isSelectMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    className="whitespace-nowrap"
                  >
                    Selecionar Todas
                  </Button>
                  {selectedTasks.size > 0 && (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleCompleteSelected}
                        className="whitespace-nowrap bg-green-600 hover:bg-green-700"
                      >
                        Concluir ({selectedTasks.size})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTasks(new Set());
                          setIsSelectMode(false);
                        }}
                        className="whitespace-nowrap"
                      >
                        Cancelar
                      </Button>
                    </>
                  )}
                </>
              )}
              {!isSelectMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSelectMode(true)}
                  className="whitespace-nowrap"
                >
                  Selecionar
                </Button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMyTasksOnly((v) => !v)}
              className={
                'px-3 py-1.5 text-sm rounded-lg font-medium border transition-colors ' +
                (myTasksOnly
                  ? 'bg-primary text-white border-primary'
                  : 'bg-card text-gray-700 border-gray-300 hover:bg-gray-50')
              }
            >
              {myTasksOnly ? 'Minhas tarefas' : 'Todas'}
            </button>

            <ExportButton
              onExport={async (format) => {
                const filters: Record<string, string> = {};
                if (filter === 'overdue') filters.status = 'PENDING';
                else if (filter === 'completed') filters.status = 'COMPLETED';
                else if (filter === 'pending') filters.status = 'PENDING';
                if (priorityFilter !== 'all') filters.priority = priorityFilter;
                if (searchQuery) filters.search = searchQuery;
                return apiClient.exportTasksDownload(format, filters);
              }}
              filename="tasks-export"
              label="Exportar"
            />

            <Button
              onClick={() => navigate('/app/tasks/new')}
              className="bg-primary hover:bg-primary-dark whitespace-nowrap"
            >
              <Plus size={16} className="mr-2" />
              Nova Tarefa
            </Button>
          </div>
        </div>

        {/* Tasks View */}
        {viewMode === 'list' ? (
          <div className="space-y-6">
            {renderTaskGroup(
              'Tarefas Vencidas',
              groupedTasks.overdue,
              'text-destructive',
              <AlertCircle size={20} />
            )}

            {renderTaskGroup(
              'Vencem Hoje',
              groupedTasks.today,
              'text-gray-900',
              <CalendarIcon size={20} />
            )}

            {renderTaskGroup('Próximas', groupedTasks.upcoming, 'text-gray-900')}

            {renderTaskGroup('Concluídas', groupedTasks.completed, 'text-gray-900')}

            {filteredTasks.length === 0 && (
              <div className="bg-gray-50 rounded-lg shadow-sm border border-gray-300">
                <EmptyState
                  icon={CheckSquare}
                  title={
                    filter !== 'all' || searchQuery
                      ? 'Nenhuma tarefa encontrada'
                      : 'Nenhuma tarefa criada'
                  }
                  description={
                    filter !== 'all' || searchQuery
                      ? 'Tente ajustar os filtros ou termos de busca'
                      : 'Comece criando sua primeira tarefa para organizar suas atividades'
                  }
                  actionLabel="Nova Tarefa"
                  onAction={() => navigate('/app/tasks/new')}
                />
              </div>
            )}
          </div>
        ) : (
          <div>
            <CalendarHeader
              title={calendarTitle}
              viewMode={viewMode}
              onNavigate={handleCalendarNavigate}
            />

            {viewMode === 'month' && (
              <CalendarMonthView
                currentDate={calendarDate}
                tasks={tasks}
                onTaskClick={handleCalendarTaskClick}
                onDateClick={handleCalendarDateClick}
                onTaskDrop={handleTaskDrop}
              />
            )}

            {viewMode === 'week' && (
              <CalendarWeekView
                weekStart={startOfWeek(calendarDate, { weekStartsOn: 0 })}
                tasks={tasks}
                onTaskClick={handleCalendarTaskClick}
                onDateClick={handleCalendarDateClick}
                onTaskDrop={handleTaskDrop}
              />
            )}

            {viewMode === 'agenda' && (
              <CalendarAgendaView
                startDate={new Date()}
                tasks={tasks}
                onTaskClick={handleCalendarTaskClick}
                onDateClick={handleCalendarDateClick}
              />
            )}

            <CalendarTaskPopover
              task={popoverTask}
              open={!!popoverTask}
              onClose={() => setPopoverTask(null)}
              onEdit={(task) => navigate(`/app/tasks/${task.id}/edit`)}
              onComplete={async (task) => {
                if (task.status === 'COMPLETED') {
                  await uncompleteTask(task.id);
                } else {
                  await completeTask(task.id);
                }
              }}
              onDelete={(task) => setDeletingTask(task)}
            />

            <CalendarQuickAdd
              open={quickAddOpen}
              onClose={() => setQuickAddOpen(false)}
              defaultDate={quickAddDate}
              onSave={handleQuickAdd}
            />
          </div>
        )}
      </div>

      <AlertDialog
        open={!!deletingTask}
        onOpenChange={(open) => !open && setDeletingTask(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar a tarefa "{deletingTask?.title}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
