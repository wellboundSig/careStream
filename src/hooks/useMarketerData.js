import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import { getMarketerFacilities, getFacilities } from '../api/marketerFacilities.js';
import { useCareStore } from '../store/careStore.js';
import aurora from '../api/aurora.js';
import { filterByDateRange } from '../components/common/DateRangeFilter.jsx';
import {
  attributionMarketerId,
  summarizeMarketerReferrals,
} from '../utils/marketerPerformance.js';

export function useMarketerData(marketer, dateRange = null) {
  const [allReferrals, setAllReferrals] = useState([]);
  const [facilities, setFacilities] = useState([]);
  // Starts true so the drawer never flashes all-zero metrics before the fetch.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const marketerId = String(marketer?.id || '').trim();
    if (!marketerId) return;
    setLoading(true);

    Promise.all([
      // Fetch by current OR original assignment, then keep only rows CREDITED
      // to this marketer (originally assigned; reassignments don't move credit).
      getReferrals({ filterByFormula: `OR({marketer_id} = "${marketerId}", {original_marketer_id} = "${marketerId}")` }),
      getMarketerFacilities(marketerId),
      getFacilities(),
    ])
      .then(async ([refs, mfLinks, allFacilities]) => {
        const rawRefs = refs
          .map((r) => ({ _id: r.id, ...r.fields }))
          .filter((r) => attributionMarketerId(r) === marketerId);

        // Enrich with patient names (same approach as usePhysicianData)
        const pids = [...new Set(rawRefs.map((r) => r.patient_id).filter(Boolean))];
        let nameMap = {};
        if (pids.length) {
          const formula = `OR(${pids.map((id) => `{id} = "${id}"`).join(',')})`;
          const pRecs = await aurora.fetchAll('Patients', { filterByFormula: formula }).catch(() => []);
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

  // Incentive-program stats: SOC/NTUC bucketed by OUTCOME date within the
  // selected range; close rate = SOC ÷ (SOC + NTUC) — resolved only; open is
  // a current snapshot, never period-scoped. Computed over ALL attributed
  // referrals (not the referral_date-filtered list) so outcome dating works.
  const perf = summarizeMarketerReferrals(allReferrals, dateRange);
  const stats = {
    ...perf, // received, soc, ntuc, closed, closeRate, open, lastReferralDate
    // Legacy aliases still used by drawer tabs:
    total:      perf.received,
    active:     perf.open,
    admitted:   perf.soc,
    convRate:   perf.closeRate === null ? null : Math.round(perf.closeRate * 100),
    lastReferral: perf.lastReferralDate,
  };

  const ntucReasons = referrals
    .filter((r) => r.current_stage === 'NTUC' && r.ntuc_reason)
    .reduce((acc, r) => {
      acc[r.ntuc_reason] = (acc[r.ntuc_reason] || 0) + 1;
      return acc;
    }, {});

  return { referrals, facilities, stats, ntucReasons, loading };
}
