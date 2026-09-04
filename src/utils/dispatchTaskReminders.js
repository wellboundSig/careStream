import { createNotification } from '../api/notifications.js';
import { updateTaskOptimistic } from '../store/mutations.js';
import { mergeEntities, useCareStore } from '../store/careStore.js';
import { isReminderDue, reminderPresetLabel } from './taskReminders.js';

const firedLocally = new Set();
let inFlight = false;

function notifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Fire in-app notifications for open tasks whose reminder time has arrived.
 * Stamps reminder_sent_at so each reminder fires once.
 */
export async function dispatchDueTaskReminders({ appUserId, now = Date.now() } = {}) {
  if (!appUserId || inFlight) return [];
  const tasks = Object.values(useCareStore.getState().tasks || {});
  const due = tasks.filter((t) => (
    t.assigned_to_id === appUserId
    && t._id
    && !String(t._id).startsWith('_pending_')
    && !firedLocally.has(t._id)
    && isReminderDue(t, now)
  ));
  if (!due.length) return [];

  inFlight = true;
  const sent = [];
  try {
    for (const task of due) {
      firedLocally.add(task._id);
      try {
        await updateTaskOptimistic(task._id, {
          reminder_sent_at: new Date(now).toISOString(),
        });
      } catch (err) {
        console.warn('[taskReminders] could not stamp reminder_sent_at:', err?.message || err);
        continue;
      }

      const title = `Task reminder: ${task.title || 'Open task'}`;
      const when = reminderPresetLabel(task.reminder_preset);
      const body = when
        ? `${when}. Open the task to follow up.`
        : 'This scheduled task is due for your attention.';
      const created = new Date(now).toISOString();
      try {
        const rec = await createNotification({
          id: notifId(),
          recipient_user_id: appUserId,
          actor_user_id: appUserId,
          type: 'task_reminder',
          entity_type: 'task',
          entity_id: task.id || task._id,
          patient_id: task.patient_id || null,
          referral_id: task.referral_id || null,
          title,
          body,
          is_read: false,
          created_at: created,
          updated_at: created,
        });
        if (rec?.id) {
          mergeEntities('notifications', {
            [rec.id]: { _id: rec.id, ...rec.fields },
          });
        }
        sent.push(task._id);
      } catch (err) {
        console.warn('[taskReminders] notification failed:', err?.message || err);
      }
    }
  } finally {
    inFlight = false;
  }
  return sent;
}

/** Test helper — resets in-memory fire lock. */
export function _resetTaskReminderDispatch() {
  firedLocally.clear();
  inFlight = false;
}
