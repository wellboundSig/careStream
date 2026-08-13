// urgentCare — single source of truth for the urgent-care / pre-assessment
// indicator. Used by ModulePage's context menu, the PatientSnapshot toggle,
// and any future surface that wants to flip the flag. We:
//   1. Optimistically write to Referrals via the store mutation layer (rolls
//      back automatically on Airtable rejection).
//   2. Emit an ActivityLog entry tagged `Urgent Care Flagged` /
//      `Urgent Care Cleared` so a future Worker can subscribe to the audit
//      stream and notify clinical RNs by email.
//
// `urgent_care_type` is a comma-separated text field: wound, insulin, injection.
// Legacy single values (`wound` / `insulin` / `injection` / `both`) still parse.
// `both` (from before Injection existed) reads as wound + insulin.

import { updateReferralOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';

/** @typedef {'wound'|'insulin'|'injection'} UrgentCareType */

export const URGENT_CARE_TYPE_OPTIONS = [
  { value: 'wound', label: 'Wound care' },
  { value: 'insulin', label: 'Insulin' },
  { value: 'injection', label: 'Injection' },
];

const KNOWN_TYPES = new Set(URGENT_CARE_TYPE_OPTIONS.map((o) => o.value));
const TYPE_ORDER = URGENT_CARE_TYPE_OPTIONS.map((o) => o.value);
const TYPE_LABELS = Object.fromEntries(
  URGENT_CARE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

function normalizeUrgentCareTypes(list) {
  const set = new Set();
  for (const item of list || []) {
    const t = String(item || '').trim().toLowerCase();
    if (t === 'both') {
      set.add('wound');
      set.add('insulin');
    } else if (KNOWN_TYPES.has(t)) {
      set.add(t);
    }
  }
  return TYPE_ORDER.filter((v) => set.has(v));
}

/**
 * Parse a stored `urgent_care_type` value into an ordered list of types.
 * @param {string|string[]|null|undefined} raw
 * @returns {UrgentCareType[]}
 */
export function parseUrgentCareTypes(raw) {
  if (Array.isArray(raw)) return normalizeUrgentCareTypes(raw);
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s === 'both') return ['wound', 'insulin'];
  return normalizeUrgentCareTypes(s.split(/[,\s]+/));
}

export function serializeUrgentCareTypes(types) {
  return normalizeUrgentCareTypes(types).join(',');
}

/**
 * @param {UrgentCareType|UrgentCareType[]|string|null|undefined} type
 * @returns {string}
 */
export function urgentCareTypeLabel(type) {
  const types = Array.isArray(type) ? normalizeUrgentCareTypes(type) : parseUrgentCareTypes(type);
  return types.map((t) => TYPE_LABELS[t]).filter(Boolean).join(', ');
}

/**
 * @param {object|null|undefined} referral
 * @returns {UrgentCareType[]}
 */
export function getUrgentCareTypes(referral) {
  return parseUrgentCareTypes(referral?.urgent_care_type);
}

/**
 * Serialized types for the referral (`wound,insulin`), or '' if none.
 * Prefer getUrgentCareTypes when you need the list.
 * @param {object|null|undefined} referral
 * @returns {string}
 */
export function getUrgentCareType(referral) {
  return serializeUrgentCareTypes(getUrgentCareTypes(referral));
}

/**
 * Toggle `requires_urgent_care` on a referral.
 *
 * @param {object} args
 * @param {object} args.referral          Referral row (must include `_id`).
 * @param {boolean} args.next             Target state (true=mark, false=clear).
 * @param {string} args.actorUserId       usr_xxx — the current user.
 * @param {string} [args.note]            Optional context, persisted to
 *                                        `urgent_care_note` when setting.
 * @param {UrgentCareType|UrgentCareType[]|string} [args.type]
 * @returns {Promise<void>}
 */
export async function setUrgentCare({ referral, next, actorUserId, note, type }) {
  if (!referral?._id) throw new Error('setUrgentCare: missing referral record id');
  const now = new Date().toISOString();

  const updates = {
    requires_urgent_care: !!next,
  };
  if (next) {
    updates.urgent_care_marked_at = now;
    if (actorUserId) updates.urgent_care_marked_by_id = actorUserId;
    if (note && note.trim()) updates.urgent_care_note = note.trim();
    if (type !== undefined) {
      updates.urgent_care_type = serializeUrgentCareTypes(type);
    }
  } else {
    // Leave the audit columns intact so we keep history of who/when last
    // flagged the patient. Clear note + subtype so the next mark starts clean.
    updates.urgent_care_note = '';
    updates.urgent_care_type = '';
  }

  await updateReferralOptimistic(referral._id, updates);

  const typeLabel = type !== undefined ? urgentCareTypeLabel(type) : '';
  recordActivity({
    actorUserId,
    action: next ? 'Urgent Care Flagged' : 'Urgent Care Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: next
      ? `Patient flagged urgent care${typeLabel ? ` (${typeLabel})` : ''}${note?.trim() ? `. ${note.trim()}` : ''}`
      : 'Urgent care flag cleared',
    metadata: {
      fromStage: referral.current_stage || null,
      note: note?.trim() || null,
      urgentCareType: type !== undefined ? serializeUrgentCareTypes(type) || null : null,
    },
  }).catch(() => {});
}

/**
 * Set the urgent-care types without requiring a full clear.
 * Selecting any type also turns the urgent flag on; an empty list clears
 * the subtype only.
 *
 * @param {object} args
 * @param {object} args.referral
 * @param {UrgentCareType|UrgentCareType[]|string} [args.type]
 * @param {UrgentCareType[]} [args.types]
 * @param {string} [args.actorUserId]
 * @returns {Promise<void>}
 */
export async function setUrgentCareType({ referral, type, types, actorUserId }) {
  if (!referral?._id) throw new Error('setUrgentCareType: missing referral record id');
  const nextType = serializeUrgentCareTypes(types !== undefined ? types : type);
  const updates = { urgent_care_type: nextType };

  if (nextType && !isUrgentCare(referral)) {
    const now = new Date().toISOString();
    updates.requires_urgent_care = true;
    updates.urgent_care_marked_at = now;
    if (actorUserId) updates.urgent_care_marked_by_id = actorUserId;
  }

  await updateReferralOptimistic(referral._id, updates);

  recordActivity({
    actorUserId,
    action: nextType ? 'Urgent Care Type Set' : 'Urgent Care Type Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: nextType
      ? `Urgent care type set to ${urgentCareTypeLabel(nextType)}`
      : 'Urgent care type cleared',
    metadata: { urgentCareType: nextType || null },
  }).catch(() => {});
}

export function isUrgentCare(referral) {
  return referral?.requires_urgent_care === true || referral?.requires_urgent_care === 'true';
}
