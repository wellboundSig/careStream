import airtable from '../api/airtable.js';
import { useCareStore } from './careStore.js';

// ── Generic optimistic update ──────────────────────────────────────────────

function optimisticUpdate(entityKey, tableName, recordId, fields) {
  const state = useCareStore.getState();
  const previous = state[entityKey][recordId];
  if (!previous) return Promise.reject(new Error(`Record ${recordId} not found in ${entityKey}`));

  useCareStore.setState((s) => ({
    [entityKey]: {
      ...s[entityKey],
      [recordId]: { ...s[entityKey][recordId], ...fields },
    },
  }));

  return airtable.update(tableName, recordId, fields).catch((err) => {
    useCareStore.setState((s) => ({
      [entityKey]: { ...s[entityKey], [recordId]: previous },
    }));
    throw err;
  });
}

function optimisticCreate(entityKey, tableName, fields) {
  const tempId = `_pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  useCareStore.setState((s) => ({
    [entityKey]: {
      ...s[entityKey],
      [tempId]: { _id: tempId, ...fields },
    },
  }));

  return airtable
    .create(tableName, fields)
    .then((record) => {
      useCareStore.setState((s) => {
        const collection = { ...s[entityKey] };
        delete collection[tempId];
        collection[record.id] = { _id: record.id, ...record.fields };
        return { [entityKey]: collection };
      });
      return record;
    })
    .catch((err) => {
      useCareStore.setState((s) => {
        const collection = { ...s[entityKey] };
        delete collection[tempId];
        return { [entityKey]: collection };
      });
      throw err;
    });
}

function optimisticDelete(entityKey, tableName, recordId) {
  const state = useCareStore.getState();
  const previous = state[entityKey][recordId];

  useCareStore.setState((s) => {
    const collection = { ...s[entityKey] };
    delete collection[recordId];
    return { [entityKey]: collection };
  });

  return airtable.remove(tableName, recordId).catch((err) => {
    if (previous) {
      useCareStore.setState((s) => ({
        [entityKey]: { ...s[entityKey], [recordId]: previous },
      }));
    }
    throw err;
  });
}

// ── Domain-specific mutations ──────────────────────────────────────────────

export function updateReferralOptimistic(recordId, fields) {
  return optimisticUpdate('referrals', 'Referrals', recordId, fields);
}

export function updatePatientOptimistic(recordId, fields) {
  return optimisticUpdate('patients', 'Patients', recordId, fields);
}

export function updateTaskOptimistic(recordId, fields) {
  return optimisticUpdate('tasks', 'Tasks', recordId, fields);
}

export function createNoteOptimistic(fields) {
  return optimisticCreate('notes', 'Notes', fields);
}

export function updateNoteOptimistic(recordId, fields) {
  return optimisticUpdate('notes', 'Notes', recordId, fields);
}

export function deleteNoteOptimistic(recordId) {
  return optimisticDelete('notes', 'Notes', recordId);
}

function generateNotificationId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Persist mention (or other) notifications for recipients.
 * Does not optimistically insert into the actor's local store — inbox is recipient-scoped.
 */
export async function createMentionNotifications({
  mentionedUserIds,
  actorUserId,
  noteId,
  patientId,
  referralId,
  noteContent,
  actorName,
  patientLabel,
}) {
  const ids = [...new Set((mentionedUserIds || []).filter((id) => id && id !== actorUserId))];
  if (ids.length === 0) return [];

  const { createNotification } = await import('../api/notifications.js');
  const { mentionPlainPreview } = await import('../utils/mentions.js');
  const now = new Date().toISOString();
  const preview = mentionPlainPreview(noteContent, 120);
  const title = `${actorName || 'Someone'} mentioned you`;
  const body = patientLabel
    ? `${patientLabel}: ${preview || 'Open the patient note.'}`
    : (preview || 'You were mentioned in a note.');

  return Promise.all(
    ids.map((recipientId) =>
      createNotification({
        id: generateNotificationId(),
        recipient_user_id: recipientId,
        actor_user_id: actorUserId,
        type: 'mention',
        entity_type: 'note',
        entity_id: noteId,
        patient_id: patientId || null,
        referral_id: referralId || null,
        title,
        body,
        is_read: false,
        created_at: now,
        updated_at: now,
      }).catch((err) => {
        console.warn('[notifications] failed to create mention alert:', err.message);
        return null;
      }),
    ),
  );
}

export function markNotificationReadOptimistic(recordId) {
  return optimisticUpdate('notifications', 'Notifications', recordId, {
    is_read: true,
    updated_at: new Date().toISOString(),
  });
}

export function markAllNotificationsReadOptimistic(recipientUserId) {
  const state = useCareStore.getState();
  const unread = Object.values(state.notifications || {}).filter(
    (n) => n.recipient_user_id === recipientUserId && !n.is_read,
  );
  return Promise.all(
    unread.map((n) => markNotificationReadOptimistic(n._id).catch(() => null)),
  );
}

export function getNextTaskId() {
  const tasks = useCareStore.getState().tasks;
  let max = 0;
  for (const t of Object.values(tasks)) {
    const match = (t.id || '').match(/^task_(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `task_${String(max + 1).padStart(3, '0')}`;
}

export function createTaskOptimistic(fields) {
  if (!fields.id) fields = { ...fields, id: getNextTaskId() };
  const now = new Date().toISOString();
  if (!fields.created_at) fields = { ...fields, created_at: now, updated_at: now };
  return optimisticCreate('tasks', 'Tasks', fields);
}

export function createReferralOptimistic(fields) {
  return optimisticCreate('referrals', 'Referrals', fields);
}

export function createPatientOptimistic(fields) {
  return optimisticCreate('patients', 'Patients', fields);
}

export function createStageHistoryOptimistic(fields) {
  return optimisticCreate('stageHistory', 'StageHistory', fields);
}

export function updateConflictOptimistic(recordId, fields) {
  return optimisticUpdate('conflicts', 'Conflicts', recordId, fields);
}

export function updateAuthorizationOptimistic(recordId, fields) {
  return optimisticUpdate('authorizations', 'Authorizations', recordId, fields);
}

// ── OPWDD cases + checklist ───────────────────────────────────────────────

export function createOpwddCaseOptimistic(fields) {
  const now = new Date().toISOString();
  const withTs = {
    ...fields,
    created_at: fields.created_at || now,
    updated_at: fields.updated_at || now,
  };
  return optimisticCreate('opwddCases', 'OPWDDEligibilityCases', withTs);
}

export function updateOpwddCaseOptimistic(recordId, fields) {
  return optimisticUpdate('opwddCases', 'OPWDDEligibilityCases', recordId, {
    ...fields,
    updated_at: new Date().toISOString(),
  });
}

export function createOpwddChecklistItemOptimistic(fields) {
  const now = new Date().toISOString();
  const withTs = {
    ...fields,
    created_at: fields.created_at || now,
    updated_at: fields.updated_at || now,
  };
  return optimisticCreate('opwddChecklistItems', 'OPWDDCaseChecklistItems', withTs);
}

export function updateOpwddChecklistItemOptimistic(recordId, fields) {
  return optimisticUpdate('opwddChecklistItems', 'OPWDDCaseChecklistItems', recordId, {
    ...fields,
    updated_at: new Date().toISOString(),
  });
}
