/**
 * Insurance-details readiness check.
 *
 * The right-hand intake snapshot used to gate the "Insurance Details"
 * readiness dot on the presence of legacy `InsuranceChecks` rows — i.e. on
 * full eligibility verification. The 2026-05-27 intake-UX revision narrowed
 * the dot's meaning: "Insurance Details" means the demographics tab now
 * captures both an insurance plan and a member/plan number for that plan.
 * Actual eligibility verification lives in the dedicated Eligibility module
 * and is a separate workflow.
 *
 * Demographics stores insurance in three overlapping fields on `Patients`:
 *   - `insurance_plans`        — JSON array of plan names (canonical)
 *   - `insurance_plan`         — primary plan name (mirror of plans[0])
 *   - `insurance_plan_details` — JSON object: { [planName]: memberId/string }
 *
 * "Complete" = at least one plan is selected AND at least one of those
 * selected plans has a non-empty member/plan number in `insurance_plan_details`.
 * This matches what the Demographics InsuranceEditor actually saves.
 */

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function getInsurancePlans(patient) {
  if (!patient) return [];
  const parsed = parseJson(patient.insurance_plans, []);
  let plans = Array.isArray(parsed) ? parsed : [];
  if (plans.length === 0 && patient.insurance_plan) {
    plans = [patient.insurance_plan];
  }
  return plans.filter((p) => typeof p === 'string' && p.trim().length > 0);
}

export function getInsuranceDetailsMap(patient) {
  if (!patient) return {};
  const parsed = parseJson(patient.insurance_plan_details, {});
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
}

export function hasInsuranceDetails(patient) {
  const plans = getInsurancePlans(patient);
  if (plans.length === 0) return false;
  const details = getInsuranceDetailsMap(patient);
  return plans.some((plan) => {
    const id = details[plan];
    return typeof id === 'string' && id.trim().length > 0;
  });
}
