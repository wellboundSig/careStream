import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import { getMarketerFacilities, getFacilities } from '../api/marketerFacilities.js';
import airtable from '../api/airtable.js';

export function useMarketerData(marketer) {
  const [referrals, setReferrals] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!marketer?.id) return;
    setLoading(true);

    Promise.all([
      getReferrals({ filterByFormula: `{marketer_id} = "${marketer.id}"` }),
      getMarketerFacilities(marketer.id),
      getFacilities(),
    ])
      .then(async ([refs, mfLinks, allFacilities]) => {
        const rawRefs = refs.map((r) => ({ _id: r.id, ...r.fields }));

        // Enrich with patient names (same approach as usePhysicianData)
        const pids = [...new Set(rawRefs.map((r) => r.patient_id).filter(Boolean))];
        let nameMap = {};
        if (pids.length) {
          const formula = `OR(${pids.map((id) => `{id} = "${id}"`).join(',')})`;
          const pRecs = await airtable.fetchAll('Patients', { filterByFormula: formula }).catch(() => []);
          pRecs.forEach((r) => {
            nameMap[r.fields.id] = `${r.fields.first_name || ''} ${r.fields.last_name || ''}`.trim();
          });
        }
        setReferrals(rawRefs.map((r) => ({
          ...r,
          patientName: nameMap[r.patient_id] || null,
        })));

        const facilityMap = {};
        allFacilities.forEach((f) => {
          facilityMap[f.fields.id] = { _id: f.id, ...f.fields };
        });

        const linked = mfLinks.map((r) => ({
          ...r.fields,
          facility: facilityMap[r.fields.facility_id] || null,
        }));
        setFacilities(linked);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [marketer?.id]);

  const stats = {
    total:      referrals.length,
    active:     referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed').length,
    admitted:   referrals.filter((r) => r.current_stage === 'SOC Completed').length,
    ntuc:       referrals.filter((r) => r.current_stage === 'NTUC').length,
    convRate:   referrals.length ? Math.round((referrals.filter((r) => r.current_stage === 'SOC Completed').length / referrals.length) * 100) : 0,
    lastReferral: referrals.reduce((latest, r) => {
      if (!r.referral_date) return latest;
      return !latest || new Date(r.referral_date) > new Date(latest) ? r.referral_date : latest;
    }, null),
  };

  const ntucReasons = referrals
    .filter((r) => r.current_stage === 'NTUC' && r.ntuc_reason)
    .reduce((acc, r) => {
      acc[r.ntuc_reason] = (acc[r.ntuc_reason] || 0) + 1;
      return acc;
    }, {});

  return { referrals, facilities, stats, ntucReasons, loading };
}
