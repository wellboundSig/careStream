import { createConflict, updateConflict } from '../api/conflicts.js';
import { createNote } from '../api/notes.js';
import { recordActivity } from '../api/activityLog.js';
import { mergeEntities, getStore } from '../store/careStore.js';
import { CONFLICT_SOURCE_MODULE, CONFLICT_REASON_OPTIONS } from '../data/eligibilityEnums.js';
import { managedConflictCategoryLabel } from '../data/conflictCategories.js';

// Conflict severity (2026-06-12): consolidated from 4 levels (Low/Medium/High/
// Critical) down to 2 (Low/High). The Airtable column is `multilineText`, so
// the DB itself doesn't constrain values — legacy rows still hold Medium /
// Critical strings. Use `normalizeSeverity` at every DISPLAY site to fold
// those legacy values into the new 2-level scale (Medium → Low,
// Critical → High) so the UI never shows the retired labels.
export const CONFLICT_SEVERITY = Object.freeze({
  LOW: 'Low',
  HIGH: 'High',
});

export const CONFLICT_SEVERITY_OPTIONS = [
  { value: CONFLICT_SEVERITY.LOW,  label: 'Low' },
  { value: CONFLICT_SEVERITY.HIGH, label: 'High' },
];

/**
 * Fold legacy severity values into the new 2-level scale for display:
 *   - 'Medium'   → 'Low'
 *   - 'Critical' → 'High'
 *   - anything else (Low, High, null, future values) → returned unchanged
 *
 * Call this anywhere severity is rendered in the UI; never call it before
 * writing to the DB (we keep historical rows untouched).
 */
export function normalizeSeverity(severity) {
  if (severity === 'Medium')   return 'Low';
  if (severity === 'Critical') return 'High';
  return severity;
}

/**
 * Mint a domain id for a Conflict row. The Airtable `id` column on
 * Conflicts is plain text (not auto-numbered), so we generate one
 * here in the same shape used elsewhere in the codebase
 * (e.g. `note_<timestamp>_<rand>`).
 */
