import { useState, useMemo } from 'react';
import { useCareStore } from '../../store/careStore.js';
import MarketerDrawer from '../../components/marketers/MarketerDrawer.jsx';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const REGION_COLORS = {
  LI:          hexToRgba(palette.accentBlue.hex, 0.18),
  Bronx:       hexToRgba(palette.primaryMagenta.hex, 0.15),
  Westchester: hexToRgba(palette.accentGreen.hex, 0.15),
  NYC:         hexToRgba(palette.accentOrange.hex, 0.15),
};

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

export default function Marketers() {
  const storeMarketers = useCareStore((s) => s.marketers);
  const storeReferrals = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);

  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');

  const marketers = useMemo(() => Object.values(storeMarketers), [storeMarketers]);
  const allReferrals = useMemo(() => Object.values(storeReferrals), [storeReferrals]);

  const statsByMarketer = useMemo(() => {
    const map = {};
    allReferrals.forEach((ref) => {
      const mid = ref.marketer_id;
      if (!mid) return;
      if (!map[mid]) map[mid] = { total: 0, admitted: 0, ntuc: 0, lastDate: null };
      map[mid].total++;
      if (ref.current_stage === 'SOC Completed') map[mid].admitted++;
      if (ref.current_stage === 'NTUC') map[mid].ntuc++;
      if (!map[mid].lastDate || new Date(ref.referral_date) > new Date(map[mid].lastDate)) {
        map[mid].lastDate = ref.referral_date;
      }
    });
    Object.values(map).forEach((s) => {
      s.convRate = s.total ? Math.round((s.admitted / s.total) * 100) : 0;
    });
    return map;
  }, [allReferrals]);

  const filtered = useMemo(() => {
    let list = marketers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) || (m.region || '').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const va = (a[sortField] || '').toString().toLowerCase();
      const vb = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [marketers, search, sortField, sortDir]);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  function toggleSort(field) {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  const active = marketers.filter((m) => m.status === 'Active').length;

  const COLS = [
    { label: 'Marketer', field: 'last_name' },
    { label: 'Region', field: 'region' },
    { label: 'Division', field: 'division' },
    { label: 'Status', field: 'status' },
    { label: 'Referrals', field: null },
    { label: 'Admitted', field: null },
    { label: 'Conv.', field: null },
    { label: 'Last Referral', field: null },
  ];

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Marketers</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{active} active · {marketers.length} total</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 36, width: 240 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, region…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {COLS.map(({ label, field }) => (
                  <th key={label} onClick={field ? () => toggleSort(field) : undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default', userSelect: 'none' }}>
                    {label} {field && sortField === field && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!hydrated ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={8} />)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No marketers found.</td></tr>
              ) : filtered.map((marketer) => {
                const s = statsByMarketer[marketer.id] || { total: 0, admitted: 0, ntuc: 0, convRate: 0, lastDate: null };
                return <MarketerRow key={marketer._id} marketer={marketer} stats={s} onOpen={() => setSelected(marketer)} />;
              })}
            </tbody>
          </table>
        </div>
      </div>

      <MarketerDrawer marketer={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function MarketerRow({ marketer, stats, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const regionBg = REGION_COLORS[marketer.region] || hexToRgba(palette.backgroundDark.hex, 0.07);
  const lastDate = stats.lastDate ? new Date(stats.lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  return (
    <tr onDoubleClick={onOpen} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      title="Double-click to view profile"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent', cursor: 'default', transition: 'background 0.1s' }}>
      <td style={{ padding: '11px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.14), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: palette.primaryMagenta.hex }}>
            {initials(marketer.first_name, marketer.last_name)}
          </div>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{marketer.first_name} {marketer.last_name}</p>
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{marketer.email}</p>
          </div>
        </div>
      </td>
      <td style={{ padding: '11px 14px' }}>
        {(() => {
          if (!marketer.region) return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>;
          const regions = Array.isArray(marketer.region) ? marketer.region : String(marketer.region).split(',').map((r) => r.trim()).filter(Boolean);
          if (!regions.length) return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>;
          const first = regions[0];
          const firstBg = REGION_COLORS[first] || hexToRgba(palette.backgroundDark.hex, 0.07);
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: firstBg, color: palette.backgroundDark.hex }}>{first}</span>
              {regions.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>+{regions.length - 1}</span>}
            </span>
          );
        })()}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{marketer.division || '—'}</td>
      <td style={{ padding: '11px 14px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: marketer.status === 'Active' ? hexToRgba(palette.accentGreen.hex, 0.16) : hexToRgba(palette.backgroundDark.hex, 0.08), color: marketer.status === 'Active' ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}>{marketer.status || '—'}</span>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, textAlign: 'center' }}>{stats.total}</td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: palette.accentGreen.hex, textAlign: 'center' }}>{stats.admitted}</td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 650, color: stats.convRate >= 50 ? palette.accentGreen.hex : stats.convRate >= 25 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.5), textAlign: 'center' }}>
        {stats.total > 0 ? `${stats.convRate}%` : '—'}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{lastDate}</td>
    </tr>
  );
}
