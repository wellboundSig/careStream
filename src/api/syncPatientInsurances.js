/**
 * Sync a patient's `PatientInsurances` rows from a (plans, details) snapshot.
 *
 * This is the SINGLE write path into the PatientInsurances table. Every
 * insurance edit (Demographics InsuranceEditor + NewReferralForm submit)
 * funnels through here so we end up with exactly one row per
 * (patient, payer_display_name) — no duplicates, ever.
 *
 * Behaviour:
 *   - Existing row with matching payer name  → update + reactivate
 *   - Existing row no longer in plan list    → hard-delete when safe;
 *       otherwise soft-deactivate (set termination_date) so eligibility
 *       history stays but the payer disappears from the UI
 *   - Plan in list without matching row      → create (or reactivate)
 *
 * ID handling — this is the bit that used to break:
 *   Airtable stores `patient_id` as a `multipleRecordLinks` field. Writes
 *   need the patient's **record id** (`rec…`). Reads that filter on the
 *   link field can't use the record id — `ARRAYJOIN({patient_id})` renders
 *   the linked patient's *primary field* (which is the business `pat_…`
 *   id). So this function accepts both ids and uses each at the right
 *   place; passing only one previously caused the existing-row lookup to
 *   return zero matches and append a duplicate on every save.
 *
 * Returns `{ synced, created, updated, deleted, deactivated }` on
 * success or `{ synced: false, reason }` if the table is unavailable.
 */

import {
  getInsurancesByPatient,
  createPatientInsurance,
  updatePatientInsurance,
  deletePatientInsurance,
} from './patientInsurances.js';
import { getVerificationsByPatient, readVerificationInsuranceId } from './eligibilityVerifications.js';
import { normalizeInsuranceCategory } from '../data/policies/eligibilityPolicies.js';

const ORDER_RANK_FOR = ['primary', 'secondary', 'tertiary'];

/**
 * @param {object} args
 * @param {string} args.patientRecordId  Airtable record id (`rec…`), used for link writes
 * @param {string} args.patientBusinessId Patient business id (`pat_…`), used for filter reads
 * @param {string[]} args.plans  Ordered list of payer display names
 * @param {object}  [args.details] Map of `planName → { member_id }` (also accepts a bare string member id)
 */
export async function syncPatientInsurances({ patientRecordId, patientBusinessId, plans, details }) {
  if (!patientRecordId || !patientBusinessId) {
    return { synced: false, reason: 'missing_patient_ids' };
  }
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const safeDetails = details && typeof details === 'object' ? details : {};

  let existing = [];
  try {
    // Include inactive so a re-added payer reactivates instead of duplicating.
    existing = (await getInsurancesByPatient(patientBusinessId, { includeInactive: true }))
      .map((r) => ({ _id: r.id, ...r.fields }));
  } catch (err) {
    console.warn('[syncPatientInsurances] read failed; skipping sync', err.message);
    return { synced: false, reason: 'read_failed', error: err.message };
  }

  let verifications = [];
  try {
    verifications = await getVerificationsByPatient(patientBusinessId);
  } catch { /* best-effort */ }

  const verifiedIns = new Set(
    verifications.map((v) => readVerificationInsuranceId({ _id: v.id, ...v.fields })).filter(Boolean),
  );

  const existingByName = new Map();
  for (const row of existing) existingByName.set((row.payer_display_name || '').toLowerCase().trim(), row);

  const keepNames = new Set(safePlans.map((p) => p.toLowerCase().trim()));
  const results = { created: [], updated: [], deleted: [], deactivated: [] };

  // Upserts
  for (let i = 0; i < safePlans.length; i++) {
    const plan = safePlans[i];
    const key = plan.toLowerCase().trim();
    const detailVal = safeDetails[plan];
    const detailObj = detailVal && typeof detailVal === 'object' ? detailVal : {};
    const memberId = typeof detailVal === 'string'
      ? detailVal
      : (detailObj.member_id || detailObj.memberId || '');
    const existingRow = existingByName.get(key);
    const baseFields = {
      payer_display_name: plan,
      insurance_category: existingRow?.insurance_category || normalizeInsuranceCategory({ rawLabel: plan }).category,
      member_id: memberId || existingRow?.member_id || '',
      order_rank: ORDER_RANK_FOR[i] || 'unknown',
      entered_from: existingRow?.entered_from || 'demographics',
      is_active_raw: true,
      termination_date: null, // clear soft-delete if re-adding
      updated_at: new Date().toISOString(),
    };
    try {
      if (existingRow) {
        await updatePatientInsurance(existingRow._id, baseFields);
        results.updated.push(existingRow._id);
      } else {
        const rec = await createPatientInsurance({
          patient_id: patientRecordId,
          ...baseFields,
          created_at: new Date().toISOString(),
        });
        results.created.push(rec.id);
      }
    } catch (err) {
      console.warn('[syncPatientInsurances] upsert failed for', plan, err.message);
    }
  }

  // Removals — hard delete when safe; otherwise soft-deactivate so the UI
  // stops showing the payer (previously we skipped and HIP kept coming back).
  const today = new Date().toISOString().slice(0, 10);
  for (const row of existing) {
    const key = (row.payer_display_name || '').toLowerCase().trim();
    if (keepNames.has(key)) continue;
    const alreadyGone = row.is_active_raw === false
      || (row.termination_date != null && String(row.termination_date).trim() !== '');
    if (alreadyGone) continue;
    try {
      if (verifiedIns.has(row._id)) {
        await updatePatientInsurance(row._id, {
          is_active_raw: false,
          termination_date: today,
          updated_at: new Date().toISOString(),
        });
        results.deactivated.push(row._id);
      } else {
        await deletePatientInsurance(row._id);
        results.deleted.push(row._id);
      }
    } catch (err) {
      console.warn('[syncPatientInsurances] remove failed for', row._id, err.message);
    }
  }

  return { synced: true, ...results };
}
