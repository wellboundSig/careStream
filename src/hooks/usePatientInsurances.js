/**
 * usePatientInsurances — shared hook returning the canonical insurance set
 * for a patient straight from the `PatientInsurances` table.
 *
 * Every UI surface that displays insurance (Demographics editor in the
 * patient drawer, Eligibility workspace, Authorization picker) now reads
 * from this hook so the data shown is always identical and always fresh
 * after any sync.
 *
 * Subscribes to `useRefreshVersion()` so a write anywhere in the app that
 * calls `triggerDataRefresh()` causes every mounted reader to re-fetch.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRefreshVersion } from './useRefreshTrigger.js';
import { getInsurancesByPatient } from '../api/patientInsurances.js';

/**
 * @param {string} patientBusinessId  The `pat_…` id (Patients primary field)
 * @returns {{ rows: object[], loading: boolean, error: string|null, reload: () => void }}
 */
export function usePatientInsurances(patientBusinessId) {
  const refreshVersion = useRefreshVersion();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    if (!patientBusinessId) { setRows([]); return; }
    setLoading(true); setError(null);
    getInsurancesByPatient(patientBusinessId)
      .then((records) => setRows(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch((err) => setError(err?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [patientBusinessId]);

  useEffect(() => { reload(); }, [reload, refreshVersion]);

  return { rows, loading, error, reload };
}
