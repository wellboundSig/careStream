/**
 * Known guardian helpers — create/reuse people + dual-write patient mirrors.
 * Never blanks existing patient contact fields unless the user clears them.
 */

import {
  createKnownGuardian,
  updateKnownGuardian,
  createPatientGuardian,
  updatePatientGuardian,
  getPatientGuardians,
} from '../api/knownGuardians.js';
import { updatePatient } from '../api/patients.js';
import { mergeEntities, updateEntity, getStore } from '../store/careStore.js';
import { normalizeContactName } from './personName.js';
import {
  normalizeGuardianRelationship,
  splitContactNameAndRelationship,
} from '../data/guardianRelationships.js';

function digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 10);
}

/** Browser autofill often drops a marketer's Wellbound address into caregiver email. */
export function isStaffDirectoryEmail(email) {
  return /@wellboundhc\.com$/i.test(String(email || '').trim());
}

function splitDisplayName(displayName) {
  const clean = normalizeContactName(displayName);
  if (!clean) return { first_name: '', last_name: '', display_name: '' };
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { first_name: '', last_name: parts[0], display_name: parts[0] };
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
    display_name: clean,
  };
}

function guardianDisplay(g) {
  if (!g) return '';
  return g.display_name
    || `${g.first_name || ''} ${g.last_name || ''}`.trim()
    || '';
}

/**
 * Find an existing known guardian by phone (preferred) or exact display name.
 */
export function findKnownGuardianMatch({ phone, displayName }, store = getStore()) {
  const list = Object.values(store.knownGuardians || {});
  const phoneKey = digits(phone);
  if (phoneKey.length >= 10) {
    const byPhone = list.find((g) => digits(g.phone) === phoneKey && g.is_active !== false);
    if (byPhone) return byPhone;
  }
  const nameKey = normalizeContactName(displayName).toLowerCase();
  if (nameKey) {
    return list.find((g) => guardianDisplay(g).toLowerCase() === nameKey && g.is_active !== false) || null;
  }
  return null;
}

/**
 * Ensure a known_guardians row exists for this person. Reuses by phone/name.
 * Returns the guardian record (with .id business id and ._id rec id).
 */
