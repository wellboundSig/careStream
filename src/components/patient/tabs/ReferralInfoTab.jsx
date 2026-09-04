import { useState, useMemo, useEffect, useRef } from 'react';
import { updateReferral } from '../../../api/referrals.js';
import { updateEntity, useCareStore } from '../../../store/careStore.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import ChangeIntakeOwnerModal from '../../referrals/ChangeIntakeOwnerModal.jsx';
import ChangeMarketerModal from '../../referrals/ChangeMarketerModal.jsx';
import ChangeFacilityModal from '../../referrals/ChangeFacilityModal.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { inferAgeGroupFromDob } from '../../../utils/validation.js';
import { fmtCalendarDate } from '../../../utils/dateFormat.js';
import { isSourceBusinessId } from '../../../utils/sourceName.js';
import { REFERRAL_METHODS } from '../../referralSources/sourceConstants.js';

const DIVISIONS = ['ALF', 'Special Needs'];
const SERVICES_OPTIONS = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const SN_AGE_GROUPS = ['Adult', 'Pediatric'];

const LABEL_W = 132;
const muted = (a = 0.4) => hexToRgba(palette.backgroundDark.hex, a);
const ds = () => ({
  fontSize: 13, color: palette.backgroundDark.hex, margin: 0, padding: '1px 0',
  borderRadius: 4, cursor: 'text', border: '1px solid transparent',
  transition: 'border-color 0.12s, background 0.12s', wordBreak: 'break-word',
});
const ei = () => ({
  width: '100%', padding: '5px 8px', borderRadius: 6,
  border: `1px solid ${palette.primaryMagenta.hex}`, fontSize: 13,
  color: palette.backgroundDark.hex, background: hexToRgba(palette.backgroundDark.hex, 0.03),
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
});

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <p style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: muted(0.38), margin: '0 0 2px', paddingBottom: 6,
        borderBottom: `1px solid var(--color-border)`,
      }}>
        {title}
      </p>
      <div>{children}</div>
    </section>
  );
}

function TextAction({ children, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        fontSize: 11.5, fontWeight: 600, color: muted(0.4), background: 'none',
        border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
        whiteSpace: 'nowrap', lineHeight: 1.3,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = palette.primaryDeepPlum.hex; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = muted(0.4); }}
    >
      {children}
    </button>
  );
}

