import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import airtable from '../api/airtable.js';

export function usePhysicianData(physician) {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!physician?.id) return;
    setReferrals([]); // clear stale data immediately so stats don't show from previous physician
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
        setReferrals(rawRefs.map((r) => ({ ...r, patientName: nameMap[r.patient_id] || r.patient_id })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [physician?.id]);

  const stats = {
    total:    referrals.length,
    active:   referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed').length,
    admitted: referrals.filter((r) => r.current_stage === 'SOC Completed').length,
  };

  return { referrals, stats, loading };
}
