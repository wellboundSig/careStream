import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import {
  GUARDIAN_RELATIONSHIPS,
  normalizeGuardianRelationship,
  splitContactNameAndRelationship,
} from '../../data/guardianRelationships.js';
import { guardianDisplay, guardianPhoneDigits } from '../../utils/knownGuardians.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Primary caregiver + emergency contact (known guardians).
 * Inline layout: light fields under Patient, not a heavy dual card.
 */
export default function GuardianContactFields({
  value,
  onChange,
  showEmail = true,
  compact = false,
  /** When true, primary is shown as a light inline block (Overview). */
  inline = false,
}) {
  const v = value || {};
  const [pickerSlot, setPickerSlot] = useState(null); // 'primary' | 'emergency' | null

  const primary = v.primary || {};
  const emergency = v.emergency || {};
  const sameAsPrimary = isSameAsPrimary(emergency, primary) || !!emergency.same_as_primary;

  function setSlot(slot, patch) {
    onChange?.({
      ...v,
      [slot]: { ...(v[slot] || {}), ...patch },
    });
  }

  function applyGuardian(slot, guardian, relationship) {
    const next = {
      name: guardianDisplay(guardian),
      phone: guardianPhoneDigits(guardian.phone) || '',
      email: guardian.email || '',
      relationship: relationship || v[slot]?.relationship || '',
      guardian_id: guardian.id,
    };
    if (slot === 'primary' && sameAsPrimary) {
      onChange?.({
        primary: next,
        emergency: { ...next, same_as_primary: true },
      });
    } else {
      setSlot(slot, {
        ...next,
        ...(slot === 'emergency' ? { same_as_primary: false } : {}),
      });
    }
    setPickerSlot(null);
  }

  function patchPrimary(patch) {
    const nextPrimary = { ...primary, ...patch };
    if (sameAsPrimary) {
      onChange?.({
        primary: nextPrimary,
        emergency: {
          ...nextPrimary,
          same_as_primary: true,
        },
      });
    } else {
      setSlot('primary', patch);
    }
  }

  function toggleSameAsEmergency(checked) {
    if (checked) {
      const merged = mergeSameContact(primary, { ...emergency, same_as_primary: true });
      onChange?.(merged);
    } else {
      setSlot('emergency', { same_as_primary: false });
    }
  }

  const findBtn = (slot) => (
    <button
      type="button"
      onClick={() => setPickerSlot(slot)}
      style={{
        height: 26, padding: '0 8px', borderRadius: 6, border: 'none',
        background: 'transparent', cursor: 'pointer', flexShrink: 0,
        fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex, fontFamily: 'inherit',
        textDecoration: 'underline', textUnderlineOffset: 2,
      }}
    >
      Lookup
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact || inline ? 10 : 14 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{
            fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0,
          }}>
            Primary Caregiver
          </p>
          {findBtn('primary')}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: showEmail ? '1.3fr 1fr 1fr' : '1.4fr 1fr 1fr',
          gap: 8,
        }}>
          <Field label="Name">
            <input
              value={primary.name || ''}
              onChange={(e) => patchPrimary({ name: e.target.value, guardian_id: undefined })}
              placeholder="Full name"
              style={inputStyle}
            />
          </Field>
          <Field label="Phone">
            <input
              value={primary.phone || ''}
              onChange={(e) => patchPrimary({ phone: e.target.value, guardian_id: undefined })}
              placeholder="(XXX) XXX-XXXX"
              type="tel"
              style={inputStyle}
            />
          </Field>
          <Field label="Relation">
            <select
              value={primary.relationship || ''}
              onChange={(e) => patchPrimary({ relationship: e.target.value })}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">Select…</option>
              {GUARDIAN_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          {showEmail && (
            <Field label="Email" full>
              <input
                value={primary.email || ''}
                onChange={(e) => patchPrimary({ email: e.target.value })}
                placeholder="optional"
                type="email"
                style={inputStyle}
              />
            </Field>
          )}
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
          color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer',
          marginTop: 10,
        }}>
          <input
            type="checkbox"
            checked={sameAsPrimary}
            onChange={(e) => toggleSameAsEmergency(e.target.checked)}
            disabled={!primary.name && !guardianPhoneDigits(primary.phone) && !emergency.name && !guardianPhoneDigits(emergency.phone)}
            style={{ accentColor: palette.primaryMagenta.hex }}
          />
          Same as emergency contact
        </label>
      </div>

      <div style={{ opacity: sameAsPrimary ? 0.5 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{
            fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0,
          }}>
            Emergency Contact
          </p>
          {!sameAsPrimary && findBtn('emergency')}
        </div>
        {sameAsPrimary ? (
          <p style={{ fontSize: 12.5, margin: 0, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {[primary.name, primary.phone].filter(Boolean).join(' · ') || 'Same as primary'}
          </p>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: showEmail ? '1.3fr 1fr 1fr' : '1.4fr 1fr 1fr',
            gap: 8,
          }}>
            <Field label="Name">
              <input
                value={emergency.name || ''}
                onChange={(e) => setSlot('emergency', { name: e.target.value, guardian_id: undefined, same_as_primary: false })}
                placeholder="Full name"
                style={inputStyle}
              />
            </Field>
            <Field label="Phone">
              <input
                value={emergency.phone || ''}
                onChange={(e) => setSlot('emergency', { phone: e.target.value, guardian_id: undefined, same_as_primary: false })}
                placeholder="(XXX) XXX-XXXX"
                type="tel"
                style={inputStyle}
              />
            </Field>
            <Field label="Relation">
              <select
                value={emergency.relationship || ''}
                onChange={(e) => setSlot('emergency', { relationship: e.target.value, same_as_primary: false })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">Select…</option>
                {GUARDIAN_RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            {showEmail && (
              <Field label="Email" full>
                <input
                  value={emergency.email || ''}
                  onChange={(e) => setSlot('emergency', { email: e.target.value, same_as_primary: false })}
                  placeholder="optional"
                  type="email"
                  style={inputStyle}
                />
              </Field>
            )}
          </div>
        )}
      </div>

      {pickerSlot && (
        <KnownGuardianPicker
          onClose={() => setPickerSlot(null)}
          onSelect={(g, rel) => applyGuardian(pickerSlot, g, rel)}
          defaultRelationship={v[pickerSlot]?.relationship || ''}
        />
      )}
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: full ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  height: 34,
  padding: '0 10px',
  borderRadius: 7,
  border: `1px solid var(--color-border)`,
  background: palette.backgroundLight.hex,
  fontSize: 13,
  fontFamily: 'inherit',
  color: palette.backgroundDark.hex,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function isPhoneLikeName(s) {
  const raw = String(s || '').trim();
  if (!raw) return false;
  const d = raw.replace(/\D/g, '');
  if (!/^[\d\s().+\-]+$/.test(raw)) return false;
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}

function isEmailLikeName(s) {
  return /@/.test(String(s || ''));
}

/** Real person name for comparison — ignores phone/email/role junk. */
function realNameKey(raw) {
  const split = splitContactNameAndRelationship(raw);
  const name = split.cleanName || '';
  if (!name || isPhoneLikeName(name) || isEmailLikeName(name)) return '';
  return normalize(name);
}

/**
 * Same person when phones match (10+ digits).
 * Names may be split across slots from legacy intake (one side has name,
 * the other has email / phone-as-name junk) — still treat as same contact.
 */
export function isSameAsPrimary(emergency, primary) {
  if (emergency?.same_as_primary) return true;
  const pPhone = guardianPhoneDigits(primary?.phone);
  const ePhone = guardianPhoneDigits(emergency?.phone);
  if (pPhone.length < 10 || ePhone.length < 10 || pPhone !== ePhone) return false;
  const pName = realNameKey(primary?.name);
  const eName = realNameKey(emergency?.name);
  // Conflicting real names on the same phone → not auto-same (staff decide).
  if (pName && eName && pName !== eName) return false;
  return true;
}

/** Prefer a real person name; never keep phone/email/role junk. */
function preferContactName(...cands) {
  for (const raw of cands) {
    const key = realNameKey(raw);
    if (!key) continue;
    const split = splitContactNameAndRelationship(raw);
    return split.cleanName || String(raw || '').trim();
  }
  return '';
}

function preferEmail(...cands) {
  for (const c of cands) {
    const s = String(c || '').trim();
    if (isEmailLikeName(s)) return s;
  }
  return '';
}

/** Merge split primary/emergency fields when they are the same person. */
export function mergeSameContact(primary, emergency) {
  const p = { ...(primary || {}) };
  const e = { ...(emergency || {}) };

  // Sanitize junk names before same-check / merge
  if (isPhoneLikeName(p.name) || isEmailLikeName(p.name) || normalizeGuardianRelationship(p.name)) {
    const split = splitContactNameAndRelationship(p.name);
    if (normalizeGuardianRelationship(p.name) && !p.relationship) p.relationship = split.relationship;
    if (isEmailLikeName(p.name) && !p.email) p.email = String(p.name).trim();
    if (isPhoneLikeName(p.name) && !guardianPhoneDigits(p.phone)) p.phone = guardianPhoneDigits(p.name);
    p.name = split.cleanName && realNameKey(split.cleanName) ? split.cleanName : '';
  }
  if (isPhoneLikeName(e.name) || isEmailLikeName(e.name) || normalizeGuardianRelationship(e.name)) {
    const split = splitContactNameAndRelationship(e.name);
    if (normalizeGuardianRelationship(e.name) && !e.relationship) e.relationship = split.relationship;
    if (isEmailLikeName(e.name) && !e.email) e.email = String(e.name).trim();
    if (isPhoneLikeName(e.name) && !guardianPhoneDigits(e.phone)) e.phone = guardianPhoneDigits(e.name);
    e.name = split.cleanName && realNameKey(split.cleanName) ? split.cleanName : '';
  }

  const same = isSameAsPrimary(e, p) || !!e.same_as_primary;
  if (!same) {
    return {
      primary: { ...p },
      emergency: { ...e, same_as_primary: false },
    };
  }
  const merged = {
    name: preferContactName(p.name, e.name),
    phone: guardianPhoneDigits(p.phone) || guardianPhoneDigits(e.phone) || p.phone || e.phone || '',
    email: preferEmail(p.email, e.email),
    relationship: p.relationship || e.relationship || '',
    guardian_id: p.guardian_id || e.guardian_id,
  };
  return {
    primary: { ...merged },
    emergency: { ...merged, same_as_primary: true },
  };
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function KnownGuardianPicker({ onClose, onSelect, defaultRelationship }) {
  const storeGuardians = useCareStore((s) => s.knownGuardians) || {};
  const [q, setQ] = useState('');
  const [relationship, setRelationship] = useState(defaultRelationship || '');

  const list = useMemo(() => {
    const all = Object.values(storeGuardians)
      .filter((g) => g.is_active !== false)
      .sort((a, b) => guardianDisplay(a).localeCompare(guardianDisplay(b)));
    const query = q.trim().toLowerCase();
    if (!query) return all.slice(0, 40);
    const phoneQ = query.replace(/\D/g, '');
    return all.filter((g) => {
      const name = guardianDisplay(g).toLowerCase();
      const phone = guardianPhoneDigits(g.phone);
      return name.includes(query) || (phoneQ && phone.includes(phoneQ));
    }).slice(0, 40);
  }, [storeGuardians, q]);

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 10050,
        background: hexToRgba(palette.backgroundDark.hex, 0.45),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 440, maxHeight: '80vh',
        background: palette.backgroundLight.hex, borderRadius: 14,
        boxShadow: `0 20px 50px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
            Find known guardian
          </p>
        </div>

        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or phone…"
            style={inputStyle}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              Relationship for this patient
            </span>
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">Select…</option>
              {GUARDIAN_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', borderTop: `1px solid var(--color-border)` }}>
          {list.length === 0 ? (
            <p style={{ padding: 20, textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              No matches
            </p>
          ) : (
            list.map((g) => (
              <button
                key={g._id || g.id}
                type="button"
                onClick={() => onSelect(g, relationship)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 18px', border: 'none', borderBottom: `1px solid var(--color-border)`,
                  background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
                  {guardianDisplay(g) || '—'}
                </p>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 0' }}>
                  {[g.phone, g.email].filter(Boolean).join(' · ') || 'No phone on file'}
                </p>
              </button>
            ))
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 34, padding: '0 14px', borderRadius: 8, border: `1px solid var(--color-border)`,
              background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.6), fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Digits-only phone compare (10 digits). Empty → ''.
 */
function phoneDigits(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 10);
}

/**
 * Build form value from patient dual-write mirrors (primary_contact_* + emergency_*).
 * Falls back to legacy phone_primary / email (caregiver demos). Merges split
 * primary/emergency when they share a phone (legacy intake remnant).
 */
export function contactsFromPatient(patient) {
  if (!patient) {
    return {
      primary: { name: '', phone: '', email: '', relationship: '' },
      emergency: { name: '', phone: '', email: '', relationship: '', same_as_primary: false },
    };
  }

  const demoPhone = phoneDigits(patient.phone_primary) || phoneDigits(patient.phone_secondary);
  const demoEmail = patient.email || '';
  let primaryPhone = phoneDigits(patient.primary_contact_phone) || demoPhone;
  let primaryEmail = patient.primary_contact_email || demoEmail || '';
  let primaryName = patient.primary_contact_name || '';
  let primaryRel = patient.primary_contact_relationship || '';

  // "Mom" / "Father" alone are relationships, not names.
  const primarySplit = splitContactNameAndRelationship(primaryName);
  if (primarySplit.relationship) {
    primaryName = primarySplit.cleanName;
    if (!primaryRel) primaryRel = primarySplit.relationship;
  }

  const emergencySplit = splitContactNameAndRelationship(patient.emergency_contact_name || '');
  let emergencyName = emergencySplit.relationship && !emergencySplit.cleanName
    ? ''
    : (emergencySplit.cleanName || patient.emergency_contact_name || '');
  let emergencyPhone = phoneDigits(patient.emergency_contact_phone) || '';
  let emergencyEmail = patient.emergency_contact_email || '';
  let emergencyRel = patient.emergency_contact_relationship || emergencySplit.relationship || '';

  // If primary phone empty but emergency has one, seed primary from emergency
  // when demos also empty (legacy: everything lived on emergency_*).
  if (!primaryPhone && emergencyPhone) primaryPhone = emergencyPhone;

  const merged = mergeSameContact(
    {
      name: primaryName,
      phone: primaryPhone,
      email: primaryEmail,
      relationship: primaryRel,
    },
    {
      name: emergencyName,
      phone: emergencyPhone || primaryPhone,
      email: emergencyEmail,
      relationship: emergencyRel,
    },
  );
  return merged;
}

/**
 * Resolve primary + emergency mirrors for save.
 * Same-as-primary copies the Primary Contact person — never the patient.
 * Does not invent blank overwrites for untouched slots beyond what draft holds.
 */
export function resolveContactsForSave(draft) {
  const { primary, emergency } = mergeSameContact(draft?.primary, {
    ...(draft?.emergency || {}),
    same_as_primary: !!(draft?.emergency?.same_as_primary),
  });
  // Honor explicit checkbox even when phones aren't filled yet.
  const same = !!emergency.same_as_primary || isSameAsPrimary(emergency, primary);
  const primaryOut = {
    name: primary.name || (same ? (emergency.name || '') : ''),
    phone: primary.phone || (same ? (emergency.phone || '') : ''),
    email: primary.email || (same ? (emergency.email || '') : ''),
    relationship: primary.relationship || (same ? (emergency.relationship || '') : ''),
  };
  // Prefer already-merged primary when same.
  if (same) {
    primaryOut.name = primaryOut.name || emergency.name || '';
    primaryOut.phone = primaryOut.phone || emergency.phone || '';
    primaryOut.email = primaryOut.email || emergency.email || '';
    primaryOut.relationship = primaryOut.relationship || emergency.relationship || '';
  }
  const emergencyOut = same
    ? {
      same_as_primary: true,
      name: primaryOut.name,
      phone: primaryOut.phone,
      email: primaryOut.email,
      relationship: primaryOut.relationship,
    }
    : {
      same_as_primary: false,
      name: emergency.name || '',
      phone: emergency.phone || '',
      email: emergency.email || '',
      relationship: emergency.relationship || '',
    };
  return { primary: primaryOut, emergency: emergencyOut };
}

/** @deprecated use resolveContactsForSave — kept so older imports don’t break */
export function resolveEmergencyForSave(draft, primarySource) {
  const resolved = resolveContactsForSave({
    primary: primarySource || draft?.primary,
    emergency: draft?.emergency,
  });
  return resolved.emergency;
}

/** @deprecated use contactsFromPatient — demographics phone/email are caregiver */
export function patientPrimarySource(patient) {
  const { primary } = contactsFromPatient(patient);
  return { name: primary.name, phone: primary.phone, email: primary.email };
}
