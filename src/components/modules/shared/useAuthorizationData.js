/**
 * Shared data hook for the Authorization workspace (drawer tab + module-page
 * panel). Reloads on `triggerDataRefresh()` via `useRefreshVersion()`.
 *
 * Insurance from `PatientInsurances`; heals from patient JSON when CIN/rows
 * are missing after a partial referral sync.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { useCareStore } from '../../../store/careStore.js';
import { getInsurancesByPatient }      from '../../../api/patientInsurances.js';
import { getVerificationsByPatient, readVerificationInsuranceId } from '../../../api/eligibilityVerifications.js';
import { getAuthorizationsByReferral } from '../../../api/authorizations.js';
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

export function useAuthorizationData({ patient, patientId, referralId }) {
  const refreshVersion = useRefreshVersion();
  const patientsById = useCareStore((s) => s.patients) || {};
  const pid = patientId || patient?.id;
  const patientRecordId = resolvePatientRecordId(patient, pid, patientsById);
  const patientForHeal = patient || (pid
    ? Object.values(patientsById).find((p) => p.id === pid || p._id === pid)
    : null);

  const [insurances,        setInsurances]        = useState([]);
  const [verifications,     setVerifications]     = useState([]);
  const [authorizations,    setAuthorizations]    = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState(null);

  const reload = useCallback(async () => {
    if (!pid && !referralId) return;
    setLoading(true); setError(null);
    try {
      if (patientForHeal && patientRecordId && pid) {
        await ensurePatientInsurancesFromJson({
          patient: patientForHeal,
          patientRecordId,
          patientBusinessId: pid,
        }).catch(() => null);
      }
      const [insRecs, verRecs, authRecs] = await Promise.all([
        pid        ? getInsurancesByPatient(pid).catch(() => [])           : Promise.resolve([]),
        pid        ? getVerificationsByPatient(pid).catch(() => [])        : Promise.resolve([]),
        referralId ? getAuthorizationsByReferral(referralId).catch(() => []) : Promise.resolve([]),
      ]);
      setInsurances(insRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setVerifications(verRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setAuthorizations(
        authRecs.map((r) => ({ _id: r.id, ...r.fields }))
          .sort((a, b) => new Date(b.created_at || b.approved_date || 0) - new Date(a.created_at || a.approved_date || 0)),
      );
    } catch (e) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [pid, referralId, patientForHeal, patientRecordId]);
  useEffect(() => { reload(); }, [reload, refreshVersion]);

  const activeInsurances = useMemo(() => {
    const latestByIns = new Map();
    for (const v of verifications) {
      const key = readVerificationInsuranceId(v);
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
