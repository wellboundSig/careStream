import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateTaskOptimistic = vi.fn().mockResolvedValue({});
const createNotification = vi.fn().mockResolvedValue({ id: 'rec_n1', fields: { type: 'task_reminder' } });
const mergeEntities = vi.fn();

let storeTasks = {};

vi.mock('../../store/mutations.js', () => ({
  updateTaskOptimistic: (...args) => updateTaskOptimistic(...args),
}));
vi.mock('../../api/notifications.js', () => ({
  createNotification: (...args) => createNotification(...args),
}));
vi.mock('../../store/careStore.js', () => ({
  mergeEntities: (...args) => mergeEntities(...args),
  useCareStore: { getState: () => ({ tasks: storeTasks }) },
}));

const { dispatchDueTaskReminders, _resetTaskReminderDispatch } = await import('../dispatchTaskReminders.js');

beforeEach(() => {
  updateTaskOptimistic.mockClear();
  createNotification.mockClear();
  mergeEntities.mockClear();
  storeTasks = {};
  _resetTaskReminderDispatch();
});

describe('dispatchDueTaskReminders', () => {
  it('notifies the assignee and stamps reminder_sent_at', async () => {
    const past = new Date(Date.now() - 120_000).toISOString();
    storeTasks = {
      t1: {
        _id: 'rec_t1',
        id: 'task_001',
        title: 'Call MD',
        assigned_to_id: 'usr_1',
        status: 'Pending',
        reminder_at: past,
        patient_id: 'pat_1',
      },
    };
    const sent = await dispatchDueTaskReminders({ appUserId: 'usr_1' });
    expect(sent).toEqual(['rec_t1']);
    expect(updateTaskOptimistic).toHaveBeenCalledWith('rec_t1', expect.objectContaining({
      reminder_sent_at: expect.any(String),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task_reminder',
      recipient_user_id: 'usr_1',
      entity_type: 'task',
      title: 'Task reminder: Call MD',
    }));
  });

  it('skips other people\'s tasks and already-sent reminders', async () => {
    const past = new Date(Date.now() - 120_000).toISOString();
    storeTasks = {
      mine: {
        _id: 'rec_mine', id: 'task_002', assigned_to_id: 'usr_1',
        status: 'Pending', reminder_at: past, reminder_sent_at: past, title: 'Done notify',
      },
      theirs: {
        _id: 'rec_theirs', id: 'task_003', assigned_to_id: 'usr_2',
        status: 'Pending', reminder_at: past, title: 'Not mine',
      },
    };
    const sent = await dispatchDueTaskReminders({ appUserId: 'usr_1' });
    expect(sent).toEqual([]);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
