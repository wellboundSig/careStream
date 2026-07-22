/**
 * ClinicalReview API — one row per referral capturing the Clinical Intake
 * RN's pre-confirmation checklist responses.
 *
 * Persistence model mirrors `CursoryReview`:
 *   - One row per referral; we upsert by referral_id.
 *   - Live debounced writes from the UI (see hooks/useClinicalReview.js)
 *     so toggling checkboxes saves continuously rather than only on confirm.
 *   - The final accept/conditional decision still lives on
 *     `Referrals.clinical_review_decision` — that field is the immutable
 *     audit of the outcome. This table holds the working checklist that
 *     led to that decision, plus the in-progress decision/auth-required
 *     state so a user can leave + return without losing work.
 *
 * Airtable shape (created via airtable-apply-schema.js, 2026-05-27):
 *   id              singleLineText  (custom id)
 *   referral_id     multipleRecordLinks → Referrals
 *   reviewed_by     multilineText   (user business id)
 *   decision        singleSelect    (accept | conditional | "")
 *   auth_required   checkbox
 *   ...22 checkbox columns, one per clinical checklist item key.
 *     The mapping lives in src/data/clinicalChecklist.js — keep the two
 *     in lock-step. Adding a new item: add a key+dbField there, add the
 *     matching `t.check(name)` to airtable-apply-schema.js, run
 *     `npm run schema:apply`.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';
import { CLINICAL_UI_TO_DB, CLINICAL_DB_TO_UI } from '../data/clinicalChecklist.js';

const TABLE = 'ClinicalReview';
const LINK_FIELDS = ['referral_id'];
// Null must reach the API for these fields so Unlock can clear Accept
// for every user. Stripping nulls left the old decision in the database.
const NULLABLE_CLEAR_FIELDS = new Set(['decision']);

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
    if (out[k] === undefined) delete out[k];
    else if (out[k] === null && !NULLABLE_CLEAR_FIELDS.has(k)) delete out[k];
  }
  return out;
}

/**
 * Translate a UI-keyed checked map to Airtable field shape.
 */
export function uiToDbFields(checkedByUiKey) {
  const out = {};
  if (!checkedByUiKey) return out;
  for (const [uiKey, value] of Object.entries(checkedByUiKey)) {
    const dbField = CLINICAL_UI_TO_DB[uiKey];
    if (!dbField) continue;
    out[dbField] = value === true || value === 'true';
  }
  return out;
}

/**
 * Translate an Airtable record's fields into a UI-keyed checked map.
 * Only `true` checkbox values are included to keep the map sparse.
 */
export function dbToUiFields(fields) {
  const out = {};
  if (!fields) return out;
  for (const [dbField, uiKey] of Object.entries(CLINICAL_DB_TO_UI)) {
    if (fields[dbField] === true) out[uiKey] = true;
  }
  return out;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const getClinicalReviewsByReferral = (referralRecordId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${referralRecordId}", ARRAYJOIN({referral_id}))`,
  });

export const createClinicalReview = (fields) =>
  airtable.create(TABLE, normaliseFields(fields));
export const updateClinicalReview = (id, fields) =>
  airtable.update(TABLE, id, normaliseFields(fields));

/**
 * Upsert the ClinicalReview for a referral. One row per referral.
 *
 * @param {object} input
 * @param {string} input.referralRecordId   Airtable rec id of the Referral
 * @param {object} input.checkedUiKeys      UI-keyed map { dx_reviewed: true, ... }
 * @param {string|null} [input.decision]    'accept' | 'conditional' | null
 * @param {boolean} [input.authRequired]    Managed-care auth flag
 * @param {string}  [input.reviewedBy]      User business id
 * @param {string}  [input.existingId]      Skip the lookup query when known
 * @returns {Promise<{ id: string, fields: object }>}
 */
export async function upsertClinicalReview({
  referralRecordId,
  checkedUiKeys,
  decision,
  authRequired,
  reviewedBy,
  existingId,
}) {
  if (!referralRecordId) throw new Error('upsertClinicalReview: referralRecordId required');

  // Accept / conditional are written through. Explicit `null` clears a prior
  // working decision (e.g. Clinical RN Send Back to Intake after Accept).
  // `undefined` omits the field so other upserts don't wipe it.
  let decisionPart = {};
  if (decision === 'accept' || decision === 'conditional') decisionPart = { decision };
  else if (decision === null) decisionPart = { decision: null };

  const payload = {
    ...uiToDbFields(checkedUiKeys),
    ...decisionPart,
    auth_required: authRequired === true,
    referral_id: referralRecordId,
    ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
  };

  if (existingId) {
    return airtable.update(TABLE, existingId, normaliseFields(payload));
  }

  const existing = await getClinicalReviewsByReferral(referralRecordId).catch(() => []);
  if (existing.length > 0) {
    return airtable.update(TABLE, existing[0].id, normaliseFields(payload));
  }

  return airtable.create(TABLE, normaliseFields({
    id: `clr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    ...payload,
  }));
}
