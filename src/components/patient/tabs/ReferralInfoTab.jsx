import { useState } from 'react';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';

const DIVISIONS = ['ALF', 'Special Needs'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];

const fl = () => ({ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3, letterSpacing: '0.02em' });
const ds = () => ({ fontSize: 13, color: palette.backgroundDark.hex, padding: '4px 6px', borderRadius: 6, cursor: 'text', border: '1px solid transparent', transition: 'border-color 0.12s, background 0.12s', wordBreak: 'break-word' });
const ei = () => ({ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${palette.primaryMagenta.hex}`, fontSize: 13, color: palette.backgroundDark.hex, background: hexToRgba(palette.backgroundDark.hex, 0.03), outline: 'none', fontFamily: 'inherit' });

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid var(--color-border)` }}>{title}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>{children}</div>
    </div>
  );
}

function ReadField({ label, value, fullWidth = false }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      <p style={{ fontSize: 13, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: value ? 'normal' : 'italic' }}>{value || '—'}</p>
    </div>
  );
}

function EditableReferralSelect({ label, value, fieldKey, referralId, onSave, options, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
    const v = e.target.value;
    if (v === value) { setEditing(false); return; }
    onSave(fieldKey, v);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { [fieldKey]: v });
    setSaving(true);
    try { await updateReferral(referralId, { [fieldKey]: v }); }
    catch { onSave(fieldKey, value); if (referralId) updateEntity('referrals', referralId, { [fieldKey]: value }); }
    finally { setSaving(false); }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        <select autoFocus value={value || ''} onChange={handleChange} onBlur={() => setEditing(false)} style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled>Select…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <p onClick={() => setEditing(true)} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

function EditableReferralServices({ value, referralId, onSave, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();
  const current = Array.isArray(value) ? value : (value ? String(value).split(/,\s*/) : []);

  function startEdit() { setDraft([...current]); setEditing(true); }
  function toggle(opt) { setDraft((prev) => prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]); }
  async function save() {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
    onSave('services_requested', draft);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { services_requested: draft });
    setSaving(true);
    try { await updateReferral(referralId, { services_requested: draft }); }
    catch { onSave('services_requested', value); if (referralId) updateEntity('referrals', referralId, { services_requested: value }); }
    finally { setSaving(false); }
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
            <button onClick={save} style={{ padding: '4px 12px', borderRadius: 5, background: palette.accentGreen.hex, border: 'none', fontSize: 12, fontWeight: 650, color: '#fff', cursor: 'pointer' }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ padding: '4px 10px', borderRadius: 5, background: 'none', border: `1px solid var(--color-border)`, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p onClick={startEdit} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
          {saving ? 'Saving…' : (displayText || empty)}
        </p>
      )}
    </div>
  );
}

function EditableReferralPhysician({ referral, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { resolvePhysician } = useLookups();
  const { can } = usePermissions();

  async function handleSelect(phy) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
    if (!phy) { onSave('physician_id', null); setEditing(false); return; }
    onSave('physician_id', phy.id);
    setEditing(false);
    if (referral._id) updateEntity('referrals', referral._id, { physician_id: phy.id });
    setSaving(true);
    try { await updateReferral(referral._id, { physician_id: phy.id }); }
    catch { onSave('physician_id', referral.physician_id); if (referral._id) updateEntity('referrals', referral._id, { physician_id: referral.physician_id }); }
    finally { setSaving(false); }
  }

  const physicianName = referral.physician_id ? resolvePhysician(referral.physician_id) : null;
  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <p style={fl()}>Referring / Ordering Physician</p>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ fontSize: 11, color: palette.accentBlue.hex, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {referral.physician_id ? 'Change' : '+ Add'}
          </button>
        )}
      </div>
      {editing ? (
        <PhysicianPicker physicianId={referral.physician_id} physicianName={physicianName} onChange={handleSelect} compact />
      ) : (
        <p style={{ fontSize: 13, color: physicianName && physicianName !== '—' ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: physicianName && physicianName !== '—' ? 'normal' : 'italic', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : (physicianName && physicianName !== '—' ? `Dr. ${physicianName}` : empty)}
        </p>
      )}
    </div>
  );
}

export default function ReferralInfoTab({ patient, referral }) {
  const { updateReferralLocal } = usePatientDrawer();
  const { resolveMarketer, resolveUser, resolveSource, resolveFacility } = useLookups();

  function handleReferralSave(field, value) { updateReferralLocal({ [field]: value }); }

  if (!referral) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No referral data available.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <Section title="Referral Info">
        <ReadField label="Referral ID" value={referral.id} />
        <ReadField label="Referral Date" value={referral.referral_date ? new Date(referral.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null} />
        <ReadField label="Marketer" value={resolveMarketer(referral.marketer_id)} />
        <ReadField label="Intake Owner" value={resolveUser(referral.intake_owner_id)} />
        {referral.referral_source_id && <ReadField label="Referral Source" value={resolveSource(referral.referral_source_id)} />}
        {referral.facility_id && <ReadField label="Facility" value={resolveFacility(referral.facility_id)} />}

        <EditableReferralSelect label="Division" fieldKey="division" value={referral.division} referralId={referral._id} onSave={handleReferralSave} options={DIVISIONS} />
        <EditableReferralServices value={referral.services_requested} referralId={referral._id} onSave={handleReferralSave} fullWidth />
        <EditableReferralPhysician referral={referral} onSave={handleReferralSave} />

        {referral.f2f_date && <ReadField label="F2F Date" value={new Date(referral.f2f_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
        {referral.f2f_expiration && <ReadField label="F2F Expiration" value={new Date(referral.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
        {referral.hold_reason && <ReadField label="Hold Reason" value={referral.hold_reason} fullWidth />}
        {referral.ntuc_reason && <ReadField label="NTUC Reason" value={referral.ntuc_reason} fullWidth />}
      </Section>
    </div>
  );
}
