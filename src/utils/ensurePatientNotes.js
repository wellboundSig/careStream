import { mergeEntities } from '../store/careStore.js';
import { getNoteByBusinessId, getNotesByPatient } from '../api/notes.js';

function addRecords(mapped, records) {
  for (const r of records || []) {
    if (!r?.id) continue;
    mapped[r.id] = { _id: r.id, ...r.fields };
  }
}

/**
 * Pull this patient's notes (and an optional mention target) into the store
 * so the Notes tab is not waiting on hydrate / a 2-minute warm sync.
 */
export async function ensurePatientNotes(patientOrId, { noteId } = {}) {
  const pids = typeof patientOrId === 'string'
    ? [patientOrId]
    : [...new Set([patientOrId?.id, patientOrId?._id].filter(Boolean).map(String))];
  const mapped = {};
  const jobs = pids.map((id) => getNotesByPatient(id).then((rows) => addRecords(mapped, rows)).catch(() => {}));
  if (noteId) {
    jobs.push(getNoteByBusinessId(noteId).then((rows) => addRecords(mapped, rows)).catch(() => {}));
  }
  if (!jobs.length) return {};
  await Promise.all(jobs);
  if (Object.keys(mapped).length) mergeEntities('notes', mapped);
  return mapped;
}
