import { useState, useMemo } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import FacilityDrawer from '../../components/facilities/FacilityDrawer.jsx';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// Values exactly as stored in Airtable (ALL CAPS single-select)
export const FACILITY_TYPES = [
  'NURSING HOME',
  'ASSISTED LIVING FACILITY',
  'CARE COORDINATION ORG',
  'SKILLED NURSING FACILITY',
  'HOSPITAL',
  'PHARMACY',
  'REFERRAL SOURCE',
  'FUNERAL HOME',
  'OTHER',
];

// Display label for the badge — title-cases the raw Airtable value
export function typeLabel(raw) {
  if (!raw) return 'Other';
  return raw
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export const TYPE_COLORS = {
  'NURSING HOME':              { bg: hexToRgba(palette.accentBlue.hex, 0.14),      text: palette.accentBlue.hex },
  'ASSISTED LIVING FACILITY':  { bg: hexToRgba(palette.highlightYellow.hex, 0.22), text: '#7A5F00' },
  'CARE COORDINATION ORG':     { bg: hexToRgba(palette.accentGreen.hex, 0.15),     text: palette.accentGreen.hex },
  'SKILLED NURSING FACILITY':  { bg: hexToRgba(palette.accentOrange.hex, 0.15),    text: palette.accentOrange.hex },
  'HOSPITAL':                  { bg: hexToRgba(palette.primaryMagenta.hex, 0.15),  text: palette.primaryMagenta.hex },
  'PHARMACY':                  { bg: hexToRgba(palette.accentGreen.hex, 0.12),     text: '#2e7d52' },
  'REFERRAL SOURCE':           { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.1),  text: palette.primaryDeepPlum.hex },
  'FUNERAL HOME':              { bg: hexToRgba(palette.backgroundDark.hex, 0.1),   text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'OTHER':                     { bg: hexToRgba(palette.backgroundDark.hex, 0.08),  text: hexToRgba(palette.backgroundDark.hex, 0.55) },
};

// Region values exactly as stored in Airtable (ALL CAPS single-select)
export const FACILITY_REGIONS = [
  'LI', 'NYC', 'NASSAU', 'BRONX', 'KINGS', 'SUFFOLK',
  'NEW YORK', 'QUEENS', 'WESTCHESTER', 'BROOME', 'BERGEN',
  'RICHMOND', 'ROCKLAND', 'MONMOUTH', 'PUTNAM', 'DUTCHESS', 'DALLAS',
];

// Color palette cycles for regions — keyed uppercase for case-insensitive lookup
export const REGION_COLORS = {
  LI:          { bg: hexToRgba(palette.accentBlue.hex, 0.14),        text: palette.accentBlue.hex },
  NYC:         { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  NASSAU:      { bg: hexToRgba(palette.accentGreen.hex, 0.14),       text: palette.accentGreen.hex },
  BRONX:       { bg: hexToRgba(palette.primaryMagenta.hex, 0.12),    text: palette.primaryMagenta.hex },
  KINGS:       { bg: hexToRgba(palette.highlightYellow.hex, 0.22),   text: '#7A5F00' },
  SUFFOLK:     { bg: hexToRgba(palette.accentBlue.hex, 0.1),         text: '#1a5fa8' },
  'NEW YORK':  { bg: hexToRgba(palette.primaryMagenta.hex, 0.08),    text: '#8b2070' },
  QUEENS:      { bg: hexToRgba(palette.accentGreen.hex, 0.1),        text: '#2e7d52' },
  WESTCHESTER: { bg: hexToRgba(palette.accentGreen.hex, 0.18),       text: palette.accentGreen.hex },
  BROOME:      { bg: hexToRgba(palette.accentOrange.hex, 0.1),       text: palette.accentOrange.hex },
  BERGEN:      { bg: hexToRgba(palette.accentBlue.hex, 0.18),        text: palette.accentBlue.hex },
  RICHMOND:    { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.1),    text: palette.primaryDeepPlum.hex },
  ROCKLAND:    { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: '#b35a00' },
  MONMOUTH:    { bg: hexToRgba(palette.highlightYellow.hex, 0.18),   text: '#7A5F00' },
  PUTNAM:      { bg: hexToRgba(palette.accentGreen.hex, 0.12),       text: '#2e7d52' },
  DUTCHESS:    { bg: hexToRgba(palette.primaryMagenta.hex, 0.1),     text: palette.primaryMagenta.hex },
  DALLAS:      { bg: hexToRgba(palette.accentOrange.hex, 0.12),      text: palette.accentOrange.hex },
  OTHER:       { bg: hexToRgba(palette.backgroundDark.hex, 0.08),    text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

export function TypeBadge({ type, size = 'default' }) {
  const key = (type || '').toUpperCase();
  const c = TYPE_COLORS[key] || TYPE_COLORS['OTHER'];
  const isSmall = size === 'small';
  return (
    <span style={{ fontSize: isSmall ? 11 : 12, fontWeight: 650, padding: isSmall ? '2px 8px' : '3px 10px', borderRadius: 20, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
      {typeLabel(type)}
    </span>
  );
}

export function RegionBadge({ region }) {
  if (!region) return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>;
  const key = region.toUpperCase();
  const c = REGION_COLORS[key] || REGION_COLORS['OTHER'];
  // Short abbreviations stay uppercase (LI, NYC); everything else title-cases
  const label = key.length <= 3 ? key : typeLabel(region);
  return (
    <span style={{ fontSize: 12, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

export default function Facilities() {
  const { resolveMarketer } = useLookups();
  const storeFacilities = useCareStore((s) => s.facilities);
  const storeMF = useCareStore((s) => s.marketerFacilities);
  const storeRefs = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);

  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const facilities = useMemo(() => Object.values(storeFacilities), [storeFacilities]);

  const liaisons = useMemo(() => {
    const lmap = {};
    Object.values(storeMF).forEach((f) => {
      if (!f.facility_id) return;
      if (f.is_primary === true || f.is_primary === 'true' || !lmap[f.facility_id]) {
        lmap[f.facility_id] = f.marketer_id;
      }
    });
    return lmap;
  }, [storeMF]);

  const refCounts = useMemo(() => {
    const rmap = {};
    Object.values(storeRefs).forEach((r) => {
      const fid = r.facility_id;
      if (fid) rmap[fid] = (rmap[fid] || 0) + 1;
    });
    return rmap;
  }, [storeRefs]);

  const filtered = useMemo(() => {
    let list = facilities.filter((f) => {
      if (f.is_active === 'FALSE') return false;
      if (typeFilter   && (f.type   || '').toUpperCase() !== typeFilter.toUpperCase())   return false;
      if (regionFilter && (f.region || '').toUpperCase() !== regionFilter.toUpperCase()) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!(f.name || '').toLowerCase().includes(q) && !(f.region || '').toLowerCase().includes(q) && !(f.primary_contact_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      let va = (a[sortField] || '').toString().toLowerCase();
      let vb = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [facilities, search, typeFilter, regionFilter, sortField, sortDir]);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  function toggleSort(f) {
    if (sortField === f) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  }

  const colHdr = (label, field) => (
    <th onClick={field ? () => toggleSort(field) : undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default', userSelect: 'none' }}>
      {label} {field && sortField === field && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  );

  const storeNetFacs = useCareStore((s) => s.networkFacilities);
  const networkFacs = useMemo(() => Object.values(storeNetFacs || {}).sort((a, b) => (a.name || '').localeCompare(b.name || '')), [storeNetFacs]);
  const [netSearch, setNetSearch] = useState('');
  const filteredNet = useMemo(() => {
    if (!netSearch.trim()) return networkFacs;
    const q = netSearch.toLowerCase();
    return networkFacs.filter((f) => (f.name || '').toLowerCase().includes(q) || (f.region || '').toLowerCase().includes(q));
  }, [networkFacs, netSearch]);

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        {/* ── Network Facilities ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Network Facilities</h1>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filteredNet.length} ALF network facilities</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
              <input value={netSearch} onChange={(e) => setNetSearch(e.target.value)} placeholder="Search network…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
            </div>
          </div>
          <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
                  {['Facility', 'Region', 'Marketer'].map((h) => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredNet.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No network facilities found.</td></tr>
                ) : filteredNet.map((f) => {
                  const mktName = f.marketer_id ? resolveMarketer(f.marketer_id) : null;
                  return (
                    <tr key={f._id} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.025))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{f.name}</td>
                      <td style={{ padding: '11px 14px' }}><RegionBadge region={f.region} /></td>
                      <td style={{ padding: '11px 14px', fontSize: 12.5, color: mktName && mktName !== f.marketer_id ? hexToRgba(palette.backgroundDark.hex, 0.6) : hexToRgba(palette.backgroundDark.hex, 0.3), fontStyle: !mktName ? 'italic' : 'normal' }}>
                        {mktName && mktName !== f.marketer_id ? mktName : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── External Facilities ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>External Facilities</h2>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} of {facilities.length} facilities</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search facilities…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 8, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}>
              <option value="">All Types</option>
              {FACILITY_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 8, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}>
              <option value="">All Regions</option>
              {FACILITY_REGIONS.map((r) => <option key={r} value={r}>{r.length <= 3 ? r : typeLabel(r)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {colHdr('Facility', 'name')}
                {colHdr('Type', 'type')}
                {colHdr('Region', 'region')}
                {colHdr('Primary Contact', null)}
                {colHdr('Liaison', null)}
                {colHdr('Referrals', null)}
              </tr>
            </thead>
            <tbody>
              {!hydrated ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No facilities found.</td></tr>
              ) : filtered.map((fac) => (
                <FacilityRow
                  key={fac._id}
                  facility={fac}
                  liaison={liaisons[fac.id]}
                  refCount={refCounts[fac.id] || 0}
                  resolveMarketer={resolveMarketer}
                  onOpen={() => setSelected(fac)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FacilityDrawer facility={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function FacilityRow({ facility, liaison, refCount, resolveMarketer, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const liaisonName = liaison ? resolveMarketer(liaison) : null;

  return (
    <tr onDoubleClick={onOpen} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      title="Double-click to view details"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent', cursor: 'default', transition: 'background 0.1s', userSelect: 'none' }}>
      <td style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 2 }}>{facility.name}</p>
        {facility.address_city && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{facility.address_city}, {facility.address_state}</p>}
      </td>
      <td style={{ padding: '12px 14px' }}><TypeBadge type={facility.type} size="small" /></td>
      <td style={{ padding: '12px 14px' }}><RegionBadge region={facility.region} /></td>
      <td style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{facility.primary_contact_name || '—'}</p>
        {facility.primary_contact_phone && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{facility.primary_contact_phone}</p>}
      </td>
      <td style={{ padding: '12px 14px' }}>
        {liaisonName && liaisonName !== liaison ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: hexToRgba(palette.accentOrange.hex, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, color: palette.accentOrange.hex, flexShrink: 0 }}>
              {liaisonName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>{liaisonName}</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>
        )}
      </td>
      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: refCount > 0 ? 650 : 400, color: refCount > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3) }}>{refCount}</span>
      </td>
    </tr>
  );
}
