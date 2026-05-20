import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import { useCareStore } from '../store/careStore.js';
import airtable from '../api/airtable.js';

// Hydrate all referrals from this source AND enrich each one with the
// associated patient's name + insurance + the most recent stage transition.
// We deliberately mirror useMarketerData / useFacilityData so the drawer
// has a consistent shape across the directory pages.
export function useReferralSourceData(source) {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (!source?.id) { setReferrals([]); return; }
    setLoading(true);

    getReferrals({ filterByFormula: `{referral_source_id} = "${source.id}"` })
      .then(async (refs) => {
        const rawRefs = refs.map((r) => ({ _id: r.id, ...r.fields }));

        const pids = [...new Set(rawRefs.map((r) => r.patient_id).filter(Boolean))];
        let patientMap = {};
        if (pids.length) {
          const formula = `OR(${pids.map((id) => `{id} = "${id}"`).join(',')})`;
          const pRecs = await airtable.fetchAll('Patients', { filterByFormula: formula }).catch(() => []);
          pRecs.forEach((r) => {
            const f = r.fields;
            patientMap[f.id] = {
              name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
              insurance_plan: f.insurance_plan || null,
              county: f.county || null,
            };
          });
        }

        setReferrals(rawRefs.map((r) => ({
          ...r,
          patientName:    patientMap[r.patient_id]?.name || null,
          insurance_plan: r.insurance_plan || patientMap[r.patient_id]?.insurance_plan || null,
          patient_county: patientMap[r.patient_id]?.county || null,
        })));
      })
      .catch(() => setReferrals([]))
      .finally(() => setLoading(false));
  }, [source?.id]);

  // Resolve the assigned marketer (in-memory) so the overview header has it.
  const storeMarketers = useCareStore((s) => s.marketers) || {};
  const marketer = source?.marketer_id
    ? Object.values(storeMarketers).find((m) => m.id === source.marketer_id) || null
    : null;

  const admitted = referrals.filter((r) => r.current_stage === 'SOC Completed').length;
  const ntuc     = referrals.filter((r) => r.current_stage === 'NTUC').length;
  const active   = referrals.filter((r) => r.current_stage !== 'SOC Completed' && r.current_stage !== 'NTUC').length;

  const stats = {
    total:    referrals.length,
    active,
    admitted,
    ntuc,
    convRate: referrals.length ? Math.round((admitted / referrals.length) * 100) : 0,
    lastReferral: referrals.reduce((latest, r) => {
      if (!r.referral_date) return latest;
      return !latest || new Date(r.referral_date) > new Date(latest) ? r.referral_date : latest;
    }, null),
    firstReferral: referrals.reduce((earliest, r) => {
      if (!r.referral_date) return earliest;
      return !earliest || new Date(r.referral_date) < new Date(earliest) ? r.referral_date : earliest;
    }, null),
  };

  // NTUC reason histogram (only counts rows currently in NTUC)
  const ntucReasons = referrals
    .filter((r) => r.current_stage === 'NTUC' && r.ntuc_reason)
    .reduce((acc, r) => { acc[r.ntuc_reason] = (acc[r.ntuc_reason] || 0) + 1; return acc; }, {});

  // Monthly referral volume (last 12 months, in chronological order)
  const monthly = (() => {
    const buckets = {};
    referrals.forEach((r) => {
      if (!r.referral_date) return;
      const d = new Date(r.referral_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = { key, total: 0, admitted: 0, ntuc: 0 };
      buckets[key].total++;
      if (r.current_stage === 'SOC Completed') buckets[key].admitted++;
      if (r.current_stage === 'NTUC') buckets[key].ntuc++;
    });
    return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  })();

  const stageBreakdown = referrals.reduce((acc, r) => {
    const s = r.current_stage || 'Unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const divisionBreakdown = referrals.reduce((acc, r) => {
    const d = r.division || 'Unspecified';
    acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});

  const insuranceBreakdown = referrals.reduce((acc, r) => {
    const p = r.insurance_plan || 'Unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  return {
    referrals,
    marketer,
    stats,
    ntucReasons,
    monthly,
    stageBreakdown,
    divisionBreakdown,
    insuranceBreakdown,
    loading,
  };
}
