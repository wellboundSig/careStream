/**
 * PhysicianPicker — reusable physician search + add-new component.
 *
 * Props:
 *   physicianId   string|null   — existing physician ID (for pre-selecting on edit)
 *   physicianName string|null   — fallback display name when ID not in system
 *   onChange      (phy|null)    — called with full physician object or null on clear
 *   readOnly      bool
 *   compact       bool          — tighter layout for use inside forms
 */
import { useState, useEffect, useRef } from 'react';
import { createPhysician } from '../../api/physicians.js';
import { clearLookupsCache } from '../../hooks/useLookups.js';
import { useCareStore } from '../../store/careStore.js';
import {
  prefetchPhysicians,
  refreshPhysicians,
  getPhysiciansCache,
  subscribeToPhysicians,
} from '../../hooks/usePhysicians.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import { normalizePhone, lookupZip } from '../../utils/validation.js';

// Kept for backward-compat — any existing callers of this still work.
export function invalidatePhysicianPickerCache() {
  refreshPhysicians();
}

const BASE_INPUT = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  border: `1px solid var(--color-border)`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 12.5, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div>;
}
function Row4({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr .7fr .9fr', gap: 8 }}>{children}</div>;
}
function FieldGroup({ label, required, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4, letterSpacing: '0.02em' }}>
        {label}{required && <span style={{ color: palette.primaryMagenta.hex }}> *</span>}
      </label>
      {children}
    </div>
  );
}
function TInput({ value, onChange, placeholder, type = 'text', autoFocus, maxLength }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      style={BASE_INPUT}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.15))}
    />
  );
}

function phyDisplayName(phy) {
  if (!phy) return '';
  return `Dr. ${phy.first_name || ''} ${phy.last_name || ''}`.trim();
}
function phyAddress(phy) {
  if (!phy) return '';
  return [phy.address_street, phy.address_city, phy.address_state, phy.address_zip].filter(Boolean).join(', ');
}

