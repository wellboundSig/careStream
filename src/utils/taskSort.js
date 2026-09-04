import { daysUntilCalendarDate } from './dateFormat.js';

export const TASK_URGENCY_ORDER = { overdue: 0, today: 1, week: 2, future: 3, none: 4 };
export const TASK_PRIORITY_ORDER = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export function taskUrgencyLevel(dueDate) {
  if (!dueDate) return 'none';
  const diff = daysUntilCalendarDate(dueDate);
  if (diff == null) return 'none';
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'future';
}

/** Date used to bucket / sort a task: due first, then scheduled. */
export function taskSortAnchor(task) {
  return task?.due_date || task?.scheduled_date || null;
}

export function compareTasksBySchedule(a, b) {
  const ua = TASK_URGENCY_ORDER[taskUrgencyLevel(taskSortAnchor(a))] ?? 4;
  const ub = TASK_URGENCY_ORDER[taskUrgencyLevel(taskSortAnchor(b))] ?? 4;
  if (ua !== ub) return ua - ub;
  const pa = TASK_PRIORITY_ORDER[a.priority] ?? 2;
  const pb = TASK_PRIORITY_ORDER[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  const ta = taskSortAnchor(a) ? new Date(taskSortAnchor(a)).getTime() : Infinity;
  const tb = taskSortAnchor(b) ? new Date(taskSortAnchor(b)).getTime() : Infinity;
  if (ta !== tb) return ta - tb;
  return (a.title || '').localeCompare(b.title || '');
}

export function sortTasksBySchedule(list) {
  return [...(list || [])].sort(compareTasksBySchedule);
}
