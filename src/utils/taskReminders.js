import { parseCalendarDate } from './dateFormat.js';

/**
 * Reminder offsets relative to a task's scheduled time (or due date).
 * Date-only anchors are treated as 9:00 AM local so "30 minutes before"
 * still has a clock to count from.
 */
export const TASK_REMINDER_PRESETS = [
  { value: '',            label: 'No reminder' },
  { value: 'at_time',     label: 'At the scheduled time' },
  { value: '30m',         label: '30 minutes before' },
  { value: '1h',          label: '1 hour before' },
  { value: '2h',          label: '2 hours before' },
  { value: 'morning_of',  label: 'Morning of (9:00 AM)' },
  { value: 'day_before',  label: 'Day before (9:00 AM)' },
  { value: '2d',          label: '2 days before' },
  { value: '1w',          label: '1 week before' },
];

const PRESET_LABELS = Object.fromEntries(
  TASK_REMINDER_PRESETS.map((p) => [p.value, p.label]),
);

export function reminderPresetLabel(preset) {
  if (!preset) return '';
  return PRESET_LABELS[preset] || preset;
}

/** Due date first; scheduled date is the fallback clock for reminders. */
export function taskReminderAnchor(task) {
  return task?.scheduled_date || task?.due_date || null;
}

function isDateOnlyValue(value) {
  const s = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(s);
}

/** Local Date for the reminder clock. Date-only → 9:00 AM that calendar day. */
export function parseAnchorDateTime(value) {
  if (!value) return null;
  if (isDateOnlyValue(value)) {
    const day = parseCalendarDate(value);
    if (!day) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function combineDateAndTime(dateStr, timeStr) {
  if (!dateStr) return '';
  const day = parseCalendarDate(dateStr);
  if (!day) return String(dateStr);
  const tm = String(timeStr || '').trim();
  const m = tm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(dateStr).slice(0, 10);
  const next = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(m[1]),
    Number(m[2]),
    0,
    0,
  );
  return next.toISOString();
}

/**
 * @param {string|Date|null|undefined} anchor
 * @param {string} preset
 * @returns {string|null} ISO timestamp
 */
export function computeReminderAt(anchor, preset) {
  if (!preset || !anchor) return null;
  const at = parseAnchorDateTime(anchor);
  if (!at) return null;
  const d = new Date(at.getTime());
  switch (preset) {
    case 'at_time':
      break;
    case '30m':
      d.setMinutes(d.getMinutes() - 30);
      break;
    case '1h':
      d.setHours(d.getHours() - 1);
      break;
    case '2h':
      d.setHours(d.getHours() - 2);
      break;
    case 'morning_of':
      d.setHours(9, 0, 0, 0);
      break;
    case 'day_before':
      d.setDate(d.getDate() - 1);
      d.setHours(9, 0, 0, 0);
      break;
    case '2d':
      d.setDate(d.getDate() - 2);
      d.setHours(9, 0, 0, 0);
      break;
    case '1w':
      d.setDate(d.getDate() - 7);
      d.setHours(9, 0, 0, 0);
      break;
    default:
      return null;
  }
  return d.toISOString();
}

export function reminderFieldsForTask({ dueDate, scheduledDate, preset }) {
  const p = String(preset || '').trim();
  if (!p) return {};
  const at = computeReminderAt(scheduledDate || dueDate, p);
  if (!at) return {};
  return { reminder_preset: p, reminder_at: at };
}

export function isOpenTask(task) {
  const status = task?.status;
  return status === 'Pending' || status === 'In Progress';
}

export function isReminderDue(task, now = Date.now()) {
  if (!isOpenTask(task)) return false;
  if (!task?.reminder_at) return false;
  if (task.reminder_sent_at) return false;
  const at = new Date(task.reminder_at).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now;
}

export function defaultReminderPreset({ dueDate, scheduledDate, scheduledTime }) {
  if (!dueDate && !scheduledDate) return '';
  return scheduledTime ? '30m' : 'day_before';
}
