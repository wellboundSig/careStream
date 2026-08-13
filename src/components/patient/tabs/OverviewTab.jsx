import { useState, useRef, useEffect } from 'react';
import { updatePatient } from '../../../api/patients.js';
import { syncPatientInsurances } from '../../../api/syncPatientInsurances.js';
import { ensurePatientInsurancesFromJson } from '../../../utils/ensurePatientInsurances.js';
import {
  getInsuranceDetailsMap,
  memberIdFromDetail,
} from '../../../utils/insuranceDetails.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import { usePatientInsurances } from '../../../hooks/usePatientInsurances.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import {
  normalizePhone,
  formatPhone,
  validateEmail,
  lookupZip,
  getDobBoundsForAgeGroup,
  validateDobForAgeGroup,
} from '../../../utils/validation.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { LANGUAGE_OPTIONS, languageName, DEFAULT_LANGUAGE_CODE } from '../../../data/languages.js';
import { normalizePersonNamePart, normalizeContactName } from '../../../utils/personName.js';
import GuardianContactFields, {
  contactsFromPatient,
  resolveContactsForSave,
} from '../../guardians/GuardianContactFields.jsx';
import { savePatientContactSlot } from '../../../utils/knownGuardians.js';
import InsurancePlanPicker from '../../common/InsurancePlanPicker.jsx';

