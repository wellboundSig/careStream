import { useState, useEffect, useMemo } from 'react';
import { createPhysician } from '../../api/physicians.js';
import { clearLookupsCache } from '../../hooks/useLookups.js';
import { usePhysicians, refreshPhysicians } from '../../hooks/usePhysicians.js';
import { useCareStore } from '../../store/careStore.js';
import PhysicianDrawer from '../../components/physicians/PhysicianDrawer.jsx';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { normalizePhone, lookupZip } from '../../utils/validation.js';

const BASE_INPUT = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  border: `1px solid var(--color-border)`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

function TInput({ value, onChange, placeholder, type = 'text', autoFocus, maxLength }) {
  return (
    <input
      type={type} value={value || ''} placeholder={placeholder} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      style={BASE_INPUT}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.15))}
    />
  );
}

function FG({ label, required, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4 }}>
        {label}{required && <span style={{ color: palette.primaryMagenta.hex }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function AddPhysicianModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', npi: '', phone: '', fax: '', address_street: '', address_city: '', address_state: '', address_zip: '', is_pecos_enrolled: false, is_opra_enrolled: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First name and last name are required.');
      return;
    }

    const errs = {};
    let cleanPhone = form.phone?.trim() || '';
    let cleanFax = form.fax?.trim() || '';
    let cleanCity = form.address_city;
    let cleanState = form.address_state;

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
    if (form.address_zip?.trim()) {
      const r = lookupZip(form.address_zip);
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
    setForm(f => ({ ...f, phone: cleanPhone, fax: cleanFax, address_city: cleanCity, address_state: cleanState }));

    setSaving(true);
    setError('');
    try {
      const fields = {
        id: `phy_${Date.now()}`,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        ...(form.npi            ? { npi: form.npi.trim() }               : {}),
        ...(cleanPhone          ? { phone: cleanPhone }                   : {}),
        ...(cleanFax            ? { fax: cleanFax }                       : {}),
        ...(form.address_street ? { address_street: form.address_street.trim() } : {}),
        ...(cleanCity?.trim()   ? { address_city: cleanCity.trim() }      : {}),
        ...(cleanState?.trim()  ? { address_state: cleanState.trim() }    : {}),
        ...(form.address_zip    ? { address_zip: form.address_zip.trim() }: {}),
        ...(form.is_pecos_enrolled ? { is_pecos_enrolled: true } : {}),
        ...(form.is_opra_enrolled  ? { is_opra_enrolled: true }  : {}),
        is_active: 'Active',
        created_at: new Date().toISOString(),
      };
      const rec = await createPhysician(fields);
      const newPhy = { _id: rec.id, ...rec.fields };
      clearLookupsCache();
      refreshPhysicians();
      onAdded(newPhy);
    } catch (e) {
      setError(e.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Add Physician</p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>New physician will be added to the directory.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '2px 6px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FG label="First Name" required><TInput value={form.first_name} onChange={set('first_name')} placeholder="First" autoFocus /></FG>
            <FG label="Last Name" required><TInput value={form.last_name} onChange={set('last_name')} placeholder="Last" /></FG>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FG label="NPI"><TInput value={form.npi} onChange={set('npi')} placeholder="1234567890" /></FG>
            <FG label="Phone">
              <TInput value={form.phone} onChange={(v) => { set('phone')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.phone) setFieldErrors(e => ({ ...e, phone: '' })); }} type="tel" placeholder="(718) 555-1234" />
              {fieldErrors.phone && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.phone}</p>}
            </FG>
          </div>
          <FG label="Fax">
            <TInput value={form.fax} onChange={(v) => { set('fax')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.fax) setFieldErrors(e => ({ ...e, fax: '' })); }} type="tel" placeholder="(718) 555-5678" />
            {fieldErrors.fax && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.fax}</p>}
          </FG>
          <FG label="Address"><TInput value={form.address_street} onChange={set('address_street')} placeholder="Street address" /></FG>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <FG label="City"><TInput value={form.address_city} onChange={set('address_city')} placeholder="City" /></FG>
            <FG label="State"><TInput value={form.address_state} onChange={set('address_state')} placeholder="NY" /></FG>
            <FG label="Zip">
              <TInput value={form.address_zip} onChange={(v) => { set('address_zip')(v); if (fieldErrors.address_zip) setFieldErrors(e => ({ ...e, address_zip: '' })); }} placeholder="11201" maxLength={5} />
              {fieldErrors.address_zip && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.address_zip}</p>}
            </FG>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_pecos_enrolled} onChange={(e) => set('is_pecos_enrolled')(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }} />
              PECOS enrolled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_opra_enrolled} onChange={(e) => set('is_opra_enrolled')(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }} />
              OPRA enrolled
            </label>
          </div>
          {error && <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex }}>{error}</p>}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 13, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '7px 20px', borderRadius: 7, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Add Physician'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ value, label }) {
  const ok = value === true || value === 'true';
  return (
    <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 7px', borderRadius: 10, background: ok ? hexToRgba(palette.accentGreen.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.07), color: ok ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>
      {label} {ok ? '✓' : '—'}
    </span>
  );
}

