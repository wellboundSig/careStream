import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { GUARDIAN_RELATIONSHIPS } from '../../data/guardianRelationships.js';
import { guardianDisplay, guardianPhoneDigits } from '../../utils/knownGuardians.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Primary Contact + Emergency Contact slots (known guardians).
 *
 * These are people who care for the patient — never the patient’s own name.
 * Patient identity (first/last, patient phone, patient email) lives in
 * demographics separately. “Same as primary” copies the Primary Contact
 * person into Emergency Contact.
 */
export default function GuardianContactFields({
  value,
  onChange,
  showEmail = true,
  compact = false,
}) {
  const v = value || {};
  const [pickerSlot, setPickerSlot] = useState(null); // 'primary' | 'emergency' | null

  const primary = v.primary || {};
  const emergency = v.emergency || {};
  const sameAsPrimary = isSameAsPrimary(emergency, primary);

  function setSlot(slot, patch) {
    onChange?.({
      ...v,
      [slot]: { ...(v[slot] || {}), ...patch },
    });
  }

  function applyGuardian(slot, guardian, relationship) {
    setSlot(slot, {
      name: guardianDisplay(guardian),
      phone: guardianPhoneDigits(guardian.phone) || '',
      email: guardian.email || '',
      relationship: relationship || v[slot]?.relationship || '',
      guardian_id: guardian.id,
      ...(slot === 'emergency' ? { same_as_primary: false } : {}),
    });
    setPickerSlot(null);
  }

  function toggleSameAsPrimary(checked) {
    if (checked) {
      onChange?.({
        ...v,
        emergency: {
          name: primary.name || '',
          phone: primary.phone || '',
          email: primary.email || '',
          relationship: emergency.relationship || primary.relationship || '',
          guardian_id: primary.guardian_id,
          same_as_primary: true,
        },
      });
    } else {
      setSlot('emergency', { same_as_primary: false });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16 }}>
      <p style={{
        fontSize: 12, margin: 0, lineHeight: 1.4,
        color: hexToRgba(palette.backgroundDark.hex, 0.5),
      }}>
        These are caregivers / contacts — not the patient. New people are saved
        as known guardians automatically.
      </p>

      <ContactSlot
        title="Primary Contact"
        hint="Main caregiver or decision-maker for this patient"
        data={primary}
        showEmail={showEmail}
        onChange={(patch) => setSlot('primary', patch)}
        onFind={() => setPickerSlot('primary')}
      />

      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
        color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer',
        marginTop: -4,
      }}>
        <input
          type="checkbox"
          checked={sameAsPrimary}
          onChange={(e) => toggleSameAsPrimary(e.target.checked)}
          disabled={!primary.name && !guardianPhoneDigits(primary.phone)}
          style={{ accentColor: palette.primaryMagenta.hex }}
        />
        Emergency contact is the same as primary contact
      </label>

      <ContactSlot
        title="Emergency Contact"
        hint="Who to call in an emergency"
        data={emergency}
        showEmail={showEmail}
        disabled={sameAsPrimary}
        onChange={(patch) => setSlot('emergency', { ...patch, same_as_primary: false })}
        onFind={() => setPickerSlot('emergency')}
      />

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

function ContactSlot({ title, hint, data, showEmail, disabled, onChange, onFind }) {
  return (
    <div style={{
      opacity: disabled ? 0.55 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
      padding: '12px 12px 10px',
      borderRadius: 10,
      border: `1px solid var(--color-border)`,
      background: hexToRgba(palette.backgroundDark.hex, 0.015),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0,
          }}>
            {title}
          </p>
          {hint && (
            <p style={{
              fontSize: 11.5, margin: '3px 0 0',
              color: hexToRgba(palette.backgroundDark.hex, 0.4),
            }}>
              {hint}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onFind}
          style={{
            height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid var(--color-border)`,
            background: palette.backgroundLight.hex, cursor: 'pointer', flexShrink: 0,
            fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex, fontFamily: 'inherit',
          }}
        >
          Find known guardian
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: showEmail ? '1.4fr 1fr 1fr' : '1.6fr 1fr 1fr',
        gap: 8,
      }}>
        <Field label="Name">
          <input
            value={data.name || ''}
            onChange={(e) => onChange({ name: e.target.value, guardian_id: undefined })}
            placeholder="Full name"
            style={inputStyle}
          />
        </Field>
        <Field label="Phone">
          <input
            value={data.phone || ''}
            onChange={(e) => onChange({ phone: e.target.value, guardian_id: undefined })}
            placeholder="(XXX) XXX-XXXX"
            type="tel"
            style={inputStyle}
          />
        </Field>
        <Field label="Relation">
          <select
            value={data.relationship || ''}
            onChange={(e) => onChange({ relationship: e.target.value })}
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
              value={data.email || ''}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="optional"
              type="email"
              style={inputStyle}
            />
          </Field>
        )}
      </div>
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

export function isSameAsPrimary(emergency, primary) {
  if (emergency?.same_as_primary) return true;
  const pPhone = guardianPhoneDigits(primary?.phone);
  const ePhone = guardianPhoneDigits(emergency?.phone);
  if (pPhone.length < 10 || pPhone !== ePhone) return false;
  const pName = normalize(primary?.name);
  const eName = normalize(emergency?.name);
  // Require name match too so we don’t treat “same phone as patient” as same contact.
  if (!pName || !eName) return pPhone.length >= 10 && pPhone === ePhone && !pName && !eName;
  return pName === eName;
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
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '4px 0 0' }}>
            Reuse someone already on file — or cancel and type a new name (saved automatically).
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
              No matches. Close and type the contact — they’ll be added as a known guardian on save.
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

/** Build form value from patient dual-write mirrors (primary_contact_* + emergency_*). */
export function contactsFromPatient(patient) {
  if (!patient) {
    return {
      primary: { name: '', phone: '', email: '', relationship: '' },
      emergency: { name: '', phone: '', email: '', relationship: '', same_as_primary: false },
    };
  }
  const primary = {
    name: patient.primary_contact_name || '',
    phone: patient.primary_contact_phone || '',
    email: patient.primary_contact_email || '',
    relationship: patient.primary_contact_relationship || '',
  };
  const emergency = {
    name: patient.emergency_contact_name || '',
    phone: patient.emergency_contact_phone || '',
    email: patient.emergency_contact_email || '',
    relationship: patient.emergency_contact_relationship || '',
  };
  return {
    primary,
    emergency: {
      ...emergency,
      same_as_primary: isSameAsPrimary(emergency, primary),
    },
  };
}

/**
 * Resolve primary + emergency mirrors for save.
 * Same-as-primary copies the Primary Contact person — never the patient.
 * Does not invent blank overwrites for untouched slots beyond what draft holds.
 */
export function resolveContactsForSave(draft) {
  const primary = draft?.primary || {};
  const emergency = draft?.emergency || {};
  const same = isSameAsPrimary(emergency, primary) || !!emergency.same_as_primary;
  const primaryOut = {
    name: primary.name || '',
    phone: primary.phone || '',
    email: primary.email || '',
    relationship: primary.relationship || '',
  };
  const emergencyOut = same
    ? {
      same_as_primary: true,
      name: primaryOut.name,
      phone: primaryOut.phone,
      email: primaryOut.email,
      relationship: emergency.relationship || primaryOut.relationship || '',
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

/** @deprecated patient phone/email are not the primary contact person */
export function patientPrimarySource(patient) {
  if (!patient) return { name: '', phone: '', email: '' };
  return {
    name: patient.primary_contact_name || '',
    phone: patient.primary_contact_phone || '',
    email: patient.primary_contact_email || '',
  };
}