export async function upsertKnownGuardian({ name, phone, email }) {
  const { cleanName } = splitContactNameAndRelationship(name);
  const display = normalizeContactName(cleanName);
  if (!display && !digits(phone)) return null;

  const existing = findKnownGuardianMatch({ phone, displayName: display });
  if (existing) {
    const patch = {};
    if (display && !guardianDisplay(existing)) patch.display_name = display;
    if (digits(phone) && !digits(existing.phone)) patch.phone = digits(phone);
    if (email && !existing.email) patch.email = String(email).trim();
    // Explicit empty from the form: drop a staff autofill so delete+save sticks.
    if (email !== undefined && !String(email || '').trim() && isStaffDirectoryEmail(existing.email)) {
      patch.email = '';
    }
    if (Object.keys(patch).length && existing._id) {
      const names = splitDisplayName(display || guardianDisplay(existing));
      const fields = { ...patch, ...names, updated_at: new Date().toISOString() };
      await updateKnownGuardian(existing._id, fields);
      updateEntity('knownGuardians', existing._id, fields);
      return { ...existing, ...fields };
    }
    return existing;
  }

  const names = splitDisplayName(display);
  const fields = {
    id: `grd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ...names,
    phone: digits(phone) || '',
    email: email ? String(email).trim() : '',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const rec = await createKnownGuardian(fields);
  const normalized = { _id: rec.id, ...rec.fields };
  mergeEntities('knownGuardians', { [rec.id]: normalized });
  return normalized;
}

function linksForPatient(patientBusinessId, store = getStore()) {
  return Object.values(store.patientGuardians || {})
    .filter((l) => l.patient_id === patientBusinessId);
}

/**
 * Attach (or update) a guardian on a patient for primary and/or emergency slots.
 * Dual-writes flat patient.*_contact_* mirrors. Does not wipe other slot.
 */
export async function linkGuardianToPatient({
  patientBusinessId,
  patientRecordId,
  guardian,
  relationship,
  isPrimary = false,
  isEmergency = false,
  source = 'patient_demographics',
}) {
  if (!patientBusinessId || !guardian?.id) return null;
  const store = getStore();
  const existing = linksForPatient(patientBusinessId, store)
    .find((l) => l.guardian_id === guardian.id);

  const rel = normalizeGuardianRelationship(relationship) || relationship || '';
  const now = new Date().toISOString();

  let link;
  if (existing?._id) {
    const fields = {
      relationship: rel || existing.relationship || '',
      is_primary: isPrimary || existing.is_primary === true || existing.is_primary === 'true',
      is_emergency: isEmergency || existing.is_emergency === true || existing.is_emergency === 'true',
      source: existing.source || source,
      updated_at: now,
    };
    // Explicit slot assignment from caller wins when true; when false and
    // this call is only for one slot, don't clear the other.
    if (isPrimary) fields.is_primary = true;
    if (isEmergency) fields.is_emergency = true;
    await updatePatientGuardian(existing._id, fields);
    updateEntity('patientGuardians', existing._id, fields);
    link = { ...existing, ...fields };
  } else {
    const fields = {
      id: `pgrd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      patient_id: patientBusinessId,
      guardian_id: guardian.id,
      relationship: rel,
      is_primary: !!isPrimary,
      is_emergency: !!isEmergency,
      source,
      created_at: now,
      updated_at: now,
    };
    const rec = await createPatientGuardian(fields).catch(async (err) => {
      // Unique (patient_id, guardian_id) — link exists on the server but the
      // local store missed it (hydrate lag / other tab). Update instead of 500.
      const rows = await getPatientGuardians({
        filterByFormula: `AND({patient_id} = "${patientBusinessId}", {guardian_id} = "${guardian.id}")`,
        maxRecords: 1,
      }).catch(() => []);
      const hit = rows?.[0];
      if (!hit?.id) throw err;
      const patch = {
        relationship: rel || '',
        is_primary: !!isPrimary,
        is_emergency: !!isEmergency,
        source,
        updated_at: now,
      };
      await updatePatientGuardian(hit.id, patch);
      return { id: hit.id, fields: { ...hit.fields, ...patch } };
    });
    link = { _id: rec.id, ...rec.fields };
    mergeEntities('patientGuardians', { [rec.id]: link });
  }

  // Clear this slot flag on OTHER links for the same patient (one primary / one emergency)
  const others = linksForPatient(patientBusinessId, getStore())
    .filter((l) => l.guardian_id !== guardian.id);
  for (const other of others) {
    const patch = {};
    if (isPrimary && (other.is_primary === true || other.is_primary === 'true')) patch.is_primary = false;
    if (isEmergency && (other.is_emergency === true || other.is_emergency === 'true')) patch.is_emergency = false;
    if (Object.keys(patch).length && other._id) {
      patch.updated_at = now;
      await updatePatientGuardian(other._id, patch).catch(() => {});
      updateEntity('patientGuardians', other._id, patch);
    }
  }

  await syncPatientContactMirrors(patientBusinessId, patientRecordId);
  return link;
}

/**
 * Rebuild patient flat contact mirrors from patient_guardians links.
 * Preserves values when no link exists for a slot (never wipe on empty graph).
 */
