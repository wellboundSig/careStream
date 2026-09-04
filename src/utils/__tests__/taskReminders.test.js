import { describe, it, expect } from 'vitest';
import {
  combineDateAndTime,
  computeReminderAt,
  defaultReminderPreset,
  isOpenTask,
  isReminderDue,
  parseAnchorDateTime,
  reminderFieldsForTask,
} from '../taskReminders.js';
import { compareTasksBySchedule, sortTasksBySchedule } from '../taskSort.js';

describe('task reminder clock', () => {
  it('treats a date-only due date as 9:00 AM local', () => {
    const d = parseAnchorDateTime('2026-09-02');
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(2);
    expect(d.getMonth()).toBe(8);
  });

  it('computes 30 minutes before a timed schedule', () => {
    const scheduled = combineDateAndTime('2026-09-02', '14:00');
    const at = computeReminderAt(scheduled, '30m');
    const d = new Date(at);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(30);
  });

  it('computes day-before at 9:00 AM', () => {
    const at = computeReminderAt('2026-09-02', 'day_before');
    const d = new Date(at);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(9);
  });

  it('returns reminder fields only when a date and preset exist', () => {
    expect(reminderFieldsForTask({ dueDate: '', scheduledDate: '', preset: '30m' })).toEqual({});
    const fields = reminderFieldsForTask({ dueDate: '2026-09-02', preset: 'day_before' });
    expect(fields.reminder_preset).toBe('day_before');
    expect(fields.reminder_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults to day before for date-only, 30 min when a time is set', () => {
    expect(defaultReminderPreset({ scheduledDate: '2026-09-02' })).toBe('day_before');
    expect(defaultReminderPreset({ scheduledDate: '2026-09-02', scheduledTime: '14:00' })).toBe('30m');
    expect(defaultReminderPreset({})).toBe('');
  });
});

describe('open + due reminder predicates', () => {
  it('treats Pending / In Progress as open', () => {
    expect(isOpenTask({ status: 'Pending' })).toBe(true);
    expect(isOpenTask({ status: 'In Progress' })).toBe(true);
    expect(isOpenTask({ status: 'Completed' })).toBe(false);
    expect(isOpenTask({ status: 'Cancelled' })).toBe(false);
  });

  it('is due when reminder_at is in the past and not yet sent', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isReminderDue({ status: 'Pending', reminder_at: past })).toBe(true);
    expect(isReminderDue({ status: 'Pending', reminder_at: past, reminder_sent_at: past })).toBe(false);
    expect(isReminderDue({ status: 'Completed', reminder_at: past })).toBe(false);
  });
});

describe('task sort', () => {
  it('puts overdue ahead of later work, then priority', () => {
    const overdue = { title: 'B', due_date: '2020-01-01', priority: 'Normal' };
    const todayish = { title: 'A', due_date: '2099-01-01', priority: 'Urgent' };
    expect(compareTasksBySchedule(overdue, todayish)).toBeLessThan(0);
    const sorted = sortTasksBySchedule([todayish, overdue]);
    expect(sorted[0]).toBe(overdue);
  });
});
