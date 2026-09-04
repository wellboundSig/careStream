/**
 * Per-case reconciliation when a referral's facility changes.
 *
 * Facility defaults (primary marketer, COC nurse, entity, ALF address) are
 * never applied silently. Each difference is classified so the actor can
 * keep the current assignment, adopt the new facility default, pick another
 * linked person, or clear.
 */

import { lookupZip } from './validation.js';

export function idsEqual(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

export function isPrimaryFlag(v) {
  return v === true || v === 'true';
}

function trimId(v) {
  return String(v || '').trim();
}

export function marketerLinksForFacility(facilityId, marketerFacilities, facility) {
  const fid = trimId(facilityId);
  if (!fid) return [];

  const tableLinks = Object.values(marketerFacilities || {})
    .filter((mf) => idsEqual(mf.facility_id, fid) && trimId(mf.marketer_id));

  if (tableLinks.length) return tableLinks;

  const direct = trimId(facility?.marketer_id);
  if (direct) {
    return [{
      facility_id: fid,
      marketer_id: direct,
      is_primary: true,
    }];
  }
  return [];
}

export function primaryMarketerIdForFacility(facilityId, marketerFacilities, facility) {
  const links = marketerLinksForFacility(facilityId, marketerFacilities, facility);
  const primary = links.find((l) => isPrimaryFlag(l.is_primary));
  if (primary) return trimId(primary.marketer_id);
  if (links.length === 1) return trimId(links[0].marketer_id);
  return '';
}

export function cocNurseIdsForFacility(facilityId, cocNurseFacilities) {
  const fid = trimId(facilityId);
  if (!fid) return [];
  const seen = new Set();
  const ids = [];
  for (const row of Object.values(cocNurseFacilities || {})) {
    if (!idsEqual(row.facility_id, fid)) continue;
    const uid = trimId(row.user_id);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    ids.push(uid);
  }
  return ids;
}

export function suggestedEntityId(facility) {
  return trimId(facility?.entity_id || facility?.entity);
}

export function formatStreetZip(street, zip, city, state) {
  const line = [trimId(street), [trimId(city), trimId(state)].filter(Boolean).join(', '), trimId(zip)]
    .filter(Boolean)
    .join(', ');
  return line;
}

export function addressFromFacility(facility) {
  if (!facility) return { street: '', zip: '', city: '', state: '', label: '' };
  const street = trimId(facility.address_street);
  const zip = facility.zipcode != null
    ? String(facility.zipcode).trim()
    : trimId(facility.address_zip);
  let city = trimId(facility.address_city);
  let state = trimId(facility.address_state);
  if (zip && (!city || !state)) {
    const info = lookupZip(zip);
    if (info.valid) {
      city = city || info.city;
      state = state || info.state;
    }
  }
  return {
    street,
    zip,
    city,
    state,
    label: formatStreetZip(street, zip, city, state),
  };
}

export function addressFromPatient(patient) {
  if (!patient) return { street: '', zip: '', city: '', state: '', label: '' };
  const street = trimId(patient.address_street);
  const zip = trimId(patient.address_zip);
  const city = trimId(patient.address_city);
  const state = trimId(patient.address_state);
  return {
    street,
    zip,
    city,
    state,
    label: formatStreetZip(street, zip, city, state),
  };
}

/**
 * @param {string} current
 * @param {string} suggested
 * @returns {'match'|'conflict'|'keep_only'|'adopt_only'|'none'}
 */
export function classifyAssignment(current, suggested) {
  const cur = trimId(current);
  const sug = trimId(suggested);
  if (cur && sug && idsEqual(cur, sug)) return 'match';
  if (cur && sug) return 'conflict';
  if (cur && !sug) return 'keep_only';
  if (!cur && sug) return 'adopt_only';
  return 'none';
}

/**
 * Conflict / empty-current-with-default must be chosen explicitly.
 * keep_only, match, and none do not block submit (keep is implied).
 */
export function rowNeedsDecision(row) {
  if (!row) return false;
  if (row.status === 'conflict' || row.status === 'adopt_only') return true;
  if (row.key === 'coc_nurse' && row.status === 'pick' ) return true;
  return false;
}

export function unresolvedDecisionKeys(preview, decisions = {}) {
  if (!preview?.rows) return [];
  return preview.rows
    .filter(rowNeedsDecision)
    .filter((row) => {
      const d = decisions[row.key];
      if (!d?.action) return true;
      if (d.action === 'custom' && !trimId(d.value)) return true;
      if (d.action === 'adopt' && !trimId(row.suggestedValue) && row.key !== 'address') return true;
      return false;
    })
    .map((row) => row.key);
}

function personRow({
  key,
  field,
  label,
  currentValue,
  suggestedValue,
  candidates = [],
}) {
  let status = classifyAssignment(currentValue, suggestedValue);
  if (key === 'coc_nurse' && !suggestedValue && candidates.length > 1) {
    const stillValid = candidates.some((id) => idsEqual(id, currentValue));
    status = stillValid ? 'keep_only' : 'pick';
  }
  return {
    key,
    field,
    label,
    currentValue: trimId(currentValue),
    suggestedValue: trimId(suggestedValue),
    status,
    candidates,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.referral
 * @param {object} [opts.patient]
 * @param {object} opts.newFacility — NetworkFacilities / Facilities row
 * @param {object} [opts.marketerFacilities]
 * @param {object} [opts.cocNurseFacilities]
 */
export function buildFacilityReconciliation({
  referral,
  patient,
  newFacility,
  marketerFacilities,
  cocNurseFacilities,
}) {
  const newFacilityId = trimId(newFacility?.id);
  const currentFacilityId = trimId(referral?.facility_id);
  const marketerLinks = marketerLinksForFacility(newFacilityId, marketerFacilities, newFacility);
  const marketerCandidates = [...new Set(marketerLinks.map((l) => trimId(l.marketer_id)).filter(Boolean))];
  const cocCandidates = cocNurseIdsForFacility(newFacilityId, cocNurseFacilities);
  const suggestedMarketer = primaryMarketerIdForFacility(newFacilityId, marketerFacilities, newFacility);
  const suggestedCoc = cocCandidates.length === 1 ? cocCandidates[0] : '';
  const suggestedEntity = suggestedEntityId(newFacility);
  const currentAddress = addressFromPatient(patient);
  const suggestedAddress = addressFromFacility(newFacility);

  const rows = [
    personRow({
      key: 'marketer',
      field: 'marketer_id',
      label: 'Primary marketer',
      currentValue: referral?.marketer_id,
      suggestedValue: suggestedMarketer,
      candidates: marketerCandidates,
    }),
    personRow({
      key: 'coc_nurse',
      field: 'coc_nurse_id',
      label: 'COC nurse',
      currentValue: referral?.coc_nurse_id,
      suggestedValue: suggestedCoc,
      candidates: cocCandidates,
    }),
    personRow({
      key: 'entity',
      field: 'entity_id',
      label: 'Entity',
      currentValue: referral?.entity_id,
      suggestedValue: suggestedEntity,
    }),
  ];

  if (suggestedAddress.label) {
    const addressMatch = idsEqual(currentAddress.label, suggestedAddress.label)
      || (
        idsEqual(currentAddress.street, suggestedAddress.street)
        && idsEqual(currentAddress.zip, suggestedAddress.zip)
      );
    rows.push({
      key: 'address',
      field: 'address',
      label: 'Patient address',
      currentValue: currentAddress.label,
      suggestedValue: suggestedAddress.label,
      status: addressMatch ? 'match' : (currentAddress.label ? 'conflict' : 'adopt_only'),
      currentAddress,
      suggestedAddress,
      candidates: [],
    });
  }

  return {
    currentFacilityId,
    newFacilityId,
    newFacilityName: trimId(newFacility?.name) || newFacilityId,
    sameFacility: !!currentFacilityId && idsEqual(currentFacilityId, newFacilityId),
    rows,
  };
}

/**
 * @param {object} preview — from buildFacilityReconciliation
 * @param {object} decisions — { [rowKey]: { action: 'keep'|'adopt'|'custom'|'clear', value?: string } }
 */
export function applyReconciliationDecisions(preview, decisions = {}) {
  const referralFields = {
    facility_id: preview.newFacilityId,
  };
  let patientFields = null;
  const summary = [];

  for (const row of preview.rows || []) {
    const impliedKeep = !rowNeedsDecision(row);
    const d = decisions[row.key] || (impliedKeep ? { action: 'keep' } : null);
    if (!d) continue;

    if (row.key === 'address') {
      if (d.action === 'adopt' && row.suggestedAddress) {
        const a = row.suggestedAddress;
        patientFields = {
          address_street: a.street || '',
          address_zip: a.zip || '',
          address_city: a.city || '',
          address_state: a.state || '',
        };
        summary.push(`Address: ${row.currentValue || '—'} → ${a.label || 'facility address'}`);
      } else {
        summary.push(`Address: kept ${row.currentValue || '—'}`);
      }
      continue;
    }

    let next = row.currentValue;
    if (d.action === 'adopt') next = row.suggestedValue;
    else if (d.action === 'custom') next = trimId(d.value);
    else if (d.action === 'clear') next = '';
    else next = row.currentValue;

    if (!idsEqual(next, row.currentValue)) {
      referralFields[row.field] = next;
      summary.push(`${row.label}: ${row.currentValue || '—'} → ${next || '—'}`);
    } else {
      summary.push(`${row.label}: kept ${row.currentValue || '—'}`);
    }
  }

  return { referralFields, patientFields, summary };
}
