import { useState, useEffect, useMemo } from 'react';
import { getPhysicians } from '../../api/physicians.js';
import airtable from '../../api/airtable.js';
import PhysicianDrawer from '../../components/physicians/PhysicianDrawer.jsx';
import LoadingState from '../../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

function StatusPill({ value, label }) {
  const ok = value === true || value === 'true';
  return (
    <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 7px', borderRadius: 10, background: ok ? hexToRgba(palette.accentGreen.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.07), color: ok ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>
      {label} {ok ? '✓' : '—'}
    </span>
  );
}

export default function Physicians() {
  const [physicians, setPhysicians] = useState([]);
  const [refCounts, setRefCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getPhysicians(),
      airtable.fetchAll('Referrals', { fields: ['physician_id'] }),
    ]).then(([phys, refs]) => {
      setPhysicians(phys.map((r) => ({ _id: r.id, ...r.fields })));
      const map = {};
      refs.forEach((r) => { const pid = r.fields.physician_id; if (pid) map[pid] = (map[pid] || 0) + 1; });
      setRefCounts(map);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = physicians.filter((p) => {
      if (p.is_active === 'FALSE' || p.is_active === false) return false;
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

  function toggleSort(f) {
    if (sortField === f) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  }

  const colHdr = (label, field) => (
    <th onClick={field ? () => toggleSort(field) : undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default' }}>
      {label} {field && sortField === field && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  );

  if (loading) return <LoadingState message="Loading physicians…" />;

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Physicians</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} physicians</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, NPI…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
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
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No physicians found.</td></tr>
            ) : filtered.map((phy) => (
              <PhysicianRow key={phy._id} physician={phy} refCount={refCounts[phy.id] || 0} onOpen={() => setSelected(phy)} />
            ))}
          </tbody>
          </table>
        </div>
      </div>
      <PhysicianDrawer physician={selected} onClose={() => setSelected(null)} />
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
