import { useState } from 'react';
import { updatePatient } from '../../../api/patients.js';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const DIVISIONS  = ['ALF', 'Special Needs'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];

// Style helpers — functions so palette values are read on every render (dark mode reactive)
const fl  = () => ({ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3, letterSpacing: '0.02em' });
const ds  = () => ({ fontSize: 13, color: palette.backgroundDark.hex, padding: '4px 6px', borderRadius: 6, cursor: 'text', border: '1px solid transparent', transition: 'border-color 0.12s, background 0.12s', wordBreak: 'break-word' });
const ei  = () => ({ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${palette.primaryMagenta.hex}`, fontSize: 13, color: palette.backgroundDark.hex, background: hexToRgba(palette.backgroundDark.hex, 0.03), outline: 'none', fontFamily: 'inherit' });

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid var(--color-border)` }}>
        {title}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Patient field (optimistic, saved to Patients table) ────────────────────────

function EditableField({ label, value, fieldKey, patientId, patientRecordId, onSave, type = 'text', fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);

  function startEdit() { setDraft(value || ''); setEditing(true); }

  async function save() {
    if (draft === (value || '')) { setEditing(false); return; }
    onSave(fieldKey, draft);
    setEditing(false);
    // Update the store immediately so checklists and other readers see the change
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: draft });
    setSaving(true);
    try {
      await updatePatient(patientId, { [fieldKey]: draft });
    } catch {
      onSave(fieldKey, value || '');
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' });
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && type !== 'textarea') save();
    if (e.key === 'Escape') setEditing(false);
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        type === 'textarea' ? (
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} rows={3}
            style={{ ...ei(), resize: 'vertical' }} />
        ) : (
          <input autoFocus type={type} value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={ei()} />
        )
      ) : (
        <p onClick={startEdit} title="Click to edit"
          style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

// ── Referral text field ────────────────────────────────────────────────────────

function EditableReferralField({ label, value, fieldKey, referralId, onSave, type = 'text', fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);

  function startEdit() { setDraft(value || ''); setEditing(true); }

  async function save() {
    if (draft === (value || '')) { setEditing(false); return; }
    onSave(fieldKey, draft);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { [fieldKey]: draft });
    setSaving(true);
    try {
      await updateReferral(referralId, { [fieldKey]: draft });
    } catch {
      onSave(fieldKey, value || '');
      if (referralId) updateEntity('referrals', referralId, { [fieldKey]: value || '' });
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setEditing(false);
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        <input autoFocus type={type} value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={save} onKeyDown={onKeyDown} style={ei()} />
      ) : (
        <p onClick={startEdit} title="Click to edit"
          style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

// ── Referral select field ──────────────────────────────────────────────────────

function EditableReferralSelect({ label, value, fieldKey, referralId, onSave, options, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);

  async function handleChange(e) {
    const v = e.target.value;
    if (v === value) { setEditing(false); return; }
    onSave(fieldKey, v);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { [fieldKey]: v });
    setSaving(true);
    try {
      await updateReferral(referralId, { [fieldKey]: v });
    } catch {
      onSave(fieldKey, value);
      if (referralId) updateEntity('referrals', referralId, { [fieldKey]: value });
    } finally {
      setSaving(false);
    }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        <select autoFocus value={value || ''} onChange={handleChange} onBlur={() => setEditing(false)}
          style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled>Select…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <p onClick={() => setEditing(true)} title="Click to edit"
          style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

// ── Referral services (checkboxes) ─────────────────────────────────────────────

function EditableReferralServices({ value, referralId, onSave, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState([]);
  const [saving, setSaving]   = useState(false);

  const current = Array.isArray(value) ? value : (value ? String(value).split(/,\s*/) : []);

  function startEdit() { setDraft([...current]); setEditing(true); }

  function toggle(opt) {
    setDraft((prev) => prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]);
  }

  async function save() {
    onSave('services_requested', draft);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { services_requested: draft });
    setSaving(true);
    try {
      await updateReferral(referralId, { services_requested: draft });
    } catch {
      onSave('services_requested', value);
      if (referralId) updateEntity('referrals', referralId, { services_requested: value });
    } finally {
      setSaving(false);
    }
  }

  const displayText = current.length ? current.join(', ') : null;
  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>Services Requested</p>
      {editing ? (
        <div style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${palette.primaryMagenta.hex}`, background: hexToRgba(palette.backgroundDark.hex, 0.03) }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 8 }}>
            {SERVICES_OPTIONS.map((opt) => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={draft.includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: palette.primaryMagenta.hex }} />
                {opt}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={{ padding: '4px 12px', borderRadius: 5, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: '#fff', cursor: 'pointer' }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ padding: '4px 10px', borderRadius: 5, background: 'none', border: `1px solid var(--color-border)`, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p onClick={startEdit} title="Click to edit"
          style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (displayText || empty)}
        </p>
      )}
    </div>
  );
}

// ── Referral physician (PhysicianPicker inline) ────────────────────────────────

function EditableReferralPhysician({ referral, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const { resolvePhysician } = useLookups();

  async function handleSelect(phy) {
    if (!phy) {
      onSave('physician_id', null);
      setEditing(false);
      return;
    }
    onSave('physician_id', phy.id);
    setEditing(false);
    if (referral._id) updateEntity('referrals', referral._id, { physician_id: phy.id });
    setSaving(true);
    try {
      await updateReferral(referral._id, { physician_id: phy.id });
    } catch {
      onSave('physician_id', referral.physician_id);
      if (referral._id) updateEntity('referrals', referral._id, { physician_id: referral.physician_id });
    } finally {
      setSaving(false);
    }
  }

  const physicianName = referral.physician_id ? resolvePhysician(referral.physician_id) : null;
  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <p style={fl()}>Referring / Ordering Physician</p>
        {!editing && (
          <button onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: palette.accentBlue.hex, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {referral.physician_id ? 'Change' : '+ Add'}
          </button>
        )}
      </div>
      {editing ? (
        <PhysicianPicker
          physicianId={referral.physician_id}
          physicianName={physicianName}
          onChange={handleSelect}
          compact
        />
      ) : (
        <p style={{ fontSize: 13, color: physicianName && physicianName !== '—' ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: physicianName && physicianName !== '—' ? 'normal' : 'italic', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : (physicianName && physicianName !== '—' ? `Dr. ${physicianName}` : empty)}
        </p>
      )}
    </div>
  );
}

// ── Read-only field ────────────────────────────────────────────────────────────

function ReadField({ label, value, fullWidth = false }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      <p style={{ fontSize: 13, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: value ? 'normal' : 'italic' }}>
        {value || '—'}
      </p>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function OverviewTab({ patient, referral }) {
  const { updatePatientLocal, updateReferralLocal } = usePatientDrawer();
  const { resolveMarketer, resolveUser, resolveSource, resolveFacility } = useLookups();

  function handlePatientSave(field, value) { updatePatientLocal({ [field]: value }); }
  function handleReferralSave(field, value) { updateReferralLocal({ [field]: value }); }

  if (!patient) return null;

  const patientId  = patient._id;
  const referralId = referral?._id;

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 20 }}>
        Click any field to edit. Press Enter or click away to save.
      </p>

      {/* ── Patient Information ── */}
      <Section title="Patient Information">
        <EditableField label="First Name"       fieldKey="first_name"       value={patient.first_name}       patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Last Name"        fieldKey="last_name"        value={patient.last_name}        patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Date of Birth"    fieldKey="dob"              value={patient.dob ? new Date(patient.dob).toISOString().split('T')[0] : ''} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="date" />
        <EditableField label="Gender"           fieldKey="gender"           value={patient.gender}           patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Primary Phone"    fieldKey="phone_primary"    value={patient.phone_primary}    patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="tel" />
        <EditableField label="Secondary Phone"  fieldKey="phone_secondary"  value={patient.phone_secondary}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="tel" />
        <EditableField label="Email"            fieldKey="email"            value={patient.email}            patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="email" />
        <EditableField label="Address"          fieldKey="address_street"   value={patient.address_street}   patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} fullWidth />
        <EditableField label="City"             fieldKey="address_city"     value={patient.address_city}     patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="State"            fieldKey="address_state"    value={patient.address_state}    patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Zip"              fieldKey="address_zip"      value={patient.address_zip?.toString()} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
      </Section>

      {/* ── Insurance ── */}
      <Section title="Insurance">
        <EditableField label="Medicaid #"       fieldKey="medicaid_number"  value={patient.medicaid_number}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Medicare #"       fieldKey="medicare_number"  value={patient.medicare_number}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Insurance Plan"   fieldKey="insurance_plan"   value={patient.insurance_plan}   patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Insurance ID"     fieldKey="insurance_id"     value={patient.insurance_id}     patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
      </Section>

      {/* ── Emergency Contact ── */}
      <Section title="Emergency Contact">
        <EditableField label="Name"   fieldKey="emergency_contact_name"  value={patient.emergency_contact_name}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Phone"  fieldKey="emergency_contact_phone" value={patient.emergency_contact_phone} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="tel" />
        <EditableField label="Email"  fieldKey="emergency_contact_email" value={patient.emergency_contact_email} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="email" fullWidth />
      </Section>

      {/* ── Referral Info ── */}
      {referral && (
        <Section title="Referral Info">
          {/* Read-only system fields */}
          <ReadField label="Referral ID"   value={referral.id} />
          <ReadField label="Referral Date" value={referral.referral_date ? new Date(referral.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null} />
          <ReadField label="Marketer"      value={resolveMarketer(referral.marketer_id)} />
          <ReadField label="Intake Owner"  value={resolveUser(referral.intake_owner_id)} />
          {referral.referral_source_id && (
            <ReadField label="Referral Source" value={resolveSource(referral.referral_source_id)} />
          )}
          {referral.facility_id && (
            <ReadField label="Facility" value={resolveFacility(referral.facility_id)} />
          )}

          {/* Editable referral fields */}
          <EditableReferralSelect
            label="Division" fieldKey="division"
            value={referral.division} referralId={referralId}
            onSave={handleReferralSave} options={DIVISIONS}
          />
          <EditableReferralSelect
            label="Priority" fieldKey="priority"
            value={referral.priority} referralId={referralId}
            onSave={handleReferralSave} options={PRIORITIES}
          />
          <EditableReferralServices
            value={referral.services_requested}
            referralId={referralId}
            onSave={handleReferralSave}
            fullWidth
          />

          {/* Physician — full-width with PhysicianPicker */}
          <EditableReferralPhysician referral={referral} onSave={handleReferralSave} />

          {/* Conditional read-only fields */}
          {referral.f2f_date && (
            <ReadField label="F2F Date" value={new Date(referral.f2f_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
          )}
          {referral.f2f_expiration && (
            <ReadField label="F2F Expiration" value={new Date(referral.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
          )}
          {referral.hold_reason && (
            <ReadField label="Hold Reason" value={referral.hold_reason} fullWidth />
          )}
          {referral.ntuc_reason && (
            <ReadField label="NTUC Reason" value={referral.ntuc_reason} fullWidth />
          )}
        </Section>
      )}
    </div>
  );
}
