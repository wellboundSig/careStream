/**
 * Shared data hook for the OPWDD workspace.
 *
 * Used by BOTH the drawer tab (if mounted) and the module-page panel. Both
 * subscribe to useRefreshVersion() so any write that calls
 * triggerDataRefresh() causes every mounted workspace to re-fetch.
 *
 * Source of truth is the Airtable Meta API, not the hydrated store, because:
 *   1. Freshly created cases (from NewReferralForm or routing from
 *      Eligibility) may not have hit the store yet.
 *   2. We need the exact record ids (.id) for link/update writes.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRefreshVersion } from '../../../hooks/useRefreshTrigger.js';
import { getOpwddCaseByReferral } from '../../../api/opwddCases.js';
import { getChecklistItemsByCase } from '../../../api/opwddChecklistItems.js';
import { getFilesByPatient } from '../../../api/patientFiles.js';
import { OPWDD_CASE_STATUS } from '../../../data/opwddEnums.js';

export function useOpwddData({ patientId, referralId }) {
  const refreshVersion = useRefreshVersion();

  const [cases,          setCases]          = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [opwddFiles,     setOpwddFiles]     = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);

  const reload = useCallback(() => {
    if (!referralId) {
      setCases([]); setChecklistItems([]); setOpwddFiles([]);
      return;
    }
    setLoading(true);
    setError(null);

    getOpwddCaseByReferral(referralId)
      .then(async (caseRecs) => {
        const casesMapped = caseRecs.map((r) => ({ _id: r.id, ...r.fields }));
        setCases(casesMapped);

        const active = casesMapped.find((c) => {
          const s = c.status;
          return s !== OPWDD_CASE_STATUS.CLOSED
              && s !== OPWDD_CASE_STATUS.CANCELLED
              && s !== OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE;
        }) || casesMapped[0];

        if (active?.id) {
          const items = await getChecklistItemsByCase(active.id).catch(() => []);
          setChecklistItems(items.map((r) => ({ _id: r.id, ...r.fields })));
        } else {
          setChecklistItems([]);
        }

        if (patientId) {
          const files = await getFilesByPatient(patientId).catch(() => []);
          setOpwddFiles(files.map((r) => ({ _id: r.id, ...r.fields })));
        }
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [patientId, referralId]);

  useEffect(() => { reload(); }, [reload, refreshVersion]);

  const activeCase = cases.find((c) => {
    const s = c.status;
    return s !== OPWDD_CASE_STATUS.CLOSED
        && s !== OPWDD_CASE_STATUS.CANCELLED
        && s !== OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE;
  }) || cases[0] || null;

  return {
    loading,
    error,
    cases,
    activeCase,
    checklistItems,
    opwddFiles,
    reload,
  };
}