const DIVISIONS  = ['ALF', 'Special Needs'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const GENDER_OPTIONS   = ['Male', 'Female'];

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

function EditableField({ label, value, fieldKey, patientId, patientRecordId, onSave, type = 'text', fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { if (forceReadOnly) return; setDraft(value || ''); setError(''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    let nextValue = draft;
    if (fieldKey === 'first_name' || fieldKey === 'last_name') {
      nextValue = normalizePersonNamePart(draft);
    } else if (fieldKey === 'emergency_contact_name') {
      nextValue = normalizeContactName(draft);
    }
    if (nextValue === (value || '')) { setEditing(false); setError(''); return; }
    onSave(fieldKey, nextValue);
    setEditing(false);
    // Update the store immediately so checklists and other readers see the change
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: nextValue });
    setSaving(true);
    setError('');
    try {
      await updatePatient(patientId, { [fieldKey]: nextValue });
    } catch (err) {
      // Surface the failure so the user knows the change didn't persist —
      // previously the catch was empty and the store revert made the edit
      // appear to vanish without explanation.
      console.warn(`[OverviewTab] save failed for ${fieldKey}`, err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
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
        <p onClick={startEdit} title={forceReadOnly ? undefined : 'Click to edit'}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
      {error && <p style={ve()}>{error}</p>}
    </div>
  );
}

// ── DOB field (locked to the referral's Pediatric/Adult age group) ───────────
// SPN referrals carry `sn_age_group` ("Adult" | "Pediatric"). The date
// picker advertises the corresponding range so the browser blocks
// out-of-range picks and a hint explains the lock — matches the lead
// referral form's behavior. To switch ranges the user changes the age
// group in the Referral tab (correcting an intake mistake).

function DobField({ patient, patientId, onSave, referral, readOnly: forceReadOnly = false }) {
  // Patients.dob is an Airtable dateTime column with format YYYY-MM-DD; we
  // store it as either a bare date string ("2000-01-01") or a full ISO
  // timestamp. Strip the time portion BEFORE constructing a Date so a date
  // like "2000-01-01" doesn't get reinterpreted in the user's timezone (which
  // can shift it by a day and, for new patients with no DOB at all, NEVER
  // pre-fills the picker with today).
  const raw = patient.dob ? String(patient.dob).trim() : '';
  const value = raw ? raw.split('T')[0] : '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  const ageGroup = referral?.division === 'Special Needs' ? referral?.sn_age_group : null;
  const bounds = getDobBoundsForAgeGroup(ageGroup);
  const locked = !!ageGroup;

  function startEdit() { if (forceReadOnly) return; setDraft(value || ''); setError(''); setEditing(true); }

  async function save() {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    if (draft === (value || '')) { setEditing(false); setError(''); return; }
    if (draft) {
      const check = validateDobForAgeGroup(draft, ageGroup);
      if (!check.valid) { setError(check.error); return; }
    }
    setError('');
    onSave('dob', draft);
    setEditing(false);
    if (patientId) updateEntity('patients', patientId, { dob: draft });
    setSaving(true);
    try {
      // Airtable's dateTime column rejects an empty string — clear it with
      // `null` instead so users CAN remove a DOB they entered in error
      // without the PATCH failing and silently reverting.
      await updatePatient(patientId, { dob: draft || null });
    } catch (err) {
      console.warn('[OverviewTab] DOB save failed', err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
      onSave('dob', value || '');
      if (patientId) updateEntity('patients', patientId, { dob: value || '' });
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
    <div>
      <p style={fl()}>Date of Birth</p>
      {editing && !forceReadOnly ? (
        <>
          <input
            autoFocus type="date" value={draft}
            min={bounds.min || undefined}
            max={bounds.max || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown}
            style={error ? { ...ei(), borderColor: '#c62828' } : ei()}
          />
          {locked && !error && (
            <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 3, fontStyle: 'italic' }}>
              Locked to {ageGroup} range
            </p>
          )}
          {error && <p style={ve()}>{error}</p>}
        </>
      ) : (
        <p onClick={startEdit} title={forceReadOnly ? undefined : (locked ? `Locked to ${ageGroup} DOB range` : 'Click to edit')}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

// ── Patient select field (dropdown for patient data) ──────────────────────────

function EditablePatientSelect({ label, value, displayValue, fieldKey, patientId, patientRecordId, onSave, options, fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  const normalizedOptions = options.map((o) => (
    typeof o === 'string' ? { value: o, label: o } : o
  ));

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.PATIENT_EDIT)) return;
    const v = e.target.value;
    if (v === value) { setEditing(false); return; }
    onSave(fieldKey, v);
    setEditing(false);
    if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: v });
    setSaving(true);
    setError('');
    try {
      await updatePatient(patientId, { [fieldKey]: v });
    } catch (err) {
      console.warn(`[OverviewTab] save failed for ${fieldKey}`, err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
      onSave(fieldKey, value);
      if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value });
    } finally {
      setSaving(false);
    }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;
  const shown = displayValue || value;

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <p style={fl()}>{label}</p>
      {editing && !forceReadOnly ? (
        <select autoFocus value={value || ''} onChange={handleChange} onBlur={() => setEditing(false)}
          style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled>Select…</option>
          {normalizedOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <p onClick={() => !forceReadOnly && setEditing(true)} title={forceReadOnly ? undefined : 'Click to edit'}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (shown || empty)}
        </p>
      )}
      {error && <p style={ve()}>{error}</p>}
    </div>
  );
}

// ── Phone field (validates + formats as (XXX) XXX-XXXX) ───────────────────────

function PhoneField({ label, value, fieldKey, patientId, patientRecordId, onSave, fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { if (forceReadOnly) return; setDraft(value || ''); setError(''); setEditing(true); }

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
      catch (err) {
        console.warn(`[OverviewTab] phone save failed for ${fieldKey}`, err);
        setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
        onSave(fieldKey, value || '');
        if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' });
      }
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
    } catch (err) {
      console.warn(`[OverviewTab] phone save failed for ${fieldKey}`, err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
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
      {editing && !forceReadOnly ? (
        <>
          <input autoFocus type="tel" value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
      ) : (
        <p onClick={startEdit} title={forceReadOnly ? undefined : 'Click to edit'}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (display || empty)}
        </p>
      )}
    </div>
  );
}

// ── Email field (validates format) ────────────────────────────────────────────

function EmailField({ label, value, fieldKey, patientId, patientRecordId, onSave, fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { if (forceReadOnly) return; setDraft(value || ''); setError(''); setEditing(true); }

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
      catch (err) {
        console.warn(`[OverviewTab] email save failed for ${fieldKey}`, err);
        setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
        onSave(fieldKey, value || '');
        if (patientRecordId) updateEntity('patients', patientRecordId, { [fieldKey]: value || '' });
      }
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
    } catch (err) {
      console.warn(`[OverviewTab] email save failed for ${fieldKey}`, err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
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
      {editing && !forceReadOnly ? (
        <>
          <input autoFocus type="email" value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
      ) : (
        <p onClick={startEdit} title={forceReadOnly ? undefined : 'Click to edit'}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
        >
          {saving ? 'Saving…' : (value || empty)}
        </p>
      )}
    </div>
  );
}

// ── ZIP field (validates + auto-populates city/state) ─────────────────────────

function ZipField({ value, cityValue, stateValue, patientId, patientRecordId, onSave, fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const { can } = usePermissions();

  function startEdit() { if (forceReadOnly) return; setDraft(value || ''); setError(''); setEditing(true); }

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
      catch (err) {
        console.warn('[OverviewTab] zip save failed', err);
        setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
        onSave('address_zip', value || '');
        if (patientRecordId) updateEntity('patients', patientRecordId, { address_zip: value || '' });
      }
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
    } catch (err) {
      console.warn('[OverviewTab] zip save failed', err);
      setError(err?.message?.replace(/^\[Patients\]\s*/, '') || 'Save failed');
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
      {editing && !forceReadOnly ? (
        <>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={save} onKeyDown={onKeyDown} style={error ? { ...ei(), borderColor: '#c62828' } : ei()} />
          {error && <p style={ve()}>{error}</p>}
        </>
      ) : (
        <p onClick={startEdit} title={forceReadOnly ? undefined : 'Click to edit'}
          style={{ ...ds(), opacity: saving ? 0.6 : 1, cursor: forceReadOnly ? 'default' : 'text' }}
          onMouseEnter={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { if (forceReadOnly) return; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
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
  const [otherValue, setOtherValue] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [saving, setSaving] = useState(false);

  // `patientId` is the Airtable record id (rec…); `patient.id` is the
  // business id (pat_…). syncPatientInsurances needs both — the first to
  // write the multipleRecordLinks field, the second to FIND existing rows.
  const patientBusinessId = patient.id;

  // ── Source of truth: PatientInsurances table ─────────────────────────────
  const { rows: realRows, loading: rowsLoading } = usePatientInsurances(patientBusinessId);

  // ── Local UI state ───────────────────────────────────────────────────────
  // The inputs are driven by local state, NOT directly by the hook. Reading
  // straight from `realRows` makes the field fight the user mid-typing,
  // because every save triggers a global refresh → refetch → re-derive →
  // input snaps back to the server-side value while the user is mid-word.
  // Local state is seeded once on first load, then becomes authoritative.
  const [plans, setPlans] = useState([]);
  const [details, setDetails] = useState({});
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    if (rowsLoading) return;            // wait for first fetch to settle

    const legacyDetails = getInsuranceDetailsMap(patient);

    // usePatientInsurances already hides soft-deleted rows. Once that query
    // has settled, trust plan list from PI — but fill empty member_id from
    // JSON so referral-stage CIN still shows when sync was partial.
    if (realRows.length > 0) {
      const RANK = { primary: 0, secondary: 1, tertiary: 2, unknown: 3 };
      const sorted = [...realRows].sort(
        (a, b) => (RANK[a.order_rank] ?? 3) - (RANK[b.order_rank] ?? 3),
      );
      setPlans(sorted.map((r) => r.payer_display_name).filter(Boolean));
      setDetails(Object.fromEntries(
        sorted
          .filter((r) => r.payer_display_name)
          .map((r) => {
            const fromRow = String(r.member_id || '').trim();
            const fromJson = memberIdFromDetail(legacyDetails[r.payer_display_name]);
            return [r.payer_display_name, fromRow || fromJson || ''];
          }),
      ));
    } else {
      const legacyRaw = patient.insurance_plans;
      // Explicit clear from a prior save — do not resurrect from insurance_plan
      if (legacyRaw === '' || legacyRaw === '[]') {
        setPlans([]);
        setDetails({});
      } else {
        // Un-migrated patient: fall back to the legacy JSON / primary once.
        let p = [];
        try { p = legacyRaw ? JSON.parse(legacyRaw) : []; } catch { p = []; }
        if (!Array.isArray(p)) p = [];
        if (p.length === 0 && patient.insurance_plan) p = [patient.insurance_plan];
        const d = {};
        for (const plan of p) {
          d[plan] = memberIdFromDetail(legacyDetails[plan]);
        }
        setPlans(p);
        setDetails(d);
      }
    }
    seededRef.current = true;
  }, [realRows, rowsLoading, patient]);

  // Heal PI from JSON when rows missing / CIN empty (referral sync gap).
  const healAttemptedRef = useRef(false);
  useEffect(() => {
    healAttemptedRef.current = false;
  }, [patientBusinessId]);

  useEffect(() => {
    if (healAttemptedRef.current || rowsLoading) return;
    if (!patientId || !patientBusinessId) return;
    healAttemptedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { healed } = await ensurePatientInsurancesFromJson({
          patient,
          patientRecordId: patientId,
          patientBusinessId,
        });
        if (healed && !cancelled) {
          seededRef.current = false; // re-seed from healed PatientInsurances
          triggerDataRefresh();
        }
      } catch (err) {
        console.warn('[InsuranceEditor] heal failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [patient, patientId, patientBusinessId, rowsLoading]);

  // If the patient swaps under us (drawer navigated to a different patient),
  // re-seed from the new source.
  useEffect(() => { seededRef.current = false; }, [patientBusinessId]);

  async function persist(nextPlans, nextDetails) {
    const primary = nextPlans[0] || '';
    const plansJson = JSON.stringify(nextPlans.length > 0 ? nextPlans : []);
    const detailsJson = JSON.stringify(
      Object.keys(nextDetails).length > 0 ? nextDetails : {},
    );

    // Mirror to the legacy JSON columns so existing readers (reports,
    // exports, list-column display) keep working unchanged. This is a
    // write-through copy — `PatientInsurances` is the source of truth.
    const fields = {
      insurance_plans: plansJson,
      insurance_plan_details: detailsJson,
      insurance_plan: primary,
    };
    onSave('insurance_plans', plansJson);
    onSave('insurance_plan_details', detailsJson);
    onSave('insurance_plan', primary);

    if (!patientId || !patientBusinessId) return;

    updateEntity('patients', patientId, fields);
    setSaving(true);
    try {
      await syncPatientInsurances({
        patientRecordId: patientId,
        patientBusinessId,
        plans: nextPlans,
        details: nextDetails,
      });
      await updatePatient(patientId, fields);
    } catch (err) {
      console.warn('[InsuranceEditor] persist failed', err);
    } finally {
      setSaving(false);
      triggerDataRefresh();
    }
  }

  // Plan toggles, removals, and "Other" additions are discrete clicks — they
  // update local state AND persist immediately.
  function togglePlan(plan) {
    const next = plans.includes(plan) ? plans.filter((p) => p !== plan) : [...plans, plan];
    const nextDetails = { ...details };
    if (!next.includes(plan)) delete nextDetails[plan];
    setPlans(next);
    setDetails(nextDetails);
    persist(next, nextDetails);
  }

  function removePlan(plan) {
    const next = plans.filter((p) => p !== plan);
    const nextDetails = { ...details };
    delete nextDetails[plan];
    setPlans(next);
    setDetails(nextDetails);
    persist(next, nextDetails);
  }

  function addOther() {
    if (!otherValue.trim()) return;
    const label = otherValue.trim();
    if (!plans.includes(label)) {
      const next = [...plans, label];
      setPlans(next);
      persist(next, details);
    }
    setOtherValue('');
    setShowOther(false);
  }

  // Member-ID typing updates local state on every keystroke (so the input
  // never fights the user), and persists once on blur. The blur compares
  // against the seeded value to skip no-op saves.
  function handleDetailChange(plan, value) {
    setDetails((prev) => ({ ...prev, [plan]: value }));
  }

  function handleDetailBlur(plan) {
    const real = realRows.find((r) => r.payer_display_name === plan);
    const serverVal = real?.member_id || '';
    const localVal  = details[plan] || '';
    if (serverVal === localVal) return;
    persist(plans, details);
  }

  return (
    <div>
      <InsurancePlanPicker
        selected={plans}
        onToggle={togglePlan}
        disabled={saving}
        triggerLabel={plans.length > 0 ? `${plans.length} plan${plans.length !== 1 ? 's' : ''}` : undefined}
      />

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
                onBlur={() => handleDetailBlur(plan)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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

// ── Primary phone + “copy to emergency contact” popup ─────────────────────────

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function OverviewTab({ patient, referral, readOnly = false }) {
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
      {/* ── 1. Patient identity ── */}
      <Section title="Patient">
        <EditableField label="First Name"        fieldKey="first_name"       value={patient.first_name}       patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} readOnly={readOnly} />
        <EditableField label="Last Name"         fieldKey="last_name"        value={patient.last_name}        patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} readOnly={readOnly} />
        <DobField patient={patient} patientId={patientId} onSave={handlePatientSave} referral={referral} readOnly={readOnly} />
        <EditablePatientSelect label="Gender"    fieldKey="gender"           value={patient.gender}           patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} options={GENDER_OPTIONS} readOnly={readOnly} />
        <EditablePatientSelect
          label="Language"
          fieldKey="preferred_language"
          value={patient.preferred_language || DEFAULT_LANGUAGE_CODE}
          displayValue={languageName(patient.preferred_language || DEFAULT_LANGUAGE_CODE)}
          patientId={patientId}
          patientRecordId={patientId}
          onSave={handlePatientSave}
          options={LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          readOnly={readOnly}
        />
        <EditableField label="Address"           fieldKey="address_street"   value={patient.address_street}   patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} fullWidth readOnly={readOnly} />
        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 16px' }}>
          <ZipField value={patient.address_zip?.toString()} cityValue={patient.address_city} stateValue={patient.address_state} patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} readOnly={readOnly} />
          <EditableField label="City"            fieldKey="address_city"     value={patient.address_city}     patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} readOnly={readOnly} />
          <EditableField label="State"           fieldKey="address_state"    value={patient.address_state}    patientId={patientId} patientRecordId={patientId} onSave={handlePatientSave} readOnly={readOnly} />
        </div>
      </Section>

      {/* ── Primary caregiver + emergency (synced; phone/email are not patient demos) ── */}
      <Section title="Contacts">
        <div style={{ gridColumn: '1 / -1' }}>
          {readOnly ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ReadField
                label="Primary caregiver"
                value={[
                  patient.primary_contact_name || patient.emergency_contact_name,
                  patient.primary_contact_relationship || patient.emergency_contact_relationship,
                  patient.primary_contact_phone || patient.phone_primary || patient.emergency_contact_phone,
                  patient.primary_contact_email || patient.email || patient.emergency_contact_email,
                ].filter(Boolean).join(' · ') || null}
                fullWidth
              />
              <ReadField
                label="Emergency contact"
                value={[patient.emergency_contact_name, patient.emergency_contact_relationship, patient.emergency_contact_phone].filter(Boolean).join(' · ') || null}
                fullWidth
              />
            </div>
          ) : (
            <ContactsEditor patient={patient} patientId={patientId} onSave={handlePatientSave} />
          )}
        </div>
      </Section>

      {/* ── Insurance ── */}
      <Section title="Insurance">
        <div style={{ gridColumn: '1 / -1' }}>
          {readOnly ? (
            <ReadField label="Insurance" value={(() => { try { const plans = patient.insurance_plans ? JSON.parse(patient.insurance_plans) : []; return plans.length ? plans.join(', ') : patient.insurance_plan || null; } catch { return patient.insurance_plan || null; } })()} fullWidth />
          ) : (
            <InsuranceEditor patient={patient} patientId={patientId} onSave={handlePatientSave} />
          )}
        </div>
      </Section>

    </div>
  );
}

function ContactsEditor({ patient, patientId, onSave }) {
  const [draft, setDraft] = useState(() => contactsFromPatient(patient));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setDraft(contactsFromPatient(patient));
  }, [
    patient?._id,
    patient?.primary_contact_name,
    patient?.primary_contact_phone,
    patient?.primary_contact_email,
    patient?.primary_contact_relationship,
    patient?.emergency_contact_name,
    patient?.emergency_contact_phone,
    patient?.emergency_contact_email,
    patient?.emergency_contact_relationship,
    patient?.phone_primary,
    patient?.email,
  ]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const { primary, emergency } = resolveContactsForSave(draft);
      // Keep mirrors + legacy demos in lockstep (phone_primary / email = caregiver).
      const mirror = {
        primary_contact_name: primary.name,
        primary_contact_phone: primary.phone,
        primary_contact_email: primary.email,
        primary_contact_relationship: primary.relationship,
        emergency_contact_name: emergency.name,
        emergency_contact_phone: emergency.phone,
        emergency_contact_email: emergency.email,
        emergency_contact_relationship: emergency.relationship,
        phone_primary: primary.phone || '',
        email: primary.email || '',
      };
      Object.entries(mirror).forEach(([k, v]) => onSave(k, v));
      updateEntity('patients', patientId, mirror);
      await updatePatient(patientId, mirror);

      if (primary.name || primary.phone) {
        await savePatientContactSlot({
          patientBusinessId: patient.id,
          patientRecordId: patientId,
          slot: 'primary',
          name: primary.name,
          phone: primary.phone,
          email: primary.email,
          relationship: primary.relationship,
          source: 'demographics',
        });
      }
      if (emergency.name || emergency.phone) {
        await savePatientContactSlot({
          patientBusinessId: patient.id,
          patientRecordId: patientId,
          slot: 'emergency',
          name: emergency.name,
          phone: emergency.phone,
          email: emergency.email,
          relationship: emergency.relationship,
          source: 'demographics',
        });
      }
      setDraft({
        primary,
        emergency: { ...emergency, same_as_primary: emergency.same_as_primary },
      });
      setMsg('Saved');
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      console.warn('[OverviewTab] contacts save failed', err);
      setMsg(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <GuardianContactFields value={draft} onChange={setDraft} showEmail inline />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            height: 34, padding: '0 16px', borderRadius: 8, border: 'none', cursor: saving ? 'default' : 'pointer',
            background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
            fontSize: 12.5, fontWeight: 650, fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save contacts'}
        </button>
        {msg && (
          <span style={{ fontSize: 12, fontWeight: 600, color: msg === 'Saved' ? palette.accentGreen.hex : palette.primaryMagenta.hex }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
