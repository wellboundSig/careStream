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

/** Normalize plan-detail cell (bare string or `{ member_id }`) → member ID string. */
export function memberIdFromDetail(val) {
  if (typeof val === 'string') return val.trim();
  if (val && typeof val === 'object') {
    return String(val.member_id || val.memberId || '').trim();
  }
  return '';
}

export function hasInsuranceDetails(patient) {
  const plans = getInsurancePlans(patient);
  if (plans.length === 0) return false;
  const details = getInsuranceDetailsMap(patient);
  return plans.some((plan) => memberIdFromDetail(details[plan]).length > 0);
}

/** Strip spaces / dashes so "AB 12345 C" matches "AB12345C". */
export function normalizeInsuranceId(value) {
  return String(value || '').toLowerCase().replace(/[\s\-._]/g, '');
}

/**
 * Every member / CIN-style ID on a patient we can search locally:
 * legacy Patients columns plus `insurance_plan_details` member IDs.
 */
export function collectInsuranceSearchIds(patient, extraIds = []) {
  const ids = [];
  if (patient) {
    for (const key of ['medicaid_number', 'medicare_number', 'insurance_id']) {
      const v = String(patient[key] || '').trim();
      if (v) ids.push(v);
    }
    for (const val of Object.values(getInsuranceDetailsMap(patient))) {
      const mid = memberIdFromDetail(val);
      if (mid) ids.push(mid);
    }
  }
  for (const raw of extraIds) {
    const v = String(raw || '').trim();
    if (v) ids.push(v);
  }
  return ids;
}

export function matchesInsuranceQuery(patient, query, extraIds = []) {
  const nq = normalizeInsuranceId(query);
  if (!nq) return false;
  return collectInsuranceSearchIds(patient, extraIds).some((id) =>
    normalizeInsuranceId(id).includes(nq)
  );
}

export function findMatchingInsuranceId(patient, query, extraIds = []) {
  const ids = collectInsuranceSearchIds(patient, extraIds);
  const nq = normalizeInsuranceId(query);
  if (!ids.length) return '';
  if (!nq) return ids[0];
  return ids.find((id) => normalizeInsuranceId(id).includes(nq)) || ids[0];
}
