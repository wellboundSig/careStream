import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from '../api/airtable.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { filterByDateRange } from '../components/common/DateRangeFilter.jsx';

export function usePhysicianData(physician, dateRange = null) {
  const [allReferrals, setAllReferrals] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!physician?.id) return;
    setAllReferrals([]); // clear stale data immediately so stats don't show from previous physician
    setLoading(true);

    getReferrals({ filterByFormula: `{physician_id} = "${physician.id}"` })
      .then(async (refs) => {
        const rawRefs = refs.map((r) => ({ _id: r.id, ...r.fields }));

        // Enrich with patient names
        const pids = [...new Set(rawRefs.map((r) => r.patient_id).filter(Boolean))];
        let nameMap = {};
        if (pids.length) {
          const formula = `OR(${pids.map((id) => `{id} = "${id}"`).join(',')})`;
          const pRecs = await airtable.fetchAll('Patients', { filterByFormula: formula }).catch(() => []);
          pRecs.forEach((r) => {
            nameMap[r.fields.id] = `${r.fields.first_name || ''} ${r.fields.last_name || ''}`.trim();
          });
        }
        setAllReferrals(rawRefs.map((r) => ({ ...r, patientName: nameMap[r.patient_id] || r.patient_id })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [physician?.id]);

  const referrals = filterByDateRange(allReferrals, dateRange, 'referral_date');

  const stats = {
    total:    referrals.length,
    active:   referrals.filter((r) => !['NTUC', 'SOC Completed', 'Completed'].includes(r.current_stage)).length,
    admitted: referrals.filter((r) => isSocCompletedReferral(r)).length,
  };

  return { referrals, stats, loading };
}
