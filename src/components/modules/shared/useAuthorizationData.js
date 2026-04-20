/**
 * Shared data hook for the Authorization workspace.
 *
 * Used by BOTH the drawer tab and the module-page panel. Reloads on
 * triggerDataRefresh() via useRefreshVersion().
 *
 * Insurance selector options are merged from PatientInsurances (future
 * source of truth) + virtual entries derived from Patients.insurance_plans
 * JSON so auth records can reference Demographics insurance TODAY.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { getInsurancesByPatient }      from '../../../api/patientInsurances.js';
import { getVerificationsByPatient }   from '../../../api/eligibilityVerifications.js';
import { getAuthorizationsByReferral } from '../../../api/authorizations.js';
import { getPatient }                  from '../../../api/patients.js';
import { readLink }                    from '../../../api/_linkHelpers.js';
import { VERIFICATION_STATUS, INSURANCE_CATEGORY, ORDER_RANK } from '../../../data/eligibilityEnums.js';
import { normalizeInsuranceCategory }  from '../../../data/policies/eligibilityPolicies.js';

function deriveVirtualInsurancesFromPatient(patient) {
  if (!patient) return [];
  let plans = [];
  try { plans = patient.insurance_plans ? JSON.parse(patient.insurance_plans) : []; } catch { plans = []; }
  if (!Array.isArray(plans)) plans = [];
  if (plans.length === 0 && patient.insurance_plan) plans = [patient.insurance_plan];

  let details = {};
  try { details = patient.insurance_plan_details ? JSON.parse(patient.insurance_plan_details) : {}; } catch { details = {}; }
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

export function useAuthorizationData({ patient, patientId, referralId }) {
  const refreshVersion = useRefreshVersion();
  const pid = patientId || patient?.id;

  const [realInsurances,    setRealInsurances]    = useState([]);
  const [patientRecord,     setPatientRecord]     = useState(patient || null);
  const [verifications,     setVerifications]     = useState([]);
  const [authorizations,    setAuthorizations]    = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState(null);

  const reload = useCallback(() => {
    if (!pid && !referralId) return;
    setLoading(true); setError(null);
    Promise.all([
      pid        ? getInsurancesByPatient(pid).catch(() => [])        : Promise.resolve([]),
      pid        ? getVerificationsByPatient(pid).catch(() => [])     : Promise.resolve([]),
      referralId ? getAuthorizationsByReferral(referralId).catch(() => []) : Promise.resolve([]),
      pid && !patient ? getPatient(pid).catch(() => null) : Promise.resolve(null),
    ]).then(([insRecs, verRecs, authRecs, fetchedPatient]) => {
      setRealInsurances(insRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setVerifications(verRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setAuthorizations(
        authRecs.map((r) => ({ _id: r.id, ...r.fields }))
          .sort((a, b) => new Date(b.created_at || b.approved_date || 0) - new Date(a.created_at || a.approved_date || 0)),
      );
      if (fetchedPatient) setPatientRecord({ id: fetchedPatient.id, ...fetchedPatient.fields });
      else if (patient)   setPatientRecord(patient);
    }).catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [pid, referralId, patient]);

  useEffect(() => { reload(); }, [reload, refreshVersion]);

  const insurances = useMemo(() => {
    const virtuals = deriveVirtualInsurancesFromPatient(patientRecord || patient);
    const realNames = new Set(realInsurances.map((r) => (r.payer_display_name || '').toLowerCase()));
    const filteredVirtuals = virtuals.filter((v) => !realNames.has((v.payer_display_name || '').toLowerCase()));
    return [...realInsurances, ...filteredVirtuals];
  }, [realInsurances, patientRecord, patient]);

  const activeInsurances = useMemo(() => {
    const latestByIns = new Map();
    for (const v of verifications) {
      const key = readLink(v.insurance_id);
      if (!key) continue;
      const prev = latestByIns.get(key);
      if (!prev || new Date(v.verification_date_time || 0) > new Date(prev.verification_date_time || 0)) {
        latestByIns.set(key, v);
      }
    }
    return insurances.filter((ins) => latestByIns.get(ins._id)?.verification_status === VERIFICATION_STATUS.CONFIRMED_ACTIVE);
  }, [insurances, verifications]);

  return {
    loading, error,
    insurances, verifications, authorizations,
    activeInsurances,
    latestAuth: authorizations[0] || null,
    reload,
  };
}
