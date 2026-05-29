/**
 * Shared data hook for the Authorization workspace (drawer tab + module-page
 * panel). Reloads on `triggerDataRefresh()` via `useRefreshVersion()`.
 *
 * Insurance options come straight from the `PatientInsurances` table — the
 * single source of truth. Demographics now writes there directly via
 * `syncPatientInsurances`, so the legacy "virtual rows from JSON" path is
 * no longer needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { getInsurancesByPatient }      from '../../../api/patientInsurances.js';
import { getVerificationsByPatient, readVerificationInsuranceId } from '../../../api/eligibilityVerifications.js';
import { getAuthorizationsByReferral } from '../../../api/authorizations.js';
import { VERIFICATION_STATUS } from '../../../data/eligibilityEnums.js';

export function useAuthorizationData({ patient, patientId, referralId }) {
  const refreshVersion = useRefreshVersion();
  const pid = patientId || patient?.id;

  const [insurances,        setInsurances]        = useState([]);
  const [verifications,     setVerifications]     = useState([]);
  const [authorizations,    setAuthorizations]    = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState(null);

  const reload = useCallback(() => {
    if (!pid && !referralId) return;
    setLoading(true); setError(null);
    Promise.all([
      pid        ? getInsurancesByPatient(pid).catch(() => [])           : Promise.resolve([]),
      pid        ? getVerificationsByPatient(pid).catch(() => [])        : Promise.resolve([]),
      referralId ? getAuthorizationsByReferral(referralId).catch(() => []) : Promise.resolve([]),
    ]).then(([insRecs, verRecs, authRecs]) => {
      setInsurances(insRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setVerifications(verRecs.map((r) => ({ _id: r.id, ...r.fields })));
      setAuthorizations(
        authRecs.map((r) => ({ _id: r.id, ...r.fields }))
          .sort((a, b) => new Date(b.created_at || b.approved_date || 0) - new Date(a.created_at || a.approved_date || 0)),
      );
    }).catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [pid, referralId]);

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
