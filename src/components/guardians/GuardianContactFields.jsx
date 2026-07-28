import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { GUARDIAN_RELATIONSHIPS } from '../../data/guardianRelationships.js';
import { guardianDisplay, guardianPhoneDigits } from '../../utils/knownGuardians.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Emergency contact slot with relationship + "Find known guardian".
 *
 * Patient demographics (primary phone / email / patient name) are the primary
 * contact — do not collect a second "Primary Contact" card here. Pass those
 * fields as `primarySource` so "same as primary" copies and persists correctly.
 */
export default function GuardianContactFields({
  value,
  onChange,
  primarySource = null,
  showEmail = true,
  compact = false,
}) {
  const v = value || {};
  const [pickerOpen, setPickerOpen] = useState(false);

  const primary = primarySource || v.primary || {};
  const emergency = v.emergency || {};

  const sameAsPrimary = isSameAsPrimary(emergency, primary);

  function setEmergency(patch) {
    onChange?.({
      ...v,
      emergency: { ...emergency, ...patch },
    });
  }

  function applyGuardian(guardian, relationship) {
    setEmergency({
      name: guardianDisplay(guardian),
      phone: guardianPhoneDigits(guardian.phone) || '',
      email: guardian.email || '',
      relationship: relationship || emergency.relationship || '',
      guardian_id: guardian.id,
      same_as_primary: false,
    });
    setPickerOpen(false);
  }

  function toggleSameAsPrimary(checked) {
    if (checked) {
      onChange?.({
        ...v,
        emergency: {
          ...emergency,
          name: primary.name || emergency.name || '',
          phone: primary.phone || '',
          email: primary.email || emergency.email || '',
          relationship: emergency.relationship || '',
          same_as_primary: true,
          guardian_id: undefined,
        },
      });
    } else {
      setEmergency({ same_as_primary: false });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16 }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
        color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={sameAsPrimary}
          onChange={(e) => toggleSameAsPrimary(e.target.checked)}
          style={{ accentColor: palette.primaryMagenta.hex }}
        />
        Emergency contact is the same as primary
      </label>
      <p style={{
        fontSize: 11.5, margin: '-8px 0 0',
        color: hexToRgba(palette.backgroundDark.hex, 0.4),
      }}>
        Uses the patient’s primary phone{primary.phone ? ` (${formatPhoneHint(primary.phone)})` : ''}
        {primary.email ? ', email' : ''}
        {primary.name ? `, and name (${primary.name})` : ''}.
      </p>

      <ContactSlot
        title="Emergency Contact"
        data={emergency}
        showEmail={showEmail}
        disabled={sameAsPrimary}
        onChange={(patch) => setEmergency({ ...patch, same_as_primary: false })}
        onFind={() => setPickerOpen(true)}
      />

      {pickerOpen && (
        <KnownGuardianPicker
          onClose={() => setPickerOpen(false)}
          onSelect={(g, rel) => applyGuardian(g, rel)}
          defaultRelationship={emergency.relationship || ''}
        />
      )}
    </div>
  );
}

function ContactSlot({ title, data, showEmail, disabled, onChange, onFind }) {
  return (
    <div style={{
      opacity: disabled ? 0.55 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
      padding: '12px 12px 10px',
      borderRadius: 10,
      border: `1px solid var(--color-border)`,
      background: hexToRgba(palette.backgroundDark.hex, 0.015),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{
          fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0,
        }}>
          {title}
        </p>
        <button
          type="button"
          onClick={onFind}
          style={{
            height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid var(--color-border)`,
            background: palette.backgroundLight.hex, cursor: 'pointer',
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

function formatPhoneHint(phone) {
  const d = guardianPhoneDigits(phone);
  if (d.length !== 10) return String(phone || '').trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isSameAsPrimary(emergency, primary) {
  if (emergency?.same_as_primary) return true;
  const pPhone = guardianPhoneDigits(primary?.phone);
  const ePhone = guardianPhoneDigits(emergency?.phone);
  if (pPhone.length < 10 || pPhone !== ePhone) return false;
  // Phone match is enough to restore the checkbox after save (name may vary).
  return true;
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

/** Build form value + infer "same as primary" from patient demographics phone. */
export function contactsFromPatient(patient) {
  if (!patient) {
    return {
      emergency: { name: '', phone: '', email: '', relationship: '', same_as_primary: false },
    };
  }
  const primary = patientPrimarySource(patient);
  const emergency = {
    name: patient.emergency_contact_name || '',
    phone: patient.emergency_contact_phone || '',
    email: patient.emergency_contact_email || '',
    relationship: patient.emergency_contact_relationship || '',
  };
  return {
    emergency: {
      ...emergency,
      same_as_primary: isSameAsPrimary(emergency, primary),
    },
  };
}

export function patientPrimarySource(patient) {
  if (!patient) return { name: '', phone: '', email: '' };
  return {
    name: `${patient.first_name || ''} ${patient.last_name || ''}`.trim(),
    phone: patient.phone_primary || '',
    email: patient.email || '',
  };
}

/** Resolve emergency fields for save (copies demographics when same-as-primary). */
export function resolveEmergencyForSave(draft, primarySource) {
  const primary = primarySource || {};
  const emergency = draft?.emergency || {};
  const same = isSameAsPrimary(emergency, primary) || !!emergency.same_as_primary;
  if (same) {
    return {
      same_as_primary: true,
      name: primary.name || emergency.name || '',
      phone: primary.phone || '',
      email: primary.email || emergency.email || '',
      relationship: emergency.relationship || '',
    };
  }
  return {
    same_as_primary: false,
    name: emergency.name || '',
    phone: emergency.phone || '',
    email: emergency.email || '',
    relationship: emergency.relationship || '',
  };
}
