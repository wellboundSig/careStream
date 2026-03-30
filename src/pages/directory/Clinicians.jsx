import { useState, useMemo } from 'react';
import { useEsperClinicians } from '../../hooks/useEsperClinicians.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import LoadingState from '../../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const DISC_COLORS = {
  RN: palette.primaryMagenta.hex, LPN: palette.primaryMagenta.hex,
  PT: palette.accentBlue.hex, OT: palette.accentOrange.hex,
  SLP: palette.accentGreen.hex, ST: palette.accentGreen.hex,
  HHA: palette.highlightYellow.hex, ABA: palette.primaryDeepPlum.hex,
  PTA: hexToRgba(palette.accentBlue.hex, 0.7), OTA: hexToRgba(palette.accentOrange.hex, 0.7),
};

function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function Clinicians() {
  const { clinicians: rawClinicians, loading, error, refresh } = useEsperClinicians();
  const [search, setSearch] = useState('');
  const [discFilter, setDiscFilter] = useState('');
  const { can } = usePermissions();

  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  // Filter: only show clinicians with all 3 tags (name + workerId + discipline)
  // Normalize: title-case names
  // Deduplicate: by name — keep the one that's online, or first encountered
  const clinicians = useMemo(() => {
    const complete = rawClinicians.filter((c) => c.name && c.workerId && c.discipline);

    const byName = {};
    complete.forEach((c) => {
      const key = c.name.toLowerCase().trim();
      if (!byName[key]) {
        byName[key] = c;
      } else {
        const existing = byName[key];
        if (c.online && !existing.online) byName[key] = c;
      }
    });

    return Object.values(byName).map((c) => ({
      ...c,
      displayName: titleCase(c.name),
      discipline: c.discipline.toUpperCase(),
    })).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [rawClinicians]);

  const disciplines = useMemo(() => {
    const set = new Set();
    clinicians.forEach((c) => { if (c.discipline) set.add(c.discipline); });
    return [...set].sort();
  }, [clinicians]);

  const filtered = useMemo(() => {
    let list = clinicians;
    if (discFilter) list = list.filter((c) => c.discipline === discFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.displayName.toLowerCase().includes(q) || (c.workerId || '').includes(q) || c.discipline.toLowerCase().includes(q) || (c.zip || '').includes(q));
    }
    return list;
  }, [clinicians, search, discFilter]);

  if (loading && !rawClinicians.length) return <LoadingState message="Loading clinicians from Esper..." />;

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Clinicians</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} of {clinicians.length} clinicians</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
          <select value={discFilter} onChange={(e) => setDiscFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: discFilter ? hexToRgba(palette.accentBlue.hex, 0.07) : palette.backgroundLight.hex, fontSize: 12.5, color: discFilter ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', fontFamily: 'inherit', fontWeight: discFilter ? 600 : 400 }}>
            <option value="">All disciplines</option>
            {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={refresh} style={{ height: 34, padding: '0 14px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Refresh</button>
        </div>
      </div>

      {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 12 }}>Esper error: {error}</p>}

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
              {['Name', 'Worker ID', 'Discipline', 'Zip', 'Status'].map((h) => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No clinicians found.</td></tr>
            ) : filtered.map((c) => {
              const dc = DISC_COLORS[c.discipline] || hexToRgba(palette.backgroundDark.hex, 0.5);
              return (
                <tr key={c.id} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.025))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{c.displayName}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{c.workerId}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ fontSize: 12, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: hexToRgba(dc, 0.14), color: dc }}>{c.discipline}</span>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: c.zip ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.25) }}>
                    {c.zip || '—'}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: c.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.2) }} />
                      {c.online ? 'Online' : 'Offline'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