export async function syncPatientContactMirrors(patientBusinessId, patientRecordId) {
  const store = getStore();
  const patient = Object.values(store.patients || {})
    .find((p) => p.id === patientBusinessId || p._id === patientRecordId);
  if (!patient?._id) return;

  const links = linksForPatient(patientBusinessId, store);
  const guardians = store.knownGuardians || {};
  const byId = (gid) => Object.values(guardians).find((g) => g.id === gid);

  const primaryLink = links.find((l) => l.is_primary === true || l.is_primary === 'true');
  const emergencyLink = links.find((l) => l.is_emergency === true || l.is_emergency === 'true');

  const patch = {};
  if (primaryLink) {
    const g = byId(primaryLink.guardian_id);
    if (g) {
      patch.primary_contact_name = guardianDisplay(g);
      patch.primary_contact_phone = digits(g.phone) || patient.primary_contact_phone || '';
      if (g.email && !isStaffDirectoryEmail(g.email)) {
        const current = String(patient.primary_contact_email || '').trim();
        if (!current || current === String(g.email).trim()) {
          patch.primary_contact_email = g.email;
        }
      }
      if (primaryLink.relationship) patch.primary_contact_relationship = primaryLink.relationship;
    }
  }
  if (emergencyLink) {
    const g = byId(emergencyLink.guardian_id);
    if (g) {
      patch.emergency_contact_name = guardianDisplay(g);
      patch.emergency_contact_phone = digits(g.phone) || patient.emergency_contact_phone || '';
      if (g.email && !isStaffDirectoryEmail(g.email)) {
        const current = String(patient.emergency_contact_email || '').trim();
        if (!current || current === String(g.email).trim()) {
          patch.emergency_contact_email = g.email;
        }
      }
      if (emergencyLink.relationship) patch.emergency_contact_relationship = emergencyLink.relationship;
    }
  }

  if (!Object.keys(patch).length) return;
  patch.updated_at = new Date().toISOString();
  updateEntity('patients', patient._id, patch);
  await updatePatient(patient._id, patch);
}

/**
 * High-level: save a contact slot from the form into guardians + patient mirrors.
 * `slot` is 'primary' | 'emergency'.
 */
export async function savePatientContactSlot({
  patientBusinessId,
  patientRecordId,
  slot,
  name,
  phone,
  email,
  relationship,
  source = 'patient_demographics',
}) {
  const parsed = splitContactNameAndRelationship(name);
  const rel = normalizeGuardianRelationship(relationship) || parsed.relationship || '';
  const display = normalizeContactName(parsed.cleanName);

  // Clearing the slot: update mirrors only; leave guardian directory rows intact.
  if (!display && !digits(phone)) {
    const clearPatch = slot === 'primary'
      ? {
          primary_contact_name: '',
          primary_contact_phone: '',
          primary_contact_email: '',
          primary_contact_relationship: '',
        }
      : {
          emergency_contact_name: '',
          emergency_contact_phone: '',
          emergency_contact_email: '',
          emergency_contact_relationship: '',
        };
    if (patientRecordId) {
      updateEntity('patients', patientRecordId, clearPatch);
      await updatePatient(patientRecordId, clearPatch);
    }
    // Clear slot flags on links
    const links = linksForPatient(patientBusinessId);
    for (const l of links) {
      const isOn = slot === 'primary'
        ? (l.is_primary === true || l.is_primary === 'true')
        : (l.is_emergency === true || l.is_emergency === 'true');
      if (!isOn || !l._id) continue;
      const patch = slot === 'primary' ? { is_primary: false } : { is_emergency: false };
      patch.updated_at = new Date().toISOString();
      await updatePatientGuardian(l._id, patch).catch(() => {});
      updateEntity('patientGuardians', l._id, patch);
    }
    return null;
  }

  const guardian = await upsertKnownGuardian({
    name: display,
    phone,
    email,
  });
  if (!guardian) return null;

  return linkGuardianToPatient({
    patientBusinessId,
    patientRecordId,
    guardian,
    relationship: rel,
    isPrimary: slot === 'primary',
    isEmergency: slot === 'emergency',
    source,
  });
}

/**
 * Other Lead Entry referrals that share a known guardian with this patient.
 */
