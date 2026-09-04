import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import { getMarketerFacilities, getFacilities } from '../api/marketerFacilities.js';
import { useCareStore } from '../store/careStore.js';
// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from '../api/airtable.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { filterByDateRange } from '../components/common/DateRangeFilter.jsx';

export function useMarketerData(marketer, dateRange = null) {
  const [allReferrals, setAllReferrals] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const marketerId = String(marketer?.id || '').trim();
    if (!marketerId) return;
    setLoading(true);

    Promise.all([
      getReferrals({ filterByFormula: `{marketer_id} = "${marketerId}"` }),
      getMarketerFacilities(marketerId),
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
        setAllReferrals(rawRefs.map((r) => ({
          ...r,
          patientName: nameMap[r.patient_id] || null,
        })));

        const facilityMap = {};
        allFacilities.forEach((f) => {
          facilityMap[f.fields.id] = { _id: f.id, ...f.fields };
        });
        // Also include NetworkFacilities from the store so net_fac_* IDs resolve
        const storeNetFacs = useCareStore.getState().networkFacilities || {};
        Object.values(storeNetFacs).forEach((nf) => {
          if (nf.id && !facilityMap[nf.id]) {
            facilityMap[nf.id] = { ...nf, type: 'ALF' };
          }
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

  const referrals = filterByDateRange(allReferrals, dateRange, 'referral_date');

  const admittedCount = referrals.filter((r) => isSocCompletedReferral(r)).length;
  const stats = {
    total:      referrals.length,
    active:     referrals.filter((r) => !['NTUC', 'SOC Completed', 'Completed'].includes(r.current_stage)).length,
    admitted:   admittedCount,
    ntuc:       referrals.filter((r) => r.current_stage === 'NTUC').length,
    convRate:   referrals.length ? Math.round((admittedCount / referrals.length) * 100) : 0,
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
