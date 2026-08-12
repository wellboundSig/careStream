/**
 * Shared data hook for the Eligibility workspace (drawer tab + module-page
 * panel). Subscribes to `useRefreshVersion()` so every mounted surface
 * re-fetches whenever any write calls `triggerDataRefresh()`.
 *
 * Single source of truth: `PatientInsurances`. On load, heals from patient
 * JSON when rows/CIN are missing (referral-stage sync gap).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { useCareStore } from '../../../store/careStore.js';
import { getInsurancesByPatient }         from '../../../api/patientInsurances.js';
import { getVerificationsByPatient, readVerificationInsuranceId } from '../../../api/eligibilityVerifications.js';
import { getChecksByPatient }             from '../../../api/insuranceChecks.js';
import { getAuthorizationsByReferral }    from '../../../api/authorizations.js';
import { getDisenrollmentFlagsByPatient } from '../../../api/disenrollmentFlags.js';
import { VERIFICATION_STATUS } from '../../../data/eligibilityEnums.js';
import { ensurePatientInsurancesFromJson } from '../../../utils/ensurePatientInsurances.js';

function resolvePatientRecordId(patient, pid, patientsById) {
  if (patient?._id) return patient._id;
  if (patient?.record_id) return patient.record_id;
  if (!pid) return null;
  const fromStore = Object.values(patientsById || {}).find(
    (p) => p.id === pid || p._id === pid,
  );
  return fromStore?._id || null;
}

export function useEligibilityData({ patient, patientId, referralId, recheckRequestedAt }) {
  const refreshVersion = useRefreshVersion();
  const patientsById = useCareStore((s) => s.patients) || {};
  const pid = patientId || patient?.id;
  const patientRecordId = resolvePatientRecordId(patient, pid, patientsById);
  const patientForHeal = patient || (pid
    ? Object.values(patientsById).find((p) => p.id === pid || p._id === pid)
    : null);

  const [insurances,      setInsurances]        = useState([]);
  const [verifications,   setVerifications]     = useState([]);
  const [legacyChecks,    setLegacyChecks]      = useState([]);
  const [authorizations,  setAuthorizations]    = useState([]);
  const [disenrollFlags,  setDisenrollFlags]    = useState([]);
  const [loading,         setLoading]           = useState(false);
  const [error,           setError]             = useState(null);

  const reload = useCallback(async () => {
    if (!pid) {
      setInsurances([]); setVerifications([]); setLegacyChecks([]);
      setAuthorizations([]); setDisenrollFlags([]);
      return;
    }
    setLoading(true); setError(null);
    try {
      if (patientForHeal && patientRecordId) {
        await ensurePatientInsurancesFromJson({
          patient: patientForHeal,
          patientRecordId,
          patientBusinessId: pid,
        }).catch(() => null);
      }
      const [insRecs, verRecs, legRecs, authRecs, flagRecs] = await Promise.all([
        getInsurancesByPatient(pid).catch(() => []),
        getVerificationsByPatient(pid).catch(() => []),
        getChecksByPatient(pid).catch(() => []),
        referralId ? getAuthorizationsByReferral(referralId).catch(() => []) : Promise.resolve([]),
        getDisenrollmentFlagsByPatient(pid).catch(() => []),
      ]);
      setInsurances(insRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setVerifications(verRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setLegacyChecks(legRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setAuthorizations(authRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setDisenrollFlags(flagRecs.map((r) => ({ _id: r.id, ...r.fields })));
    } catch (e) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [pid, referralId, patientForHeal, patientRecordId]);
  useEffect(() => { reload(); }, [reload, refreshVersion]);

  // Latest verification per insurance id. `readVerificationInsuranceId`
  // prefers the canonical `patient_insurance_id` link and falls back to the
  // legacy `insurance_id` field for any rows written before the schema
  // repair.
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

  // An insurance is "active" when its latest verification is confirmed-active.
  // When a re-check has been requested (patient moved into Eligibility
  // Verification), a verification only counts if it was logged AFTER the
  // re-check timestamp — stale pre-recheck checks don't satisfy the gate, so
  // the "Eligibility Complete" button stays disabled until fresh checks land.
  const activeInsurances = useMemo(() => {
    const recheckAt = recheckRequestedAt ? new Date(recheckRequestedAt).getTime() : 0;
    return insurances.filter((ins) => {
      const v = latestVerByInsurance.get(ins._id);
      if (!v || v.verification_status !== VERIFICATION_STATUS.CONFIRMED_ACTIVE) return false;
      if (recheckAt) {
        const vt = new Date(v.verification_date_time || 0).getTime();
        if (!(vt > recheckAt)) return false;
      }
      return true;
    });
  }, [insurances, latestVerByInsurance, recheckRequestedAt]);

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
