/**
 * Sync a patient's PatientInsurances table rows to a plans-array + details-object
 * snapshot coming from the legacy Demographics UI.
 *
 * This is called by Demographics' InsuranceEditor on every save so that NEW
 * insurance edits propagate into the canonical PatientInsurances table,
 * matching what the one-time migration script did for historical data.
 *
 * Behaviour:
 *   - Existing row with matching payer name  -> update fields + order_rank
 *   - Existing row no longer in plan list    -> delete (SAFE: we only delete
 *       rows that have no linked EligibilityVerifications to preserve audit)
 *   - Plan in list without matching row      -> create
 *
 * Fails silently (logs + returns) if the PatientInsurances table is
 * unavailable; the legacy JSON write on the Patients record still happens,
 * so nothing is lost.
 */

import {
  getInsurancesByPatient,
  createPatientInsurance,
  updatePatientInsurance,
  deletePatientInsurance,
} from './patientInsurances.js';
import { getVerificationsByPatient } from './eligibilityVerifications.js';
import { readLink } from './_linkHelpers.js';
import { normalizeInsuranceCategory } from '../data/policies/eligibilityPolicies.js';

const ORDER_RANK_FOR = ['primary', 'secondary', 'tertiary'];

export async function syncPatientInsurances({ patientId, plans, details }) {
  if (!patientId) return { synced: false, reason: 'no patientId' };
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const safeDetails = details && typeof details === 'object' ? details : {};

  let existing = [];
  try {
    existing = (await getInsurancesByPatient(patientId)).map((r) => ({ _id: r.id, ...r.fields }));
  } catch (err) {
    console.warn('[syncPatientInsurances] read failed; skipping sync', err.message);
    return { synced: false, reason: 'read_failed', error: err.message };
  }

  let verifications = [];
  try {
    verifications = await getVerificationsByPatient(patientId);
  } catch { /* best-effort; if the EligibilityVerifications table is unavailable we proceed */ }

  const verifiedIns = new Set(
    verifications.map((v) => readLink(v.fields?.insurance_id)).filter(Boolean),
  );

  const existingByName = new Map();
  for (const row of existing) existingByName.set((row.payer_display_name || '').toLowerCase().trim(), row);

  const keepNames = new Set(safePlans.map((p) => p.toLowerCase().trim()));

  const results = { created: [], updated: [], deleted: [], skippedDeletion: [] };

  // Upserts
  for (let i = 0; i < safePlans.length; i++) {
    const plan = safePlans[i];
    const key = plan.toLowerCase().trim();
    const detailVal = safeDetails[plan];
    const detailObj = detailVal && typeof detailVal === 'object' ? detailVal : {};
    const memberId = typeof detailVal === 'string' ? detailVal : (detailObj.member_id || detailObj.memberId || '');
    const existingRow = existingByName.get(key);
    const baseFields = {
      payer_display_name: plan,
      insurance_category: existingRow?.insurance_category || normalizeInsuranceCategory({ rawLabel: plan }).category,
      member_id: memberId || existingRow?.member_id || '',
      order_rank: ORDER_RANK_FOR[i] || 'unknown',
      entered_from: 'demographics',
      updated_at: new Date().toISOString(),
    };
    try {
      if (existingRow) {
        await updatePatientInsurance(existingRow._id, baseFields);
        results.updated.push(existingRow._id);
      } else {
        const rec = await createPatientInsurance({
          patient_id: patientId,
          ...baseFields,
          created_at: new Date().toISOString(),
        });
        results.created.push(rec.id);
      }
    } catch (err) {
      console.warn('[syncPatientInsurances] upsert failed for', plan, err.message);
    }
  }

  // Deletes (only for rows with no verification history — preserve audit)
  for (const row of existing) {
    const key = (row.payer_display_name || '').toLowerCase().trim();
    if (keepNames.has(key)) continue;
    if (verifiedIns.has(row._id)) {
      results.skippedDeletion.push({ id: row._id, reason: 'has_verifications' });
      continue;
    }
    try {
      await deletePatientInsurance(row._id);
      results.deleted.push(row._id);
    } catch (err) {
      console.warn('[syncPatientInsurances] delete failed for', row._id, err.message);
    }
  }

  return { synced: true, ...results };
}
