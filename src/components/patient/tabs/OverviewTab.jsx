import { useState } from 'react';
import { updatePatient } from '../../../api/patients.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: hexToRgba(palette.backgroundDark.hex, 0.38),
          marginBottom: 12,
          paddingBottom: 6,
          borderBottom: `1px solid var(--color-border)`,
        }}
      >
        {title}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {children}
      </div>
    </div>
  );
}

function EditableField({ label, value, fieldKey, patientId, onSave, type = 'text', fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(value || '');
    setEditing(true);
  }

  async function save() {
    if (draft === (value || '')) { setEditing(false); return; }
    setSaving(true);
    try {
      await updatePatient(patientId, { [fieldKey]: draft });
      onSave(fieldKey, draft);
    } catch {
      // silently revert on error
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && type !== 'textarea') save();
    if (e.key === 'Escape') setEditing(false);
  }

  const displayValue = value || <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3, letterSpacing: '0.02em' }}>
        {label}
      </p>
      {editing ? (
        type === 'textarea' ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            rows={3}
            style={{
              width: '100%', padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${palette.primaryMagenta.hex}`,
              fontSize: 13, color: palette.backgroundDark.hex,
              background: hexToRgba(palette.backgroundDark.hex, 0.03),
              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        ) : (
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDown}
            style={{
              width: '100%', padding: '5px 8px', borderRadius: 6,
              border: `1px solid ${palette.primaryMagenta.hex}`,
              fontSize: 13, color: palette.backgroundDark.hex,
              background: hexToRgba(palette.backgroundDark.hex, 0.03),
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        )
      ) : (
        <p
          onClick={startEdit}
          title="Click to edit"
          style={{
            fontSize: 13, color: palette.backgroundDark.hex,
            padding: '4px 6px', borderRadius: 6, cursor: 'text',
            border: '1px solid transparent',
            transition: 'border-color 0.12s, background 0.12s',
            wordBreak: 'break-word',
            opacity: saving ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12);
            e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03);
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {saving ? 'Saving...' : displayValue}
        </p>
      )}
    </div>
  );
}

function ReadField({ label, value, fullWidth = false }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3, letterSpacing: '0.02em' }}>
        {label}
      </p>
      <p style={{ fontSize: 13, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: value ? 'normal' : 'italic' }}>
        {value || '—'}
      </p>
    </div>
  );
}

export default function OverviewTab({ patient, referral }) {
  const { updatePatientLocal } = usePatientDrawer();
  const { resolveMarketer, resolveUser } = useLookups();

  function handleSave(field, value) {
    updatePatientLocal({ [field]: value });
  }

  if (!patient) return null;

  const patientId = patient._id;

  const fullAddr = [patient.address_street, patient.address_city, patient.address_state, patient.address_zip]
    .filter(Boolean).join(', ');

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 20 }}>
        Click any field to edit. Press Enter or click away to save. Press Escape to cancel.
      </p>

      <Section title="Patient Information">
        <EditableField label="First Name" fieldKey="first_name" value={patient.first_name} patientId={patientId} onSave={handleSave} />
        <EditableField label="Last Name" fieldKey="last_name" value={patient.last_name} patientId={patientId} onSave={handleSave} />
        <EditableField label="Date of Birth" fieldKey="dob" value={patient.dob ? new Date(patient.dob).toISOString().split('T')[0] : ''} patientId={patientId} onSave={handleSave} type="date" />
        <EditableField label="Gender" fieldKey="gender" value={patient.gender} patientId={patientId} onSave={handleSave} />
        <EditableField label="Primary Phone" fieldKey="phone_primary" value={patient.phone_primary} patientId={patientId} onSave={handleSave} type="tel" />
        <EditableField label="Secondary Phone" fieldKey="phone_secondary" value={patient.phone_secondary} patientId={patientId} onSave={handleSave} type="tel" />
        <EditableField label="Email" fieldKey="email" value={patient.email} patientId={patientId} onSave={handleSave} type="email" />
        <EditableField label="Address" fieldKey="address_street" value={patient.address_street} patientId={patientId} onSave={handleSave} fullWidth />
        <EditableField label="City" fieldKey="address_city" value={patient.address_city} patientId={patientId} onSave={handleSave} />
        <EditableField label="State" fieldKey="address_state" value={patient.address_state} patientId={patientId} onSave={handleSave} />
        <EditableField label="Zip" fieldKey="address_zip" value={patient.address_zip?.toString()} patientId={patientId} onSave={handleSave} />
      </Section>

      <Section title="Insurance">
        <EditableField label="Medicaid #" fieldKey="medicaid_number" value={patient.medicaid_number} patientId={patientId} onSave={handleSave} />
        <EditableField label="Medicare #" fieldKey="medicare_number" value={patient.medicare_number} patientId={patientId} onSave={handleSave} />
        <EditableField label="Insurance Plan" fieldKey="insurance_plan" value={patient.insurance_plan} patientId={patientId} onSave={handleSave} />
        <EditableField label="Insurance ID" fieldKey="insurance_id" value={patient.insurance_id} patientId={patientId} onSave={handleSave} />
      </Section>

      <Section title="Emergency Contact">
        <EditableField label="Name" fieldKey="emergency_contact_name" value={patient.emergency_contact_name} patientId={patientId} onSave={handleSave} />
        <EditableField label="Phone" fieldKey="emergency_contact_phone" value={patient.emergency_contact_phone} patientId={patientId} onSave={handleSave} type="tel" />
        <EditableField label="Email" fieldKey="emergency_contact_email" value={patient.emergency_contact_email} patientId={patientId} onSave={handleSave} type="email" fullWidth />
      </Section>

      {referral && (
        <Section title="Referral Info">
          <ReadField label="Referral ID" value={referral.id} />
          <ReadField label="Referral Date" value={referral.referral_date ? new Date(referral.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null} />
          <ReadField label="Division" value={referral.division} />
          <ReadField label="Priority" value={referral.priority} />
          <ReadField label="Services" value={Array.isArray(referral.services_requested) ? referral.services_requested.join(', ') : referral.services_requested} fullWidth />
          <ReadField label="Marketer" value={resolveMarketer(referral.marketer_id)} />
          <ReadField label="Intake Owner" value={resolveUser(referral.intake_owner_id)} />
          {referral.f2f_date && <ReadField label="F2F Date" value={new Date(referral.f2f_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
          {referral.f2f_expiration && <ReadField label="F2F Expiration" value={new Date(referral.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
          {referral.hold_reason && <ReadField label="Hold Reason" value={referral.hold_reason} fullWidth />}
          {referral.ntuc_reason && <ReadField label="NTUC Reason" value={referral.ntuc_reason} fullWidth />}
        </Section>
      )}
    </div>
  );
}
