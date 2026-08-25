import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  format,
  isSameDay,
  isToday,
  isSameMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Task } from '../../types';

export type CalendarViewMode = 'list' | 'month' | 'week' | 'agenda';

export const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'bg-destructive/100 text-white',
  HIGH: 'bg-warning/100 text-white',
  MEDIUM: 'bg-yellow-400 text-yellow-900',
  LOW: 'bg-blue-400 text-white',
};

export const PRIORITY_DOT_COLORS: Record<string, string> = {
  URGENT: 'bg-destructive/100',
  HIGH: 'bg-warning/100',
  MEDIUM: 'bg-yellow-400',
  LOW: 'bg-blue-400',
};

export const COMPLETED_CLASSES = 'bg-gray-300 text-gray-500 line-through';

export function getMonthGridDays(date: Date): Date[] {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

export function getWeekDays(date: Date): Date[] {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: weekStart, end: weekEnd });
}

export function formatMonthTitle(date: Date): string {
  return format(date, 'MMMM yyyy', { locale: ptBR });
}

export function formatWeekTitle(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const startStr = format(weekStart, 'd', { locale: ptBR });
  const endStr = format(weekEnd, 'd MMM yyyy', { locale: ptBR });
  return `${startStr} - ${endStr}`;
}

export function groupTasksByDate(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const dateKey = format(new Date(task.dueDate), 'yyyy-MM-dd');
    const existing = map.get(dateKey) || [];
    existing.push(task);
    map.set(dateKey, existing);
  }
  return map;
}

export function getDateRangeForView(
  viewMode: CalendarViewMode,
  date: Date
): { startDate: string; endDate: string } {
  let start: Date;
  let end: Date;

  if (viewMode === 'month') {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    start = startOfWeek(monthStart, { weekStartsOn: 0 });
    end = endOfWeek(monthEnd, { weekStartsOn: 0 });
  } else if (viewMode === 'week') {
    start = startOfWeek(date, { weekStartsOn: 0 });
    end = endOfWeek(date, { weekStartsOn: 0 });
  } else {
    // agenda: 14 dias a partir de hoje
    start = new Date();
    start.setHours(0, 0, 0, 0);
    end = addDays(start, 13);
  }

  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
  };
}

export function formatDayHeader(date: Date): string {
  if (isToday(date)) return 'Hoje';
  const tomorrow = addDays(new Date(), 1);
  if (isSameDay(date, tomorrow)) return 'Amanhã';
  return format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

export {
  isSameDay,
  isToday,
  isSameMonth,
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfWeek,
};