export function generateConflictId() {
  return `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Friendly display label for a structured conflict reason code.
 * E.g. `hospice_overlap` -> `Hospice Overlap`.
 */
export function conflictCategoryLabel(category) {
  if (!category) return 'Conflict';
  // Prefer an admin-managed category label (so renamed/custom categories show
  // correctly), then the built-in defaults, then a humanized fallback.
  let managed = null;
  try { managed = managedConflictCategoryLabel(category, getStore()); } catch { /* store not ready */ }
  if (managed) return managed.replace(/\s*\(.*?\)\s*$/, '').trim();
  const opt = CONFLICT_REASON_OPTIONS.find((o) => o.value === category);
  if (opt) return opt.label.replace(/\s*\(.*?\)\s*$/, '').trim();
  return String(category)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a Conflict (or mark it Waived).
 *
 * REQUIRES a non-empty `note` — callers must validate up front and surface
 * a UI prompt to gather it. Side effects:
 *   1. Updates the Conflicts row with status, resolution_status, resolved_at,
 *      resolved_by_id, and resolution_note.
 *   2. Mirrors the change into the in-memory store.
 *   3. Auto-creates a patient Note so the resolution shows up in the Notes
 *      tab and Timeline (fire-and-forget — schema mismatches don't block).
 *   4. Writes an audit log entry (best-effort, never throws).
 *
 * @param {object} args
 * @param {object} args.conflict           Conflict row currently in memory.
 * @param {string} args.note               Required resolution note text.
 * @param {string} [args.actorUserId]      The current user's `usr_###` id.
 * @param {'Resolved'|'Waived'} [args.status='Resolved']
 * @returns {Promise<{ updates: object }>} The fields that were written.
 */
export async function resolveConflict({
  conflict,
  note,
  actorUserId,
  status = 'Resolved',
}) {
  if (!conflict?._id) throw new Error('resolveConflict: missing conflict record id');
  const trimmed = (note || '').trim();
  if (!trimmed) throw new Error('A resolution note is required to resolve a conflict.');

  const now = new Date().toISOString();
  const updates = {
    status,
    resolution_status: status === 'Waived' ? 'waived' : 'resolved',
    resolved_at: now,
    resolution_note: trimmed,
    ...(actorUserId ? { resolved_by_id: actorUserId } : {}),
    updated_at: now,
  };

  await updateConflict(conflict._id, updates);

  // Mirror into the local store so other surfaces (timeline / drawer)
  // see the change without a refetch.
  try {
    mergeEntities('conflicts', {
      [conflict._id]: { ...conflict, ...updates },
    });
  } catch {}

  const friendlyCategory = conflictCategoryLabel(conflict.type);
  const action = status === 'Waived' ? 'waived' : 'resolved';

  // Auto-create a patient Note so the resolution is also visible in the
  // Notes tab and Timeline. Fire-and-forget.
  const noteContent = [
    `✅ ${friendlyCategory} conflict ${action}`,
    `\n${trimmed}`,
  ].join('').trim();

  try {
    createNote({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patient_id: conflict.patient_id,
      ...(conflict.referral_id ? { referral_id: conflict.referral_id } : {}),
      author_id: actorUserId || 'unknown',
      content: noteContent,
      is_pinned: false,
      created_at: now,
      updated_at: now,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[resolveConflict] auto-note write failed (non-fatal):', err?.message || err);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[resolveConflict] auto-note threw (non-fatal):', err?.message || err);
  }

  // Best-effort audit log.
  try {
    await recordActivity({
      actorUserId,
      action: status === 'Waived' ? 'Conflict Waived' : 'Conflict Resolved',
      patientId: conflict.patient_id,
      referralId: conflict.referral_id,
      detail: `${friendlyCategory} conflict ${action} — ${trimmed}`,
      metadata: {
        conflictId: conflict._id,
        category: conflict.type,
        categoryLabel: friendlyCategory,
        severity: conflict.severity || null,
        resolutionNote: trimmed,
        sourceModule: conflict.source_module || null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[resolveConflict] audit log write failed (non-fatal):', err?.message || err);
  }

  return { updates };
}

export function inferConflictSourceModuleFromStage(stage) {
  if (!stage) return CONFLICT_SOURCE_MODULE.OTHER;
  if (stage === 'Lead Entry' || stage === 'Intake' || stage === 'F2F/MD Orders Pending') return CONFLICT_SOURCE_MODULE.INTAKE;
  if (stage === 'Eligibility Verification' || stage === 'Disenrollment Required') return CONFLICT_SOURCE_MODULE.ELIGIBILITY;
  if (stage === 'Authorization Pending') return CONFLICT_SOURCE_MODULE.AUTHORIZATION;
  if (stage === 'Clinical Intake RN Review' || stage === 'Staffing Feasibility' || stage === 'Admin Confirmation') return CONFLICT_SOURCE_MODULE.CLINICAL;
  return CONFLICT_SOURCE_MODULE.OTHER;
}

/**
 * Create a Conflict record + audit log entry.
 *
 * - `patient_id` and `created_by_id` are Airtable record IDs (rec...).
 * - `referral_id` is the referral custom id (ref_...).
 */
export async function flagConflict({
  referral,
  patientRecordId, // legacy arg (ignored; Conflicts.patient_id is text)
  referralCustomId,
  createdByUserRecordId, // legacy arg (ignored; Conflicts.created_by_id is text)
  actorUserId,
  patientCustomId,
  sourceModule,
  category,
  severity,
  description,
  origin,
}) {
  const now = new Date().toISOString();
  const safeSourceModule = Object.values(CONFLICT_SOURCE_MODULE).includes(sourceModule)
    ? sourceModule
    : CONFLICT_SOURCE_MODULE.OTHER;

  // Guardrail: if some caller accidentally passes patient ids into a single-select field,
  // coerce to a valid option instead of triggering Airtable "create new option" errors.
  const normalizedSourceModule = (safeSourceModule || '').startsWith('pat_')
    ? CONFLICT_SOURCE_MODULE.OTHER
    : safeSourceModule;

  const record = {
    // Domain id (the visible primary key column on Conflicts).
    // Airtable doesn't auto-generate this, so we mint one here.
    id: generateConflictId(),
    // Live Airtable schema: patient_id is singleLineText (stores pat_###)
    patient_id: patientCustomId,
    referral_id: referralCustomId,
    source_module: normalizedSourceModule,
    // source_stage captures the EXACT stage the patient was on at the moment
    // the conflict was created so "Resolve and Return to Source" can ship
    // them back. Added 2026-05-20 alongside Conflicts.source_stage column.
    ...(referral?.current_stage ? { source_stage: referral.current_stage } : {}),
    type: category,
    severity,
    description,
    // New writes default to "Open" (added to Conflicts.status enum 2026-05-20).
    // Legacy rows may show "Unaddressed" or "In Progress" — UI treats all of
    // those as actionable. See ConflictPanel for the rendering logic.
    status: 'Open',
    flagged_by_id: actorUserId || 'unknown',
    // Live Airtable schema: conflict_reasons is multilineText (store comma-separated or single)
    conflict_reasons: category,
    details: description,
    // Live Airtable schema: created_by_id is singleLineText (stores usr_###)
    created_by_id: actorUserId || 'unknown',
    resolution_status: 'open',
    created_at: now,
    updated_at: now,
  };

  try {
    // eslint-disable-next-line no-console
    console.debug('[flagConflict] creating Conflict record', record);
  } catch {}

  const created = await createConflict(record);

  // Mirror the new Conflict into the in-memory store so the patient
  // drawer's Conflicts tab and timeline reflect it immediately.
  if (created?.id) {
    try {
      mergeEntities('conflicts', {
        [created.id]: { _id: created.id, ...created.fields },
      });
    } catch {}
  }

  // Auto-create a patient Note so the conflict is also visible in the
  // Notes section of the patient drawer. Fire-and-forget: a Notes
  // schema mismatch (e.g. author_id select-option allowlist) must not
  // break the user-facing operation.
  const friendlyCategory = conflictCategoryLabel(category);
  const noteContent = [
    `🚩 ${friendlyCategory} conflict (${severity || 'severity unspecified'})`,
    description ? `\n${description}` : '',
    `\n\nSource module: ${normalizedSourceModule}${referral?.current_stage ? ` · Stage: ${referral.current_stage}` : ''}`,
  ].join('').trim();

  try {
    createNote({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patient_id: patientCustomId,
      ...(referralCustomId ? { referral_id: referralCustomId } : {}),
      author_id: actorUserId || 'unknown',
      content: noteContent,
      is_pinned: false,
      created_at: now,
      updated_at: now,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[flagConflict] auto-note write failed (non-fatal):', err?.message || err);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[flagConflict] auto-note threw (non-fatal):', err?.message || err);
  }

  // Audit logging is best-effort; recordActivity itself swallows failures
  // (so a misconfigured ActivityLog schema can never break user actions).
  // We additionally guard here so any unexpected throw is non-fatal.
  try {
    await recordActivity({
      actorUserId,
      action: 'Conflict Flagged',
      patientId: patientCustomId,
      referralId: referralCustomId,
      detail: `Conflict flagged (${severity}) — ${friendlyCategory}`,
      metadata: {
        category,
        categoryLabel: friendlyCategory,
        severity,
        description: description || null,
        sourceModule: normalizedSourceModule,
        origin: origin || null,
        fromStage: referral?.current_stage || null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[flagConflict] audit log write failed (non-fatal):', err?.message || err);
  }

  return created;
}

