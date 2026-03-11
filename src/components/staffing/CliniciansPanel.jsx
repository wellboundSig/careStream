import { useState, useMemo } from 'react';
import { useEsperClinicians } from '../../hooks/useEsperClinicians.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const DISC_COLORS = {
  PT: palette.accentBlue.hex, OT: palette.accentGreen.hex, PTA: hexToRgba(palette.accentBlue.hex,0.7),
  OTA: hexToRgba(palette.accentGreen.hex,0.7), RN: palette.primaryMagenta.hex, LPN: hexToRgba(palette.primaryMagenta.hex,0.7),
  HHA: palette.accentOrange.hex, SLP: palette.highlightYellow.hex, ST: palette.highlightYellow.hex,
  ABA: '#9B59B6', NP: palette.primaryMagenta.hex, PA: hexToRgba(palette.primaryMagenta.hex,0.6),
};

function DiscPill({ disc }) {
  const c = DISC_COLORS[disc] || hexToRgba(palette.backgroundDark.hex, 0.45);
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: hexToRgba(c, 0.15), color: c }}>
      {disc || '?'}
    </span>
  );
}

export default function CliniciansPanel() {
  const { clinicians, loading, error } = useEsperClinicians();
  const [search, setSearch] = useState('');
  const [activeDisc, setActiveDisc] = useState('All');

  const disciplines = useMemo(() => {
    const d = new Set(clinicians.map((c) => c.discipline).filter(Boolean));
    return ['All', ...Array.from(d).sort()];
  }, [clinicians]);

  const filtered = useMemo(() => {
    let list = clinicians;
    if (activeDisc !== 'All') list = list.filter((c) => c.discipline === activeDisc);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.discipline || '').toLowerCase().includes(q) ||
        (c.zip || '').includes(q)
      );
    }
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clinicians, activeDisc, search]);

  if (loading) return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '8px 0' }}>Loading clinicians…</p>;
  if (error) return <p style={{ fontSize: 12, color: palette.primaryMagenta.hex }}>{error}</p>;

  return (
    <div>
      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, discipline, zip…"
        style={{ width: '100%', padding: '6px 9px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12, fontFamily: 'inherit', outline: 'none', marginBottom: 8, background: hexToRgba(palette.backgroundDark.hex, 0.03) }}
      />

      {/* Discipline tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {disciplines.map((d) => (
          <button key={d} onClick={() => setActiveDisc(d)}
            style={{ padding: '3px 9px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 650, cursor: 'pointer', transition: 'all 0.12s',
              background: activeDisc === d ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
              color: activeDisc === d ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {d}
          </button>
        ))}
      </div>

      {/* Clinician list */}
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 6 }}>
        {filtered.length} of {clinicians.length} clinicians
      </p>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.slice(0, 60).map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: hexToRgba(DISC_COLORS[c.discipline] || palette.accentBlue.hex, 0.14), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: DISC_COLORS[c.discipline] || palette.accentBlue.hex }}>
                {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</p>
                <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                  {c.workerId ? `#${c.workerId}` : ''}
                  {c.workerId && c.location ? ' · ' : ''}
                  {c.location ? `${c.location.lat.toFixed(4)}, ${c.location.lon.toFixed(4)}` : 'No GPS'}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <DiscPill disc={c.discipline} />
              <span title={c.online ? 'Online' : 'Offline'} style={{ width: 7, height: 7, borderRadius: '50%', background: c.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.25), display: 'inline-block' }} />
            </div>
          </div>
        ))}
        {filtered.length > 60 && (
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), textAlign: 'center', paddingTop: 4 }}>+{filtered.length - 60} more — refine search</p>
        )}
      </div>
    </div>
  );
}