export default function Physicians() {
  const { physicians } = usePhysicians();
  const storeRefs = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');
  const [showAddModal, setShowAddModal] = useState(false);

  const refCounts = useMemo(() => {
    const map = {};
    Object.values(storeRefs).forEach((r) => {
      const pid = r.physician_id;
      if (pid) map[pid] = (map[pid] || 0) + 1;
    });
    return map;
  }, [storeRefs]);

  function handlePhysicianAdded(newPhy) {
    refreshPhysicians();
    clearLookupsCache();
    setShowAddModal(false);
  }

  const filtered = useMemo(() => {
    let list = physicians.filter((p) => {
      if (p.is_active !== 'Active') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || (p.npi?.toString() || '').includes(q);
      }
      return true;
    });
    return [...list].sort((a, b) => {
      const va = (a[sortField] || '').toString().toLowerCase();
      const vb = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [physicians, search, sortField, sortDir]);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  function toggleSort(f) {
    if (sortField === f) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  }

  const colHdr = (label, field) => (
    <th onClick={field ? () => toggleSort(field) : undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default' }}>
      {label} {field && sortField === field && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  );

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Physicians</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} physicians</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, NPI…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
            </div>
          </div>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {colHdr('Physician', 'last_name')}
                {colHdr('NPI', null)}
                {colHdr('PECOS / OPRA', null)}
                {colHdr('Location', null)}
                {colHdr('Referrals', null)}
              </tr>
            </thead>
            <tbody>
              {!hydrated ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} columns={5} />)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No physicians found.</td></tr>
              ) : filtered.map((phy) => (
                <PhysicianRow key={phy._id} physician={phy} refCount={refCounts[phy.id] || 0} onOpen={() => setSelected(phy)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PhysicianDrawer physician={selected} onClose={() => setSelected(null)} />

      {showAddModal && (
        <AddPhysicianModal
          onClose={() => setShowAddModal(false)}
          onAdded={handlePhysicianAdded}
        />
      )}
    </>
  );
}

function PhysicianRow({ physician: phy, refCount, onOpen }) {
  const [hov, setHov] = useState(false);
  return (
    <tr onDoubleClick={onOpen} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      title="Double-click for details"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent', transition: 'background 0.1s', cursor: 'default' }}>
      <td style={{ padding: '11px 14px' }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>Dr. {phy.first_name} {phy.last_name}</p>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{phy.npi || '—'}</td>
      <td style={{ padding: '11px 14px' }}>
        <div style={{ display: 'flex', gap: 5 }}>
          <StatusPill value={phy.is_pecos_enrolled} label="PECOS" />
          <StatusPill value={phy.is_opra_enrolled} label="OPRA" />
        </div>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
        {phy.address_city ? `${phy.address_city}, ${phy.address_state}` : '—'}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: refCount > 0 ? 650 : 400, color: refCount > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>
        {refCount}
      </td>
    </tr>
  );
}
