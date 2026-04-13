import { useState, useRef, useEffect } from 'react';
import { updatePatient } from '../../../api/patients.js';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { normalizePhone, formatPhone, validateEmail, lookupZip } from '../../../utils/validation.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';

const DIVISIONS  = ['ALF', 'Special Needs'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const GENDER_OPTIONS   = ['Male', 'Female'];

const INSURANCE_PLANS = [
  'Fidelis Care', 'UnitedHealthcare Community Plan', 'Healthfirst',
  'Aetna Better Health', 'Molina Healthcare', 'Anthem BCBS',
  'Medicaid', 'Medicare', 'Hamaspik', 'VNS Health',
  'MetroPlus MLTC', 'Fidelis Care at Home', 'Elderplan HomeFirst',
  'Montefiore Diamond Care', 'Healthfirst CompleteCare',
];

// Style helpers — functions so palette values are read on every render (dark mode reactive)
const fl  = () => ({ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3, letterSpacing: '0.02em' });
const ds  = () => ({ fontSize: 13, color: palette.backgroundDark.hex, padding: '4px 6px', borderRadius: 6, cursor: 'text', border: '1px solid transparent', transition: 'border-color 0.12s, background 0.12s', wordBreak: 'break-word' });
const ei  = () => ({ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${palette.primaryMagenta.hex}`, fontSize: 13, color: palette.backgroundDark.hex, background: hexToRgba(palette.backgroundDark.hex, 0.03), outline: 'none', fontFamily: 'inherit' });
const ve  = () => ({ fontSize: 11, color: '#c62828', marginTop: 2, fontWeight: 500 });

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
  const { can } = usePermissions();

  function startEdit() { setDraft(value || ''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
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

// ── Patient select field (dropdown for patient data) ──────────────────────────

function EditablePatientSelect({ label, value, fieldKey, patientId, patientRecordId, onSave, options, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const { can } = usePermissions();

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    const v = e.target.value;
    if (v === value) { setEditing(false); return; }
    onSave(fieldKey, v);
    setEditing(false);
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: v });
    setSaving(true);
    try {
      await updatePatient(patientId, { [fieldKey]: v });
    } catch {
      onSave(fieldKey, value);
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value });
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

// ── Phone field (validates + formats as (XXX) XXX-XXXX) ───────────────────────

function PhoneField({ label, value, fieldKey, patientId, patientRecordId, onSave, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { setDraft(value || ''); setError(''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    if (draft === (value || '')) { setEditing(false); setError(''); return; }
    if (!draft.trim()) {
      setError('');
      onSave(fieldKey, '');
      setEditing(false);
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: '' });
      setSaving(true);
      try { await updatePatient(patientId, { [fieldKey]: '' }); }
      catch { onSave(fieldKey, value || ''); if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' }); }
      finally { setSaving(false); }
      return;
    }
    const result = normalizePhone(draft);
    if (!result.valid) { setError(result.error); return; }
    setError('');
    onSave(fieldKey, result.digits);
    setEditing(false);
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: result.digits });
    setSaving(true);
    try {
      await updatePatient(patientId, { [fieldKey]: result.digits });
    } catch {
      onSave(fieldKey, value || '');
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' });
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') { setEditing(false); setError(''); }
  }

  const display = value ? formatPhone(value.replace(/\D/g, '')) : null;
  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        <>
          <input autoFocus type="tel" value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
      ) : (
        <p onClick={startEdit} title="Click to edit"
          style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (display || empty)}
        </p>
      )}
    </div>
  );
}

// ── Email field (validates format) ────────────────────────────────────────────

function EmailField({ label, value, fieldKey, patientId, patientRecordId, onSave, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { setDraft(value || ''); setError(''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    if (draft === (value || '')) { setEditing(false); setError(''); return; }
    if (!draft.trim()) {
      setError('');
      onSave(fieldKey, '');
      setEditing(false);
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: '' });
      setSaving(true);
      try { await updatePatient(patientId, { [fieldKey]: '' }); }
      catch { onSave(fieldKey, value || ''); if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' }); }
      finally { setSaving(false); }
      return;
    }
    const result = validateEmail(draft);
    if (!result.valid) { setError(result.error); return; }
    setError('');
    const trimmed = draft.trim();
    onSave(fieldKey, trimmed);
    setEditing(false);
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: trimmed });
    setSaving(true);
    try {
      await updatePatient(patientId, { [fieldKey]: trimmed });
    } catch {
      onSave(fieldKey, value || '');
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' });
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') { setEditing(false); setError(''); }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing ? (
        <>
          <input autoFocus type="email" value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
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

// ── ZIP field (validates + auto-populates city/state) ─────────────────────────

function ZipField({ value, cityValue, stateValue, patientId, patientRecordId, onSave, fullWidth = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { setDraft(value || ''); setError(''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    if (draft === (value || '')) { setEditing(false); setError(''); return; }
    if (!draft.trim()) {
      setError('');
      onSave('address_zip', '');
      setEditing(false);
      if (patientRecordId) updateEntity('patients', patientRecordId, { address_zip: '' });
      setSaving(true);
      try { await updatePatient(patientId, { address_zip: '' }); }
      catch { onSave('address_zip', value || ''); if (patientRecordId) updateEntity('patients', patientRecordId, { address_zip: value || '' }); }
      finally { setSaving(false); }
      return;
    }
    const result = lookupZip(draft);
    if (!result.valid) { setError(result.error); return; }
    setError('');
    const updates = { address_zip: result.zip, address_city: result.city, address_state: result.state };
    onSave('address_zip', result.zip);
    onSave('address_city', result.city);
    onSave('address_state', result.state);
    setEditing(false);
    if (patientRecordId) updateEntity('patients', patientRecordId, updates);
    setSaving(true);
    try {
      await updatePatient(patientId, updates);
    } catch {
      onSave('address_zip', value || '');
      onSave('address_city', cityValue || '');
      onSave('address_state', stateValue || '');
      if (patientRecordId) updateEntity('patients', patientRecordId, {
        address_zip: value || '', address_city: cityValue || '', address_state: stateValue || '',
      });
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') { setEditing(false); setError(''); }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>ZIP</p>
      {editing ? (
        <>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
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
  const { can } = usePermissions();

  function startEdit() { setDraft(value || ''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
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
  const { can } = usePermissions();

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
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
  const { can } = usePermissions();

  const current = Array.isArray(value) ? value : (value ? String(value).split(/,\s*/) : []);

  function startEdit() { setDraft([...current]); setEditing(true); }

  function toggle(opt) {
    setDraft((prev) => prev.includes(opt) ? prev.filter((v) => v !== opt) : [...prev, opt]);
  }

  async function save() {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
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
  const { can } = usePermissions();

  async function handleSelect(phy) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
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

// ── Insurance Editor (multi-select with tags) ───────────────────────────────

function InsuranceEditor({ patient, patientId, onSave }) {
  const [open, setOpen] = useState(false);
  const [otherValue, setOtherValue] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const dropRef = useRef(null);

  let plans = [];
  try { plans = patient.insurance_plans ? JSON.parse(patient.insurance_plans) : []; } catch { plans = []; }
  if (!Array.isArray(plans)) plans = [];
  if (plans.length === 0 && patient.insurance_plan) plans = [patient.insurance_plan];

  let details = {};
  try { details = patient.insurance_plan_details ? JSON.parse(patient.insurance_plan_details) : {}; } catch { details = {}; }
  if (typeof details !== 'object' || details === null) details = {};

  useEffect(() => {
    if (!open) return;
    function dismiss(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  async function persist(nextPlans, nextDetails) {
    const primary = nextPlans[0] || '';
    const plansJson = nextPlans.length > 0 ? JSON.stringify(nextPlans) : '';
    const detailsJson = Object.keys(nextDetails).length > 0 ? JSON.stringify(nextDetails) : '';
    const fields = {
      insurance_plans: plansJson,
      insurance_plan_details: detailsJson,
      insurance_plan: primary,
    };
    onSave('insurance_plans', plansJson);
    onSave('insurance_plan_details', detailsJson);
    onSave('insurance_plan', primary);
    if (patientId) {
      updateEntity('patients', patientId, fields);
      setSaving(true);
      try { await updatePatient(patientId, fields); } catch {} finally { setSaving(false); }
    }
  }

  function togglePlan(plan) {
    const next = plans.includes(plan) ? plans.filter((p) => p !== plan) : [...plans, plan];
    const nextDetails = { ...details };
    if (!next.includes(plan)) delete nextDetails[plan];
    persist(next, nextDetails);
  }

  function removePlan(plan) {
    const next = plans.filter((p) => p !== plan);
    const nextDetails = { ...details };
    delete nextDetails[plan];
    persist(next, nextDetails);
  }

  function addOther() {
    if (!otherValue.trim()) return;
    const label = otherValue.trim();
    if (!plans.includes(label)) persist([...plans, label], details);
    setOtherValue('');
    setShowOther(false);
  }

  function handleDetailChange(plan, value) {
    const nextDetails = { ...details, [plan]: value };
    persist(plans, nextDetails);
  }

  return (
    <div>
      <div ref={dropRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: '100%', padding: '9px 11px', borderRadius: 8, border: 'none',
            background: hexToRgba(palette.backgroundDark.hex, 0.05),
            fontSize: 13, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            color: plans.length > 0 ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
            opacity: saving ? 0.6 : 1,
          }}
        >
          <span>{plans.length > 0 ? `${plans.length} plan${plans.length !== 1 ? 's' : ''}` : 'Select insurance plans...'}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            maxHeight: 220, overflowY: 'auto', borderRadius: 10,
            background: palette.backgroundLight.hex,
            boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
            padding: '4px 0',
          }}>
            {INSURANCE_PLANS.map((plan) => {
              const isSelected = plans.includes(plan);
              return (
                <button key={plan} type="button" onClick={() => togglePlan(plan)} style={{
                  width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 9,
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: 12.5, color: palette.backgroundDark.hex, transition: 'background 0.08s',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? palette.primaryMagenta.hex : 'none',
                    border: isSelected ? 'none' : `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
                  }}>
                    {isSelected && (
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke={palette.backgroundLight.hex} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {plan}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {plans.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {plans.map((plan) => (
            <span key={plan} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 4,
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              fontSize: 11.5, fontWeight: 550, color: palette.backgroundDark.hex,
            }}>
              {plan}
              <button type="button" onClick={() => removePlan(plan)} style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: hexToRgba(palette.backgroundDark.hex, 0.35), display: 'flex', alignItems: 'center',
              }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {!showOther ? (
        <button type="button" onClick={() => setShowOther(true)} style={{ marginTop: 6, background: 'none', border: 'none', fontSize: 11.5, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer', padding: '4px 0' }}>
          + Other
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={otherValue}
            onChange={(e) => setOtherValue(e.target.value)}
            placeholder="Insurance name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOther())}
            style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), fontSize: 12.5, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit', flex: 1 }}
          />
          <button type="button" onClick={addOther} disabled={!otherValue.trim()} style={{
            padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 650, cursor: otherValue.trim() ? 'pointer' : 'not-allowed',
            background: otherValue.trim() ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
            color: otherValue.trim() ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
          }}>Add</button>
        </div>
      )}

      {plans.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {plans.map((plan) => (
            <div key={plan} style={{ marginBottom: 6 }}>
              <input
                value={details[plan] || ''}
                onChange={(e) => handleDetailChange(plan, e.target.value)}
                placeholder={`${plan} member ID or plan #`}
                style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), fontSize: 12, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function OverviewTab({ patient, referral }) {
  const { can } = usePermissions();
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
        <EditableField label="First Name"        fieldKey="first_name"       value={patient.first_name}       patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Last Name"         fieldKey="last_name"        value={patient.last_name}        patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Date of Birth"     fieldKey="dob"              value={patient.dob ? new Date(patient.dob).toISOString().split('T')[0] : ''} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} type="date" />
        <EditablePatientSelect label="Gender"    fieldKey="gender"           value={patient.gender}           patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} options={GENDER_OPTIONS} />
        <PhoneField label="Primary Phone"        fieldKey="phone_primary"    value={patient.phone_primary}    patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <PhoneField label="Secondary Phone"      fieldKey="phone_secondary"  value={patient.phone_secondary}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EmailField label="Email"                fieldKey="email"            value={patient.email}            patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EditableField label="Address"           fieldKey="address_street"   value={patient.address_street}   patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} fullWidth />
        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 16px' }}>
          <ZipField value={patient.address_zip?.toString()} cityValue={patient.address_city} stateValue={patient.address_state} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
          <EditableField label="City"            fieldKey="address_city"     value={patient.address_city}     patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
          <EditableField label="State"           fieldKey="address_state"    value={patient.address_state}    patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        </div>
      </Section>

      {/* ── Insurance ── */}
      <Section title="Insurance">
        <div style={{ gridColumn: '1 / -1' }}>
          <InsuranceEditor patient={patient} patientId={patientId} onSave={handlePatientSave} />
        </div>
      </Section>

      {/* ── Approved Services (permission-gated) ── */}
      {can(PERMISSION_KEYS.CLINICAL_APPROVED_SERVICES) && (
        <Section title="Approved Services">
          <EditableField label="Approved Services" fieldKey="approved_services" value={patient.approved_services} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} fullWidth />
        </Section>
      )}

      {/* ── Emergency Contact ── */}
      <Section title="Emergency Contact">
        <EditableField label="Name"   fieldKey="emergency_contact_name"  value={patient.emergency_contact_name}  patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <PhoneField    label="Phone"  fieldKey="emergency_contact_phone" value={patient.emergency_contact_phone} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} />
        <EmailField    label="Email"  fieldKey="emergency_contact_email" value={patient.emergency_contact_email} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} fullWidth />
      </Section>

    </div>
  );
}