export default function PhysicianPicker({ physicianId, physicianName, onChange, readOnly, compact = false }) {
  const storePhysicians = useCareStore((s) => s.physicians);
  const physicians = Object.values(storePhysicians || {}).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));

  const [query, setQuery] = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const [mode, setMode] = useState('idle');
  const [selected, setSelected] = useState(null);
  const [addForm, setAddForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!physicianId) return;
    const found = physicians.find((p) => p.id === physicianId || p._id === physicianId);
    if (found) { setSelected(found); setMode('selected'); }
    else if (physicianName) {
      setSelected({ _notInDb: true, display: physicianName });
      setMode('selected');
    }
  }, [physicianId, physicianName, physicians.length]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowDrop(false);
        if (mode === 'searching') setMode(selected ? 'selected' : 'idle');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mode, selected]);

  const matches = query.trim()
    ? physicians.filter((p) =>
        `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().includes(query.toLowerCase()) ||
        (p.npi?.toString() || '').includes(query)
      )
    : physicians.slice(0, 12);

  function handleQueryChange(q) {
    setQuery(q);
    setShowDrop(true);
    setMode('searching');
  }

  function selectPhysician(phy) {
    setSelected(phy);
    setMode('selected');
    setShowDrop(false);
    setQuery('');
    onChange(phy);
  }

  function handleClear() {
    setSelected(null);
    setMode('idle');
    setQuery('');
    onChange(null);
  }

  function startAdding() {
    const parts = query.trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
    setAddForm({ first_name: first, last_name: last, npi: '', phone: '', fax: '', address_street: '', address_city: '', address_state: '', address_zip: '' });
    setMode('adding');
    setShowDrop(false);
    setAddError('');
    setFieldErrors({});
  }

  async function confirmAdd() {
    if (!addForm.first_name?.trim() || !addForm.last_name?.trim()) {
      setAddError('First name and last name are required.');
      return;
    }

    const errs = {};
    let cleanPhone = addForm.phone?.trim() || '';
    let cleanFax = addForm.fax?.trim() || '';
    let cleanCity = addForm.address_city;
    let cleanState = addForm.address_state;

    if (cleanPhone) {
      const r = normalizePhone(cleanPhone);
      if (!r.valid) errs.phone = r.error;
      else cleanPhone = r.digits;
    }
    if (cleanFax) {
      const r = normalizePhone(cleanFax);
      if (!r.valid) errs.fax = r.error;
      else cleanFax = r.digits;
    }
    if (addForm.address_zip?.trim()) {
      const r = lookupZip(addForm.address_zip);
      if (!r.valid) errs.address_zip = r.error;
      else {
        if (!cleanCity?.trim()) cleanCity = r.city;
        if (!cleanState?.trim()) cleanState = r.state;
      }
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setAddForm(f => ({ ...f, phone: cleanPhone, fax: cleanFax, address_city: cleanCity, address_state: cleanState }));

    setSaving(true);
    setAddError('');
    try {
      const fields = {
        id: `phy_${Date.now()}`,
        first_name: addForm.first_name.trim(),
        last_name: addForm.last_name.trim(),
        ...(addForm.npi            ? { npi: addForm.npi.trim() }                         : {}),
        ...(cleanPhone             ? { phone: cleanPhone }                                : {}),
        ...(cleanFax               ? { fax: cleanFax }                                    : {}),
        ...(addForm.address_street ? { address_street: addForm.address_street.trim() }   : {}),
        ...(cleanCity?.trim()      ? { address_city: cleanCity.trim() }                  : {}),
        ...(cleanState?.trim()     ? { address_state: cleanState.trim() }                : {}),
        ...(addForm.address_zip    ? { address_zip: addForm.address_zip.trim() }         : {}),
        is_active: 'Active',
        created_at: new Date().toISOString(),
      };
      const rec = await createPhysician(fields);
      const newPhy = { _id: rec.id, ...rec.fields };
      refreshPhysicians();
      clearLookupsCache();
      useCareStore.setState((s) => ({
        physicians: { ...s.physicians, [rec.id]: newPhy },
      }));
      setSelected(newPhy);
      setMode('selected');
      setQuery('');
      onChange(newPhy);
    } catch (e) {
      setAddError(e.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── READ-ONLY ────────────────────────────────────────────────────────────────
  if (readOnly) {
    if (!selected && !physicianName) return <span style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.3), fontStyle: 'italic' }}>—</span>;
    if (!selected && physicianName) return <span style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{physicianName}</span>;
    if (selected._notInDb) return <span style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{selected.display}</span>;
    return (
      <div style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 600 }}>{phyDisplayName(selected)}</span>
        {selected.phone && <><br /><span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 12 }}>Ph: {selected.phone}</span></>}
        {selected.fax   && <><span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 12 }}> · Fax: {selected.fax}</span></>}
      </div>
    );
  }

  // ── SELECTED MODE ────────────────────────────────────────────────────────────
  if (mode === 'selected' && selected) {
    const addr = selected._notInDb ? null : phyAddress(selected);
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.4)}`, background: hexToRgba(palette.accentGreen.hex, 0.04), padding: compact ? '8px 12px' : '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke={palette.accentGreen.hex} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                {selected._notInDb ? selected.display : phyDisplayName(selected)}
              </span>
              {selected.npi && !selected._notInDb && (
                <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), background: hexToRgba(palette.backgroundDark.hex, 0.06), padding: '1px 6px', borderRadius: 4 }}>NPI {selected.npi}</span>
              )}
            </div>
            {!selected._notInDb && (selected.phone || selected.fax) && (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 1 }}>
                {selected.phone && `Ph: ${selected.phone}`}
                {selected.phone && selected.fax && '  ·  '}
                {selected.fax && `Fax: ${selected.fax}`}
              </p>
            )}
            {addr && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 1 }}>{addr}</p>}
          </div>
          <button
            onClick={handleClear}
            style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = palette.primaryMagenta.hex)}
            onMouseLeave={(e) => (e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.45))}
          >
            × Change
          </button>
        </div>
      </div>
    );
  }

  // ── ADDING MODE ──────────────────────────────────────────────────────────────
  if (mode === 'adding') {
    const set = (k) => (v) => setAddForm((f) => ({ ...f, [k]: v }));
    return (
      <div style={{ borderRadius: 8, border: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.02), padding: compact ? '12px 14px' : '16px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 12 }}>New Physician</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row2>
            <FieldGroup label="First Name" required><TInput value={addForm.first_name} onChange={set('first_name')} placeholder="First" autoFocus /></FieldGroup>
            <FieldGroup label="Last Name" required><TInput value={addForm.last_name} onChange={set('last_name')} placeholder="Last" /></FieldGroup>
          </Row2>
          <Row2>
            <FieldGroup label="NPI"><TInput value={addForm.npi} onChange={set('npi')} placeholder="1234567890" /></FieldGroup>
            <FieldGroup label="Phone">
              <TInput value={addForm.phone} onChange={(v) => { set('phone')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.phone) setFieldErrors(e => ({ ...e, phone: '' })); }} placeholder="(718) 555-1234" type="tel" />
              {fieldErrors.phone && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.phone}</p>}
            </FieldGroup>
          </Row2>
          <FieldGroup label="Fax">
            <TInput value={addForm.fax} onChange={(v) => { set('fax')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.fax) setFieldErrors(e => ({ ...e, fax: '' })); }} placeholder="(718) 555-5678" type="tel" />
            {fieldErrors.fax && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.fax}</p>}
          </FieldGroup>
          <FieldGroup label="Address"><TInput value={addForm.address_street} onChange={set('address_street')} placeholder="Street address" /></FieldGroup>
          <Row4>
            <FieldGroup label="City"><TInput value={addForm.address_city} onChange={set('address_city')} placeholder="City" /></FieldGroup>
            <FieldGroup label="State"><TInput value={addForm.address_state} onChange={set('address_state')} placeholder="NY" /></FieldGroup>
            <FieldGroup label="Zip">
              <TInput value={addForm.address_zip} onChange={(v) => { set('address_zip')(v); if (fieldErrors.address_zip) setFieldErrors(e => ({ ...e, address_zip: '' })); }} placeholder="11201" maxLength={5} />
              {fieldErrors.address_zip && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.address_zip}</p>}
            </FieldGroup>
          </Row4>
        </div>
        {addError && (
          <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginTop: 10 }}>{addError}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <button
            onClick={() => { setMode(selected ? 'selected' : 'idle'); setQuery(''); }}
            style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Back to search
          </button>
          <button
            onClick={confirmAdd}
            disabled={saving}
            style={{ padding: '7px 18px', borderRadius: 7, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: '#fff', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Confirm & Add to Directory'}
          </button>
        </div>
      </div>
    );
  }

  // ── IDLE / SEARCHING MODE ────────────────────────────────────────────────────
  const hasExactNoMatch = query.trim().length > 1 && matches.length === 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8"/>
          <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search physician by name or NPI…"
          style={{ ...BASE_INPUT, paddingLeft: 32 }}
          onFocus={(e) => { setShowDrop(true); if (mode === 'idle') setMode('searching'); e.target.style.borderColor = palette.primaryMagenta.hex; }}
          onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.15))}
        />
      </div>

      {showDrop && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 300, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 8, boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.12)}`, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          {matches.length === 0 && !hasExactNoMatch && (
            <p style={{ padding: '10px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>Start typing to search…</p>
          )}
          {matches.map((phy) => (
            <button
              key={phy._id}
              onMouseDown={() => selectPhysician(phy)}
              style={{ width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div>
                <span style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{phyDisplayName(phy)}</span>
                {(phy.phone || phy.address_city) && (
                  <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), display: 'block', marginTop: 1 }}>
                    {[phy.phone, phy.address_city && `${phy.address_city}, ${phy.address_state}`].filter(Boolean).join('  ·  ')}
                  </span>
                )}
              </div>
              {phy.npi && <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), flexShrink: 0 }}>NPI {phy.npi}</span>}
            </button>
          ))}
          {/* Add new option */}
          <div style={{ borderTop: matches.length ? `1px solid var(--color-border)` : 'none' }}>
            <button
              onMouseDown={startAdding}
              style={{ width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.06))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke={palette.accentGreen.hex} strokeWidth="2" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: palette.accentGreen.hex }}>
                {query.trim() ? `Add "${query.trim()}" as new physician` : 'Add new physician'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
