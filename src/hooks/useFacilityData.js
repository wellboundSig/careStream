import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

/** Network facility business ids look like net_fac_001. */
export function isNetworkFacility(facility) {
  if (!facility) return false;
  if (typeof facility.id === 'string' && facility.id.startsWith('net_fac_')) return true;
  // Heuristic fallback: network rows use `zipcode` (not address_zip) and omit city/state.
  return (
    facility.zipcode != null
    && facility.address_zip == null
    && facility.address_city == null
  );
}

export function useFacilityData(facility) {
  const storeReferrals = useCareStore((s) => s.referrals) || {};
  const storePatients = useCareStore((s) => s.patients) || {};
  const storeMF = useCareStore((s) => s.marketerFacilities) || {};
  const storeMarketers = useCareStore((s) => s.marketers) || {};
  const storeCoc = useCareStore((s) => s.cocNurseFacilities) || {};
  const storeUsers = useCareStore((s) => s.users) || {};

  const facilityId = facility?.id || null;
  const network = isNetworkFacility(facility);

  const { referrals, marketerLinks, marketerDetails, cocNurses } = useMemo(() => {
    if (!facilityId) {
      return { referrals: [], marketerLinks: [], marketerDetails: {}, cocNurses: [] };
    }

    const refs = Object.values(storeReferrals)
      .filter((r) => r.facility_id === facilityId)
      .map((r) => {
        const p = Object.values(storePatients).find((pt) => pt.id === r.patient_id);
        const patientName = p
          ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
          : r.patient_id;
        return { ...r, patientName };
      })
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const marketerDetails = {};
    Object.values(storeMarketers).forEach((m) => {
      if (m.id) marketerDetails[m.id] = m;
    });

    let marketerLinks = [];
    if (network) {
      if (facility.marketer_id) {
        marketerLinks = [{
          _id: `net_mkt_${facilityId}`,
          facility_id: facilityId,
          marketer_id: facility.marketer_id,
          is_primary: true,
        }];
      }
    } else {
      marketerLinks = Object.values(storeMF)
        .filter((mf) => mf.facility_id === facilityId)
        .map((mf) => ({ ...mf }));
    }

    const cocNurses = Object.values(storeCoc)
      .filter((c) => c.facility_id === facilityId)
      .map((c) => {
        const u = Object.values(storeUsers).find((user) => user.id === c.user_id);
        return {
          ...c,
          userName: u
            ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
            : c.user_id,
        };
      });

    return { referrals: refs, marketerLinks, marketerDetails, cocNurses };
  }, [
    facilityId,
    network,
    facility?.marketer_id,
    storeReferrals,
    storePatients,
    storeMF,
    storeMarketers,
    storeCoc,
    storeUsers,
  ]);

  const stats = {
    total: referrals.length,
    active: referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed').length,
    admitted: referrals.filter((r) => r.current_stage === 'SOC Completed').length,
    ntuc: referrals.filter((r) => r.current_stage === 'NTUC').length,
  };

  const liaison = marketerLinks.find((l) => l.is_primary === true || l.is_primary === 'true')
    || marketerLinks[0];
  const liaisonMarketer = liaison ? marketerDetails[liaison.marketer_id] : null;

  return {
    referrals,
    marketerLinks,
    marketerDetails,
    cocNurses,
    stats,
    liaisonMarketer,
    loading: false,
    isNetwork: network,
  };
}