function FieldRow({ label, actions, children, hint }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `${LABEL_W}px minmax(0, 1fr) 108px`,
      columnGap: 16,
      alignItems: 'baseline',
      padding: '9px 0',
      borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.055)}`,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 650, color: muted(0.4), letterSpacing: '0.02em',
        paddingTop: 2, lineHeight: 1.35,
      }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>
        {children}
        {hint}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 12, minHeight: 18 }}>
        {actions || null}
      </div>
    </div>
  );
}

function ValueText({ value, empty = false, italic = false }) {
  return (
    <p style={{
      fontSize: 13, margin: 0, lineHeight: 1.4, wordBreak: 'break-word',
      color: empty ? muted(0.28) : palette.backgroundDark.hex,
      fontStyle: italic || empty ? 'italic' : 'normal',
    }}>
      {empty ? '—' : value}
    </p>
  );
}

function ReadField({ label, value }) {
  const empty = !value || value === '—';
  return (
    <FieldRow label={label}>
      <ValueText value={value} empty={empty} />
    </FieldRow>
  );
}

function EditableReferralSelect({ label, value, fieldKey, referralId, onSave, options, optionLabels = null, readOnly: forceReadOnly = false, allowBlank = false, blankLabel = 'Leave blank' }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { can } = usePermissions();

  async function handleChange(e) {
    if (!can(PERMISSION_KEYS.REFERRAL_EDIT)) return;
    const v = e.target.value;
    if (v === (value || '')) { setEditing(false); return; }
    onSave(fieldKey, v);
    setEditing(false);
    if (referralId) updateEntity('referrals', referralId, { [fieldKey]: v });
    setSaving(true);
    try { await updateReferral(referralId, { [fieldKey]: v }); }
    catch { onSave(fieldKey, value); if (referralId) updateEntity('referrals', referralId, { [fieldKey]: value }); }
    finally { setSaving(false); }
  }

  const display = value ? (optionLabels?.[value] || value) : null;
  return (
    <FieldRow label={label}>
      {editing ? (
        <select autoFocus value={value || ''} onChange={handleChange} onBlur={() => setEditing(false)} style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled={!allowBlank}>{allowBlank ? blankLabel : 'Select…'}</option>
          {options.map((o) => <option key={o} value={o}>{optionLabels?.[o] || o}</option>)}
        </select>
      ) : forceReadOnly ? (
        <ValueText value={saving ? 'Saving…' : display} empty={!display} />
      ) : (
        <p onClick={() => setEditing(true)} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1, color: display ? palette.backgroundDark.hex : muted(0.28), fontStyle: display ? 'normal' : 'italic' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
          {saving ? 'Saving…' : (display || '—')}
        </p>
      )}
    </FieldRow>
  );
}

function EditableReferralServices({ value, referralId, onSave, readOnly: forceReadOnly = false }) {
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
  return (
    <FieldRow label="Services">
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
            <button onClick={() => setEditing(false)} style={{ padding: '4px 10px', borderRadius: 5, background: 'none', border: `1px solid var(--color-border)`, fontSize: 12, color: muted(0.55), cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : forceReadOnly ? (
        <ValueText value={saving ? 'Saving…' : displayText} empty={!displayText} />
      ) : (
        <p onClick={startEdit} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1, color: displayText ? palette.backgroundDark.hex : muted(0.28), fontStyle: displayText ? 'normal' : 'italic' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
          {saving ? 'Saving…' : (displayText || '—')}
        </p>
      )}
    </FieldRow>
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

  const conflictWarning = conflictsWithDob ? (
    <p style={{ fontSize: 10.5, color: palette.primaryMagenta.hex, margin: '4px 0 0', fontWeight: 600 }}>
      Conflicts with DOB on file ({dobInferred}). Update one to match.
    </p>
  ) : null;

  return (
    <FieldRow label="Age group" hint={conflictWarning}>
      {editing && !forceReadOnly ? (
        <select autoFocus value={value} onChange={handleChange} onBlur={() => setEditing(false)} style={{ ...ei(), cursor: 'pointer' }}>
          <option value="" disabled>Select…</option>
          {SN_AGE_GROUPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : forceReadOnly ? (
        <ValueText value={saving ? 'Saving…' : value} empty={!value} />
      ) : (
        <p onClick={() => setEditing(true)} title="Click to edit" style={{ ...ds(), opacity: saving ? 0.6 : 1, color: value ? palette.backgroundDark.hex : muted(0.28), fontStyle: value ? 'normal' : 'italic' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
          {saving ? 'Saving…' : (value || '—')}
        </p>
      )}
    </FieldRow>
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
  const hasPhy = !!(physicianName && physicianName !== '—');
  return (
    <FieldRow
      label="Physician"
      actions={!editing && !forceReadOnly ? (
        <TextAction onClick={() => setEditing(true)}>{referral.physician_id ? 'Change' : 'Add'}</TextAction>
      ) : null}
    >
      {editing ? (
        <PhysicianPicker physicianId={referral.physician_id} physicianName={physicianName} onChange={handleSelect} compact />
      ) : (
        <ValueText
          value={saving ? 'Saving…' : (hasPhy ? `Dr. ${physicianName}` : null)}
          empty={!saving && !hasPhy}
        />
      )}
    </FieldRow>
  );
}

function EditableReferralSource({ referral, onSave, readOnly: forceReadOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const containerRef = useRef(null);
  const { resolveSource, resolveMarketer } = useLookups();
  const { can } = usePermissions();
  const storeSources = useCareStore((s) => s.referralSources) || {};

  const sourceRecord = useMemo(() => {
    const id = referral.referral_source_id;
    if (!id) return null;
    return Object.values(storeSources).find((s) => s.id === id || s._id === id) || null;
  }, [storeSources, referral.referral_source_id]);

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
    const prevMethod = referral.referral_method || '';
    const src = Object.values(storeSources).find((s) => s.id === sourceId);
    const nextMethod = (src?.method || '').trim();
    const patch = { referral_source_id: sourceId };
    if (nextMethod) patch.referral_method = nextMethod;
    onSave('referral_source_id', sourceId);
    if (nextMethod) onSave('referral_method', nextMethod);
    setEditing(false);
    setQuery('');
    if (referral._id) updateEntity('referrals', referral._id, patch);
    setSaving(true);
    try {
      await updateReferral(referral._id, patch);
    } catch {
      onSave('referral_source_id', prev);
      onSave('referral_method', prevMethod);
      if (referral._id) {
        updateEntity('referrals', referral._id, {
          referral_source_id: prev,
          referral_method: prevMethod,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const display = referral.referral_source_id
    ? (sourceRecord?.name || resolveSource(referral.referral_source_id))
    : null;
  const entityName = (sourceRecord?.source_entity || '').trim();
  const sourceType = (sourceRecord?.type || '').trim();
  const hasSource = !!(display && display !== '—');
  const marketerLabel = sourceRecord?.marketer_id
    ? resolveMarketer(sourceRecord.marketer_id)
    : null;

  const detailRows = sourceRecord ? [
    { label: 'Person', value: sourceRecord.name },
    { label: 'Company / Entity', value: entityName },
    { label: 'Category', value: sourceType },
    { label: 'Default method', value: sourceRecord.method },
    { label: 'Phone', value: sourceRecord.phone },
    { label: 'Email', value: sourceRecord.email },
    {
      label: 'Assigned marketer',
      value: marketerLabel && marketerLabel !== '—' ? marketerLabel : (sourceRecord.marketer_id || ''),
    },
    { label: 'Source ID', value: sourceRecord.id, mono: true },
  ].filter((r) => r.value) : [];

  const sourceActions = !editing ? (
    <>
      {hasSource && sourceRecord && (
        <TextAction testId="referral-source-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide' : 'Details'}
        </TextAction>
      )}
      {canEdit && (
        <TextAction onClick={() => { setEditing(true); setExpanded(false); }}>
          {referral.referral_source_id ? 'Change' : 'Add'}
        </TextAction>
      )}
    </>
  ) : null;

  return (
    <div ref={containerRef}>
      <FieldRow label="Source" actions={sourceActions}>
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
        <div style={{ opacity: saving ? 0.6 : 1 }}>
          <button
            type="button"
            onClick={() => { if (sourceRecord) setExpanded((v) => !v); }}
            disabled={!sourceRecord}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: sourceRecord ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
            title={sourceRecord ? (expanded ? 'Hide source details' : 'Show all source details') : undefined}
          >
            <span style={{
              display: 'block',
              fontSize: 13,
              fontWeight: hasSource ? 650 : 400,
              color: hasSource ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.28),
              fontStyle: hasSource ? 'normal' : 'italic',
            }}>
              {saving ? 'Saving…' : (hasSource ? display : '—')}
            </span>
            {!saving && entityName && (
              <span style={{
                display: 'block',
                marginTop: 2,
                fontSize: 12,
                fontWeight: 500,
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
              }}>
                {entityName}
                {sourceType ? ` · ${sourceType}` : ''}
              </span>
            )}
            {!saving && !entityName && sourceType && (
              <span style={{
                display: 'block',
                marginTop: 2,
                fontSize: 12,
                fontWeight: 500,
                color: hexToRgba(palette.backgroundDark.hex, 0.45),
              }}>
                {sourceType}
              </span>
            )}
          </button>
          {expanded && sourceRecord && (
            <div
              data-testid="referral-source-details"
              style={{
                marginTop: 6,
                marginLeft: 6,
                marginRight: 6,
                padding: '8px 12px',
                borderRadius: 8,
                background: hexToRgba(palette.backgroundDark.hex, 0.03),
              }}
            >
              {detailRows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '6px 0',
                    borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
                  }}
                >
                  <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), flexShrink: 0 }}>
                    {row.label}
                  </span>
                  <span style={{
                    fontSize: row.mono ? 11.5 : 12.5,
                    fontWeight: 550,
                    color: palette.backgroundDark.hex,
                    textAlign: 'right',
                    wordBreak: 'break-word',
                    fontFamily: row.mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
                  }}>
                    {row.value}
                  </span>
                </div>
              ))}
              {detailRows.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                  No directory details for this source.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </FieldRow>
    </div>
  );
}

export default function ReferralInfoTab({ patient, referral, readOnly = false }) {
  const { updateReferralLocal, updatePatientLocal } = usePatientDrawer();
  const { resolveMarketer, resolveUser, resolveFacility } = useLookups();
  const { can } = usePermissions();
  const canChangeOwner = can(PERMISSION_KEYS.LEADS_CHANGE_INTAKE_OWNER);
  const canChangeMarketer = can(PERMISSION_KEYS.REFERRAL_CHANGE_MARKETER);
  const canChangeFacility = can(PERMISSION_KEYS.REFERRAL_CHANGE_FACILITY);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const [showChangeMarketer, setShowChangeMarketer] = useState(false);
  const [showChangeFacility, setShowChangeFacility] = useState(false);

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
      {showChangeMarketer && (
        <ChangeMarketerModal
          referral={referral}
          patientName={patientLabel}
          onCancel={() => setShowChangeMarketer(false)}
          onDone={(fields) => {
            updateReferralLocal(fields);
            setShowChangeMarketer(false);
          }}
        />
      )}
      {showChangeFacility && (
        <ChangeFacilityModal
          referral={referral}
          patient={patient}
          patientName={patientLabel}
          onCancel={() => setShowChangeFacility(false)}
          onDone={({ fields, patientFields } = {}) => {
            if (fields) updateReferralLocal(fields);
            if (patientFields) updatePatientLocal(patientFields);
            setShowChangeFacility(false);
          }}
        />
      )}
      <Section title="Referral">
        <ReadField label="Referral ID" value={referral.id} />
        <ReadField label="Date" value={referral.referral_date ? fmtCalendarDate(referral.referral_date, null) : null} />
        <EditableReferralSelect
          label="Episode"
          fieldKey="episode_type"
          value={referral.episode_type || 'SOC'}
          referralId={referral._id}
          onSave={handleReferralSave}
          options={['SOC', 'ROC']}
          optionLabels={{ SOC: 'Start of Care', ROC: 'Resumption of Care' }}
          readOnly={readOnly}
        />
      </Section>

      <Section title="Assignment">
        <FieldRow
          label="Marketer"
          actions={canChangeMarketer && !readOnly ? (
            <TextAction onClick={() => setShowChangeMarketer(true)}>Change</TextAction>
          ) : null}
        >
          <ValueText value={resolveMarketer(referral.marketer_id)} empty={!referral.marketer_id || resolveMarketer(referral.marketer_id) === '—'} />
        </FieldRow>
        <FieldRow
          label="Intake owner"
          actions={canChangeOwner && !readOnly ? (
            <TextAction onClick={() => setShowChangeOwner(true)}>Change</TextAction>
          ) : null}
        >
          <ValueText value={resolveUser(referral.intake_owner_id)} empty={!referral.intake_owner_id || resolveUser(referral.intake_owner_id) === '—'} />
        </FieldRow>
        <ReadField label="Submitted by" value={resolveUser(referral.lead_created_by_id)} />
      </Section>

      <Section title="Source">
        <EditableReferralSource referral={referral} onSave={handleReferralSave} readOnly={readOnly} />
        <EditableReferralSelect
          label="Method"
          fieldKey="referral_method"
          value={referral.referral_method}
          referralId={referral._id}
          onSave={handleReferralSave}
          options={REFERRAL_METHODS}
          allowBlank
          blankLabel="Leave blank"
          readOnly={readOnly}
        />
      </Section>

      <Section title="Facility">
        <FieldRow
          label="Facility"
          actions={canChangeFacility && !readOnly ? (
            <TextAction onClick={() => setShowChangeFacility(true)}>Change</TextAction>
          ) : null}
        >
          <ValueText
            value={resolveFacility(referral.facility_id) !== '—' ? resolveFacility(referral.facility_id) : (referral.facility_id || null)}
            empty={!referral.facility_id}
          />
        </FieldRow>
        <ReadField label="COC nurse" value={resolveUser(referral.coc_nurse_id)} />
      </Section>

      <Section title="Care">
        <EditableReferralSelect label="Division" fieldKey="division" value={referral.division} referralId={referral._id} onSave={handleReferralSave} options={DIVISIONS} readOnly={readOnly} />
        {referral.division === 'Special Needs' && (
          <SnAgeGroupField referral={referral} patient={patient} onSave={handleReferralSave} readOnly={readOnly} />
        )}
        <EditableReferralServices value={referral.services_requested} referralId={referral._id} onSave={handleReferralSave} readOnly={readOnly} />
        <EditableReferralPhysician referral={referral} onSave={handleReferralSave} readOnly={readOnly} />
      </Section>

      {(referral.f2f_date || referral.f2f_expiration || referral.hold_reason || referral.ntuc_reason) && (
        <Section title="Status">
          {referral.f2f_date && <ReadField label="F2F date" value={fmtCalendarDate(referral.f2f_date)} />}
          {referral.f2f_expiration && <ReadField label="F2F expiration" value={fmtCalendarDate(referral.f2f_expiration)} />}
          {referral.hold_reason && <ReadField label="Hold reason" value={referral.hold_reason} />}
          {referral.ntuc_reason && <ReadField label="NTUC reason" value={referral.ntuc_reason} />}
        </Section>
      )}
    </div>
  );
}
