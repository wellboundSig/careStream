/**
 * Heal PatientInsurances from Patients JSON mirrors when rows are missing
 * or member_id is empty while JSON still has a CIN / member ID.
 *
 * Referral create dual-writes JSON + PatientInsurances; Eligibility/Auth
 * only read PatientInsurances. This closes the gap for older/partial syncs.
 */

import { syncPatientInsurances } from '../api/syncPatientInsurances.js';
import { getInsurancesByPatient } from '../api/patientInsurances.js';
import {
  getInsurancePlans,
  getInsuranceDetailsMap,
  memberIdFromDetail,
} from './insuranceDetails.js';

/**
 * @param {object} args
 * @param {object} args.patient  Patient fields (must include insurance JSON if present)
 * @param {string} args.patientRecordId  Airtable/rec id for link writes
 * @param {string} args.patientBusinessId  pat_… id for reads
 * @returns {Promise<{ healed: boolean, reason?: string, result?: object }>}
 */
export async function ensurePatientInsurancesFromJson({
  patient,
  patientRecordId,
  patientBusinessId,
} = {}) {
  if (!patient || !patientRecordId || !patientBusinessId) {
    return { healed: false, reason: 'missing_ids' };
  }

  const plans = getInsurancePlans(patient);
  if (plans.length === 0) return { healed: false, reason: 'no_plans' };

  const detailsMap = getInsuranceDetailsMap(patient);
  const details = {};
  for (const plan of plans) {
    details[plan] = memberIdFromDetail(detailsMap[plan]);
  }

  let existing = [];
  try {
    existing = (await getInsurancesByPatient(patientBusinessId))
      .map((r) => ({ _id: r.id, ...r.fields }));
  } catch (err) {
    return { healed: false, reason: 'read_failed', error: err?.message };
  }

  const byName = new Map(
    existing.map((r) => [(r.payer_display_name || '').toLowerCase().trim(), r]),
  );

  const missingRows = plans.some((p) => !byName.has(p.toLowerCase().trim()));
  const missingMemberIds = plans.some((p) => {
    const jsonMid = details[p];
    if (!jsonMid) return false;
    const row = byName.get(p.toLowerCase().trim());
    const rowMid = String(row?.member_id || '').trim();
    return !rowMid;
  });

  if (!missingRows && !missingMemberIds) {
    return { healed: false, reason: 'already_synced' };
  }

  const result = await syncPatientInsurances({
    patientRecordId,
    patientBusinessId,
    plans,
    details,
    enteredFrom: 'heal_json',
  });

  return { healed: !!result?.synced, result };
}
