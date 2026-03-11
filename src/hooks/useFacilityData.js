import { useState, useEffect } from 'react';
import { getReferrals } from '../api/referrals.js';
import { getMarketerFacilities } from '../api/marketerFacilities.js';
import { getMarketers } from '../api/marketers.js';

export function useFacilityData(facility) {
  const [referrals, setReferrals] = useState([]);
  const [marketerLinks, setMarketerLinks] = useState([]);
  const [marketerDetails, setMarketerDetails] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!facility?.id) return;
    setLoading(true);

    Promise.all([
      getReferrals({ filterByFormula: `{facility_id} = "${facility.id}"` }),
      getMarketerFacilities(facility.id),
      getMarketers(),
    ])
      .then(async ([refs, links, mkts]) => {
        const rawRefs = refs.map((r) => ({ _id: r.id, ...r.fields }));

        // Enrich with patient names
        const uniquePids = [...new Set(rawRefs.map((r) => r.patient_id).filter(Boolean))];
        let patientNameMap = {};
        if (uniquePids.length) {
          const formula = `OR(${uniquePids.map((id) => `{id} = "${id}"`).join(',')})`;
          const pRecs = await import('../api/airtable.js').then((m) =>
            m.default.fetchAll('Patients', { filterByFormula: formula })
          ).catch(() => []);
          pRecs.forEach((r) => {
            patientNameMap[r.fields.id] = `${r.fields.first_name || ''} ${r.fields.last_name || ''}`.trim();
          });
        }
        setReferrals(rawRefs.map((r) => ({ ...r, patientName: patientNameMap[r.patient_id] || r.patient_id })));
        setMarketerLinks(links.map((r) => ({ _id: r.id, ...r.fields })));
        const map = {};
        mkts.forEach((r) => { const f = r.fields; if (f.id) map[f.id] = { _id: r.id, ...f }; });
        setMarketerDetails(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [facility?.id]);

  const stats = {
    total:    referrals.length,
    active:   referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed').length,
    admitted: referrals.filter((r) => r.current_stage === 'SOC Completed').length,
    ntuc:     referrals.filter((r) => r.current_stage === 'NTUC').length,
  };

  const liaison = marketerLinks.find((l) => l.is_primary === true || l.is_primary === 'true');
  const liaisonMarketer = liaison ? marketerDetails[liaison.marketer_id] : null;

  return { referrals, marketerLinks, marketerDetails, stats, liaisonMarketer, loading };
}
