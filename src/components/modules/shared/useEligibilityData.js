/**
 * Shared data hook for the Eligibility workspace.
 *
 * Used by BOTH the drawer tab and the module-page panel. Both subscribe to
 * useRefreshVersion() so any write that calls triggerDataRefresh() causes
 * every mounted workspace to re-fetch.
 *
 * Important: insurance entries are merged from two sources so the UI works
 * before and after the PatientInsurances table is created in Airtable:
 *   1. PatientInsurances rows         (future source of truth)
 *   2. Patient.insurance_plans JSON   (current demographics storage)
 *
 * Virtual rows synthesised from #2 have stable ids of the form
 *   `demo:<patientId>:<planName>`
 * so EligibilityVerifications can reference them consistently across loads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { getInsurancesByPatient }         from '../../../api/patientInsurances.js';
import { getVerificationsByPatient, readVerificationInsuranceId } from '../../../api/eligibilityVerifications.js';
import { getChecksByPatient }             from '../../../api/insuranceChecks.js';
import { getAuthorizationsByReferral }    from '../../../api/authorizations.js';
import { getDisenrollmentFlagsByPatient } from '../../../api/disenrollmentFlags.js';
import { getPatient }                     from '../../../api/patients.js';
import { VERIFICATION_STATUS, INSURANCE_CATEGORY, ORDER_RANK } from '../../../data/eligibilityEnums.js';
import { normalizeInsuranceCategory } from '../../../data/policies/eligibilityPolicies.js';

/**
 * Parse `Patients.insurance_plans` (JSON array of plan name strings) and
 * `insurance_plan_details` (JSON object keyed by plan name) into virtual
 * PatientInsurance-shaped rows.
 */
function deriveVirtualInsurancesFromPatient(patient) {
  if (!patient) return [];
  let plans = [];
  // `insurance_plans` may arrive either as a JSON-encoded string OR as an
  // actual array (depending on whether the column type is text or
  // multipleSelects). Handle both shapes.
  const raw = patient.insurance_plans;
  if (Array.isArray(raw)) {
    plans = raw.slice();
  } else if (typeof raw === 'string' && raw.trim()) {
    try { plans = JSON.parse(raw); }
    catch { plans = []; }
  }
  if (!Array.isArray(plans)) plans = [];
  if (plans.length === 0 && patient.insurance_plan) plans = [patient.insurance_plan];

  // Drop empty/blank entries and dedupe by case-insensitive plan name. This
  // prevents the eligibility tab from showing placeholder rows ("", "—",
  // duplicates) just because the patient JSON happens to carry slots that
  // were never filled in.
  const seen = new Set();
  plans = plans
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => {
      if (!p) return false;
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  let details = {};
  const rawDetails = patient.insurance_plan_details;
  if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
    details = rawDetails;
  } else if (typeof rawDetails === 'string' && rawDetails.trim()) {
    try { details = JSON.parse(rawDetails); }
    catch { details = {}; }
  }
  if (typeof details !== 'object' || details === null) details = {};

  return plans.map((plan, idx) => {
    const info = details[plan] || {};
    const normalized = normalizeInsuranceCategory({ rawLabel: plan });
    return {
      _id: `demo:${patient.id}:${plan}`,
      _virtual: true,
      patient_id: patient.id,
      payer_display_name: plan,
      insurance_category: normalized.category || INSURANCE_CATEGORY.UNKNOWN,
      member_id: info.member_id || info.id || info.memberId || (idx === 0 ? patient.insurance_id : '') || '',
      order_rank: idx === 0 ? ORDER_RANK.PRIMARY : idx === 1 ? ORDER_RANK.SECONDARY : ORDER_RANK.TERTIARY,
      entered_from: 'demographics',
    };
  });
}

export function useEligibilityData({ patient, patientId, referralId }) {
  const refreshVersion = useRefreshVersion();
  const pid = patientId || patient?.id;

  const [realInsurances,  setRealInsurances]    = useState([]);
  const [patientRecord,   setPatientRecord]     = useState(patient || null);
  const [verifications,   setVerifications]     = useState([]);
  const [legacyChecks,    setLegacyChecks]      = useState([]);
  const [authorizations,  setAuthorizations]    = useState([]);
  const [disenrollFlags,  setDisenrollFlags]    = useState([]);
  const [loading,         setLoading]           = useState(false);
  const [error,           setError]             = useState(null);

  const reload = useCallback(() => {
    if (!pid) {
      setRealInsurances([]); setVerifications([]); setLegacyChecks([]);
      setAuthorizations([]); setDisenrollFlags([]);
      return;
    }
    setLoading(true); setError(null);
    Promise.all([
      getInsurancesByPatient(pid).catch(() => []),
      getVerificationsByPatient(pid).catch(() => []),
      getChecksByPatient(pid).catch(() => []),
      referralId ? getAuthorizationsByReferral(referralId).catch(() => []) : Promise.resolve([]),
      getDisenrollmentFlagsByPatient(pid).catch(() => []),
      // Re-fetch the patient record so we always have fresh
      // `insurance_plans` JSON — even when the caller passed us a stale one.
      patient ? Promise.resolve(null) : getPatient(pid).catch(() => null),
    ]).then(([insRecs, verRecs, legRecs, authRecs, flagRecs, fetchedPatient]) => {
      setRealInsurances(insRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setVerifications(verRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setLegacyChecks(legRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setAuthorizations(authRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setDisenrollFlags(flagRecs.map((r) => ({ _id: r.id, ...r.fields })));
      if (fetchedPatient) setPatientRecord({ id: fetchedPatient.id, ...fetchedPatient.fields });
      else if (patient)   setPatientRecord(patient);
    }).catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [pid, referralId, patient]);

  useEffect(() => { reload(); }, [reload, refreshVersion]);

  // Merge virtual demographic entries with real PatientInsurances rows.
  // Prefer real rows for the same payer name to avoid duplicates.
  const insurances = useMemo(() => {
    const virtuals = deriveVirtualInsurancesFromPatient(patientRecord || patient);
    const realNames = new Set(realInsurances.map((r) => (r.payer_display_name || '').toLowerCase()));
    const filteredVirtuals = virtuals.filter((v) => !realNames.has((v.payer_display_name || '').toLowerCase()));
    return [...realInsurances, ...filteredVirtuals];
  }, [realInsurances, patientRecord, patient]);

  // Latest verification per insurance id (real or virtual).
  // The link is now `patient_insurance_id` (canonical, links to
  // PatientInsurances); `readVerificationInsuranceId` falls back to the
  // legacy `insurance_id` field for any rows written before the migration.
  const latestVerByInsurance = useMemo(() => {
    const map = new Map();
    for (const v of verifications) {
      const key = readVerificationInsuranceId(v);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev || new Date(v.verification_date_time || 0) > new Date(prev.verification_date_time || 0)) {
        map.set(key, v);
      }
    }
    return map;
  }, [verifications]);

  const activeInsurances = useMemo(() => insurances.filter((ins) => {
    const v = latestVerByInsurance.get(ins._id);
    return v && v.verification_status === VERIFICATION_STATUS.CONFIRMED_ACTIVE;
  }), [insurances, latestVerByInsurance]);

  return {
    loading,
    error,
    insurances,
    verifications,
    legacyChecks,
    authorizations,
    disenrollFlags,
    latestVerByInsurance,
    activeInsurances,
    reload,
  };
}
