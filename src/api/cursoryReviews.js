/**
 * CursoryReview API — one row per referral capturing the F2F team's
 * pre-clinical-RN document review checklist.
 *
 * Airtable schema (pulled live 2026-04-21):
 *   id                                 singleLineText  (custom id)
 *   referral_id                        multipleRecordLinks → Referrals
 *   reviewed_by                        multilineText   (user business id)
 *   face_to_face_document_present      checkbox
 *   physician_certification_present    checkbox
 *   patient_name_matches_referral      checkbox
 *   dates_valid_within_90_days         checkbox
 *   physician_signature_present        checkbox
 *   diagnosis_icd_codes_listed         checkbox
 *   homebound_status_documented        checkbox
 *   services_disciplines_specified     checkbox
 *
 * Conventions:
 *   - `referral_id` is normalised to an array at this boundary.
 *   - The UI uses short keys (see src/data/f2fChecklist.js). Translation
 *     between UI keys and Airtable column names is done via uiToDbFields /
 *     dbToUiFields helpers so the mapping lives in one place.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';
import { CURSORY_UI_TO_DB, CURSORY_DB_TO_UI } from '../data/f2fChecklist.js';

const TABLE = 'CursoryReview';
const LINK_FIELDS = ['referral_id'];

function normaliseFields(fields) {
  if (!fields) return fields;
  const out = { ...fields };
  for (const f of LINK_FIELDS) {
    if (f in out) {
      const v = toLinks(out[f]);
      if (v === undefined) delete out[f];
      else out[f] = v;
    }
  }
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

/**
 * Translate a UI-keyed checked map to Airtable field shape.
 *
 * @example
 *   uiToDbFields({ f2f_doc_present: true })
 *   // -> { face_to_face_document_present: true }
 */
export function uiToDbFields(checkedByUiKey) {
  const out = {};
  if (!checkedByUiKey) return out;
  for (const [uiKey, value] of Object.entries(checkedByUiKey)) {
    const dbField = CURSORY_UI_TO_DB[uiKey];
    if (!dbField) continue; // unknown key — ignore defensively
    out[dbField] = value === true || value === 'true';
  }
  return out;
}

/**
 * Translate an Airtable record's fields into a UI-keyed checked map.
 */
export function dbToUiFields(fields) {
  const out = {};
  if (!fields) return out;
  for (const [dbField, uiKey] of Object.entries(CURSORY_DB_TO_UI)) {
    if (fields[dbField] === true) out[uiKey] = true;
  }
  return out;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const getCursoryReviewsByReferral = (referralRecordId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${referralRecordId}", ARRAYJOIN({referral_id}))`,
  });

export const createCursoryReview = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updateCursoryReview = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));

/** Oldest row wins as the canonical one (stable across saves). */
function pickCanonical(records) {
  return [...records].sort((a, b) => {
    const at = new Date(a.fields?.created_at || a.createdTime || 0).getTime();
    const bt = new Date(b.fields?.created_at || b.createdTime || 0).getTime();
    if (at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/**
 * Upsert the CursoryReview for a referral, enforcing one row per referral.
 *
 * Idempotency + self-heal: if the lookup finds MORE than one row (a legacy
 * duplicate set from the old racing-create bug), we update the canonical
 * (oldest) row and best-effort delete the extras so the data collapses back
 * to a single row. Deletes are non-fatal — the read hook merges duplicates
 * defensively in the meantime.
 *
 * @param {object} input
 * @param {string} input.referralRecordId  Airtable rec id of the Referral
 * @param {object} input.checkedUiKeys     UI-keyed map { f2f_doc_present: true, ... }
 * @param {string} [input.reviewedBy]      User business id (reviewed_by is multilineText in Airtable)
 * @param {string} [input.existingId]      Canonical row id, if known (still de-dupes others)
 * @returns {Promise<{ id: string, fields: object }>}
 */
export async function upsertCursoryReview({ referralRecordId, checkedUiKeys, reviewedBy, existingId }) {
  if (!referralRecordId) throw new Error('upsertCursoryReview: referralRecordId required');

  const payload = normaliseFields({
    ...uiToDbFields(checkedUiKeys),
    referral_id: referralRecordId,
    ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
  });

  // Always resolve the full row set so we can heal duplicates regardless of
  // whether the caller handed us an existingId.
  const existing = await getCursoryReviewsByReferral(referralRecordId).catch(() => []);

  if (existing.length === 0) {
    // No row yet (and none in flight we can see) — create the single row.
    return airtable.create(TABLE, normaliseFields({
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      ...payload,
    }));
  }

  // Choose the canonical row: caller's hint if it's still present, else oldest.
  const canonical = existing.find((r) => r.id === existingId) || pickCanonical(existing);
  const result = await airtable.update(TABLE, canonical.id, payload);

  // Self-heal: remove any other rows for this referral.
  const extras = existing.filter((r) => r.id !== canonical.id);
  if (extras.length > 0) {
    await Promise.allSettled(extras.map((r) => airtable.remove(TABLE, r.id)));
  }

  return result;
}