export function findSiblingLeadReferrals(referral, store = getStore()) {
  if (!referral?.patient_id) return [];
  const myGuardianIds = new Set(
    linksForPatient(referral.patient_id, store).map((l) => l.guardian_id).filter(Boolean),
  );
  if (myGuardianIds.size === 0) {
    // Fallback: match by dual-write phone mirrors when links aren't hydrated yet
    const me = Object.values(store.patients || {}).find((p) => p.id === referral.patient_id);
    const phones = [digits(me?.primary_contact_phone), digits(me?.emergency_contact_phone)]
      .filter((p) => p.length >= 10);
    if (!phones.length) return [];
    return Object.values(store.referrals || {}).filter((r) => {
      if (r._id === referral._id || r.id === referral.id) return false;
      if (r.current_stage !== 'Lead Entry') return false;
      const p = Object.values(store.patients || {}).find((x) => x.id === r.patient_id);
      if (!p) return false;
      const theirs = [digits(p.primary_contact_phone), digits(p.emergency_contact_phone)];
      return theirs.some((t) => phones.includes(t));
    });
  }

  const patientIdsWithShared = new Set();
  Object.values(store.patientGuardians || {}).forEach((l) => {
    if (myGuardianIds.has(l.guardian_id) && l.patient_id !== referral.patient_id) {
      patientIdsWithShared.add(l.patient_id);
    }
  });

  return Object.values(store.referrals || {}).filter((r) => {
    if (r._id === referral._id || r.id === referral.id) return false;
    if (r.current_stage !== 'Lead Entry') return false;
    return patientIdsWithShared.has(r.patient_id);
  });
}

/**
 * Push triage caregiver / emergency fields into known_guardians + links.
 * Dual-writes patient mirrors. Safe to call on every triage save.
 */
export async function syncTriageCaregiversToGuardians({ patient, triageType, data }) {
  if (!patient?.id || !patient?._id || !data) return;
  const source = triageType === 'adult' ? 'triage_adult' : 'triage_pediatric';

  if (triageType === 'pediatric') {
    if (data.primary_caregiver_name || data.primary_caregiver_phone) {
      await savePatientContactSlot({
        patientBusinessId: patient.id,
        patientRecordId: patient._id,
        slot: 'primary',
        name: data.primary_caregiver_name,
        phone: data.primary_caregiver_phone,
        relationship: '',
        source,
      });
    }
    const same = String(data.emergency_same_as_primary || '').toLowerCase() === 'yes'
      || data.emergency_same_as_primary === true;
    const ecName = same ? data.primary_caregiver_name : data.emergency_contact_name;
    const ecPhone = same ? data.primary_caregiver_phone : data.emergency_contact_phone;
    if (ecName || ecPhone) {
      await savePatientContactSlot({
        patientBusinessId: patient.id,
        patientRecordId: patient._id,
        slot: 'emergency',
        name: ecName,
        phone: ecPhone,
        relationship: '',
        source,
      });
    }
    // Secondary caregiver → directory + link (neither primary nor emergency unless alone)
    if (data.secondary_caregiver_name || data.secondary_caregiver_phone) {
      const g = await upsertKnownGuardian({
        name: data.secondary_caregiver_name,
        phone: data.secondary_caregiver_phone,
      });
      if (g) {
        await linkGuardianToPatient({
          patientBusinessId: patient.id,
          patientRecordId: patient._id,
          guardian: g,
          relationship: '',
          isPrimary: false,
          isEmergency: false,
          source,
        });
      }
    }
    return;
  }

  // Adult triage
  if (data.caregiver_name || data.caregiver_phone) {
    await savePatientContactSlot({
      patientBusinessId: patient.id,
      patientRecordId: patient._id,
      slot: 'primary',
      name: data.caregiver_name,
      phone: data.caregiver_phone,
      email: data.caregiver_email,
      relationship: '',
      source,
    });
  }
  if (data.secondary_caregiver_name || data.secondary_caregiver_phone) {
    const g = await upsertKnownGuardian({
      name: data.secondary_caregiver_name,
      phone: data.secondary_caregiver_phone,
    });
    if (g) {
      await linkGuardianToPatient({
        patientBusinessId: patient.id,
        patientRecordId: patient._id,
        guardian: g,
        relationship: '',
        isPrimary: false,
        isEmergency: false,
        source,
      });
    }
  }
}

export { guardianDisplay, digits as guardianPhoneDigits };
