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
