/**
 * OPWDDCaseChecklistItems API.
 *
 * Per-requirement checklist rows for an OPWDD eligibility case. Seeded from
 * `OPWDD_CHECKLIST_TEMPLATE` when a case is opened, then updated in place as
 * documents are requested / received / reviewed.
 */

import airtable from './airtable.js';
import { OPWDD_CHECKLIST_TEMPLATE, OPWDD_CHECKLIST_STATUS } from '../data/opwddEnums.js';

const TABLE = 'OPWDDCaseChecklistItems';

function stripEmpty(fields) {
  if (!fields) return fields;
  const out = { ...fields };
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

export const getChecklistItemsByCase = (caseId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{opwdd_case_id} = "${caseId}"`,
    sort: [{ field: 'sort_order', direction: 'asc' }],
  });

export const getChecklistItemsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{referral_id} = "${referralId}"`,
    sort: [{ field: 'sort_order', direction: 'asc' }],
  });

export const createChecklistItem = (fields) =>
  airtable.create(TABLE, stripEmpty(fields));

export const updateChecklistItem = (recordId, fields) =>
  airtable.update(TABLE, recordId, stripEmpty({ ...fields, updated_at: new Date().toISOString() }));

/**
 * Seeds the full 15-item checklist for a freshly-opened case.
 * Idempotent-ish: callers should guard against double-seeding by checking
 * for existing items first (see `src/store/opwddOrchestration.js`).
 *
 * Returns the array of created Airtable records.
 */
export async function seedChecklistForCase({ caseId, patientId, referralId }) {
  if (!caseId) throw new Error('seedChecklistForCase: caseId is required');
  const nowIso = new Date().toISOString();

  const created = [];
  for (const tmpl of OPWDD_CHECKLIST_TEMPLATE) {
    const fields = {
      id: `opwddck_${caseId}_${tmpl.key}`,
      opwdd_case_id: caseId,
      patient_id:    patientId || undefined,
      referral_id:   referralId || undefined,
      requirement_key:   tmpl.key,
      requirement_label: tmpl.label,
      is_required:  !!tmpl.defaultRequired,
      status:       OPWDD_CHECKLIST_STATUS.MISSING,
      sort_order:   tmpl.sortOrder,
      is_current:   false,
      created_at:   nowIso,
      updated_at:   nowIso,
    };
    const record = await airtable.create(TABLE, stripEmpty(fields));
    created.push(record);
  }
  return created;
}
