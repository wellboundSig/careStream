import { useState, useMemo, useEffect, useRef } from 'react';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity, useCareStore } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import ChangeIntakeOwnerModal from '../../referrals/ChangeIntakeOwnerModal.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { inferAgeGroupFromDob } from '../../../utils/validation.js';
import { fmtCalendarDate } from '../../../utils/dateFormat.js';
import { isSourceBusinessId } from '../../../utils/sourceName.js';

const DIVISIONS = ['ALF', 'Special Needs'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const SN_AGE_GROUPS = ['Adult', 'Pediatric'];

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

function EditableReferralSelect({ label, value, fieldKey, referralId, onSave, options, fullWidth = false, readOnly: forceReadOnly = false }) {
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
      ) : forceReadOnly ? (
        <p style={{ fontSize: 13, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: value ? 'normal' : 'italic', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : (value || empty)}
        </p>
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

function EditableReferralServices({ value, referralId, onSave, fullWidth = false, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();
  const current = Array.isArray(value) ? value : (value ? String(value).split(/,\s*/) : []);

  function startEdit() { if (forceReadOnly) return; setDraft([...current]); setEditing(true); }
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
      ) : forceReadOnly ? (
        <p style={{ fontSize: 13, color: displayText ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: displayText ? 'normal' : 'italic', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : (displayText || empty)}
        </p>
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

// ── SN Age Group (Adult/Pediatric) ──────────────────────────────────────────
// Surfaced on the Referral tab so users can correct an intake mistake.
// When a Pediatric referral is logged in error, the Demographics DOB
// picker stays locked to under-18 dates and the correct adult DOB can't
// be entered until the age group is fixed here — exposing this field
// is the unlock path.

function SnAgeGroupField({ referral, patient, onSave, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();

  const value = referral.sn_age_group || '';
  const dobInferred = patient?.dob ? inferAgeGroupFromDob(patient.dob) : null;
  const conflictsWithDob = value && dobInferred && value !== dobInferred;

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
    const v = e.target.value;
    if (v === value) { setEditing(false); return; }
    onSave('sn_age_group', v);
    setEditing(false);
    if (referral._id) updateEntity('referrals', referral._id, { sn_age_group: v });
    setSaving(true);
    try { await updateReferral(referral._id, { sn_age_group: v }); }
    catch { onSave('sn_age_group', value); if (referral._id) updateEntity('referrals', referral._id, { sn_age_group: value }); }
    finally { setSaving(false); }
  }

  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;
  const conflictWarning = conflictsWithDob ? (
    <p style={{ fontSize: 10.5, color: palette.primaryMagenta.hex, marginTop: 3, fontWeight: 600 }}>
      Conflicts with DOB on file ({dobInferred}). Update one to match.
    </p>
  ) : null;

  return (
    <div>
      <p style={fl()}>Age Group (SN)</p>
      {editing && !forceReadOnly ? (
        <select autoFocus value={value} onChange={handleChange} onBlur={() => setEditing(false)} style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled>Select…</option>
          {SN_AGE_GROUPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : forceReadOnly ? (
        <>
          <p style={{ fontSize: 13, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28), padding: '4px 6px', fontStyle: value ? 'normal' : 'italic', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : (value || empty)}
          </p>
          {conflictWarning}
        </>
      ) : (
        <>
          <p onClick={() => setEditing(true)} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
            {saving ? 'Saving…' : (value || empty)}
          </p>
          {conflictWarning}
        </>
      )}
    </div>
  );
}

function EditableReferralPhysician({ referral, onSave, readOnly: forceReadOnly = false }) {
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
        {!editing && !forceReadOnly && (
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

function EditableReferralSource({ referral, onSave, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const containerRef = useRef(null);
  const { resolveSource } = useLookups();
  const { can } = usePermissions();
  const storeSources = useCareStore((s) => s.referralSources) || {};

  // Dedicated key preferred; referral.edit kept as back-compat for existing grants.
  const canEdit = !forceReadOnly && (
    can(PERMISSION_KEYS.REFERRAL_EDIT_SOURCE) || can(PERMISSION_KEYS.REFERRAL_EDIT)
  );

  const options = useMemo(() => {
    const list = Object.values(storeSources)
      .filter((s) => {
        const active = s.is_active === undefined || s.is_active === null
          || String(s.is_active).toUpperCase() === 'TRUE' || s.is_active === true;
        return active || s.id === referral.referral_source_id;
      })
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
      .map((s) => {
        const entity = (s.source_entity || '').trim();
        const type = (s.type || '').trim();
        const meta = [type, entity].filter(Boolean).join(' · ');
        return {
          value: s.id,
          label: s.name || s.id,
          sublabel: meta || undefined,
          searchText: [s.name, type, entity].filter(Boolean).join(' '),
        };
      });
    // Keep orphan / free-text ids visible so staff can replace them.
    if (referral.referral_source_id && !list.some((o) => o.value === referral.referral_source_id)) {
      list.unshift({
        value: referral.referral_source_id,
        label: resolveSource(referral.referral_source_id) || referral.referral_source_id,
        sublabel: 'Current value (not in directory)',
        searchText: referral.referral_source_id,
      });
    }
    return list;
  }, [storeSources, referral.referral_source_id, resolveSource]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sublabel || ''} ${o.searchText || ''}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!editing) return undefined;
    function dismiss(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setEditing(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [editing]);

  async function pick(sourceId) {
    if (!canEdit) return;
    if (!sourceId || !isSourceBusinessId(sourceId)) return;
    if (sourceId === referral.referral_source_id) {
      setEditing(false);
      setQuery('');
      return;
    }
    const prev = referral.referral_source_id;
    onSave('referral_source_id', sourceId);
    setEditing(false);
    setQuery('');
    if (referral._id) updateEntity('referrals', referral._id, { referral_source_id: sourceId });
    setSaving(true);
    try {
      await updateReferral(referral._id, { referral_source_id: sourceId });
    } catch {
      onSave('referral_source_id', prev);
      if (referral._id) updateEntity('referrals', referral._id, { referral_source_id: prev });
    } finally {
      setSaving(false);
    }
  }

  const display = referral.referral_source_id
    ? resolveSource(referral.referral_source_id)
    : null;
  const empty = <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ gridColumn: '1 / -1' }} ref={containerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <p style={fl()}>Referral Source</p>
        {!editing && canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: palette.accentBlue.hex, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {referral.referral_source_id ? 'Change' : '+ Add'}
          </button>
        )}
      </div>
      {editing ? (
        <div style={{
          borderRadius: 8, border: `1px solid ${palette.primaryMagenta.hex}`,
          background: hexToRgba(palette.backgroundDark.hex, 0.02), overflow: 'hidden',
        }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources…"
            style={{
              width: '100%', padding: '8px 10px', border: 'none',
              borderBottom: '1px solid var(--color-border)',
              background: 'transparent', outline: 'none', fontSize: 13,
              fontFamily: 'inherit', color: palette.backgroundDark.hex, boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '12px 10px' }}>
                No matching sources
              </p>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '8px 10px', background: o.value === referral.referral_source_id
                    ? hexToRgba(palette.accentBlue.hex, 0.08) : 'transparent',
                  display: 'block',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05); }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = o.value === referral.referral_source_id
                    ? hexToRgba(palette.accentBlue.hex, 0.08) : 'transparent';
                }}
              >
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{o.label}</span>
                {o.sublabel && (
                  <span style={{ display: 'block', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 1 }}>{o.sublabel}</span>
                )}
              </button>
            ))}
          </div>
          <div style={{ padding: '6px 10px', borderTop: '1px solid var(--color-border)' }}>
            <button
              type="button"
              onClick={() => { setEditing(false); setQuery(''); }}
              style={{
                padding: '4px 10px', borderRadius: 5, background: 'none',
                border: '1px solid var(--color-border)', fontSize: 12,
                color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p style={{
          fontSize: 13,
          color: display && display !== '—' ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28),
          padding: '4px 6px',
          fontStyle: display && display !== '—' ? 'normal' : 'italic',
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Saving…' : (display && display !== '—' ? display : empty)}
        </p>
      )}
    </div>
  );
}

export default function ReferralInfoTab({ patient, referral, readOnly = false }) {
  const { updateReferralLocal } = usePatientDrawer();
  const { resolveMarketer, resolveUser, resolveFacility } = useLookups();
  const { can } = usePermissions();
  const canChangeOwner = can(PERMISSION_KEYS.LEADS_CHANGE_INTAKE_OWNER);
  const [showChangeOwner, setShowChangeOwner] = useState(false);

  function handleReferralSave(field, value) { updateReferralLocal({ [field]: value }); }

  if (!referral) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No referral data available.</p>
      </div>
    );
  }

  const patientLabel = patient
    ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
    : null;

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      {showChangeOwner && (
        <ChangeIntakeOwnerModal
          referral={referral}
          patientName={patientLabel}
          onCancel={() => setShowChangeOwner(false)}
          onDone={(fields) => {
            updateReferralLocal(fields);
            setShowChangeOwner(false);
          }}
        />
      )}
      <Section title="Referral Info">
        <ReadField label="Referral ID" value={referral.id} />
        <ReadField label="Referral Date" value={referral.referral_date ? new Date(referral.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null} />
        <ReadField label="Marketer" value={resolveMarketer(referral.marketer_id)} />
        <ReadField
          label="Lead submitted by"
          value={resolveUser(referral.lead_created_by_id)}
        />
        <div>
          <p style={fl()}>Intake Owner</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
            <p style={{
              fontSize: 13, flex: 1, margin: 0,
              color: referral.intake_owner_id ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28),
              fontStyle: referral.intake_owner_id ? 'normal' : 'italic',
            }}>
              {resolveUser(referral.intake_owner_id) || '—'}
            </p>
            {canChangeOwner && !readOnly && (
              <button
                type="button"
                onClick={() => setShowChangeOwner(true)}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 650,
                  background: hexToRgba(palette.accentBlue.hex, 0.12),
                  color: palette.accentBlue.hex, flexShrink: 0,
                }}
              >
                Change
              </button>
            )}
          </div>
        </div>
        <EditableReferralSource referral={referral} onSave={handleReferralSave} readOnly={readOnly} />
        {referral.facility_id && <ReadField label="Facility" value={resolveFacility(referral.facility_id)} />}

        <EditableReferralSelect label="Division" fieldKey="division" value={referral.division} referralId={referral._id} onSave={handleReferralSave} options={DIVISIONS} readOnly={readOnly} />
        {referral.division === 'Special Needs' && (
          <SnAgeGroupField referral={referral} patient={patient} onSave={handleReferralSave} readOnly={readOnly} />
        )}
        <EditableReferralServices value={referral.services_requested} referralId={referral._id} onSave={handleReferralSave} fullWidth readOnly={readOnly} />
        <EditableReferralPhysician referral={referral} onSave={handleReferralSave} readOnly={readOnly} />

        {referral.f2f_date && <ReadField label="F2F Date" value={fmtCalendarDate(referral.f2f_date)} />}
        {referral.f2f_expiration && <ReadField label="F2F Expiration" value={fmtCalendarDate(referral.f2f_expiration)} />}
        {referral.hold_reason && <ReadField label="Hold Reason" value={referral.hold_reason} fullWidth />}
        {referral.ntuc_reason && <ReadField label="NTUC Reason" value={referral.ntuc_reason} fullWidth />}
      </Section>
    </div>
  );
}
