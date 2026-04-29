/**
 * OPWDDEligibilityCases API.
 *
 * One row per OPWDD eligibility attempt for a referral. All FK-ish columns
 * on this table are plain text fields (matching the base-wide convention) —
 * no link normalization required.
 *
 * Pair with `opwddChecklistItems.js` for the per-requirement child rows and
 * with `src/store/opwddOrchestration.js` for the compound "open new case +
 * seed checklist + stamp referral + log activity" operation.
 */

import airtable from './airtable.js';

const TABLE = 'OPWDDEligibilityCases';

function stripEmpty(fields) {
  if (!fields) return fields;
  const out = { ...fields };
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

export const getOpwddCase = (recordId) => airtable.fetchOne(TABLE, recordId);

export const getOpwddCasesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{patient_id} = "${patientId}"`,
    sort: [{ field: 'opened_at', direction: 'desc' }],
  });

export const getOpwddCaseByReferral = (referralId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{referral_id} = "${referralId}"`,
    sort: [{ field: 'opened_at', direction: 'desc' }],
  });

export const getAllOpwddCases = (params) =>
  airtable.fetchAll(TABLE, { sort: [{ field: 'opened_at', direction: 'desc' }], ...params });

export const createOpwddCase = (fields) => airtable.create(TABLE, stripEmpty(fields));

export const updateOpwddCase = (recordId, fields) =>
  airtable.update(TABLE, recordId, stripEmpty({ ...fields, updated_at: new Date().toISOString() }));

/**
 * Find the active case (if any) for a referral. Returns the single most
 * recent non-closed case — matches the business rule of "one active OPWDD
 * case per referral".
 */
export async function findActiveCaseByReferral(referralId) {
  if (!referralId) return null;
  const records = await getOpwddCaseByReferral(referralId);
  const open = records.find((r) => {
    const s = r.fields?.status;
    return s !== 'closed' && s !== 'cancelled' && s !== 'converted_to_intake';
  });
  return open || null;
}
