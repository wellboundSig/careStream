import { useState, useEffect, useMemo } from 'react';
import { getReferralSources } from '../../api/referralSources.js';
import { getReferrals } from '../../api/referrals.js';
import LoadingState from '../../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TYPE_COLORS = {
  Hospital:     hexToRgba(palette.primaryMagenta.hex, 0.15),
  SNF:          hexToRgba(palette.accentOrange.hex, 0.15),
  'MD/PCP':     hexToRgba(palette.accentGreen.hex, 0.15),
  ALF:          hexToRgba(palette.highlightYellow.hex, 0.2),
  Web:          hexToRgba(palette.accentBlue.hex, 0.14),
  Fax:          hexToRgba(palette.backgroundDark.hex, 0.08),
  Allscripts:   hexToRgba(palette.accentBlue.hex, 0.12),
  Campaign:     hexToRgba(palette.primaryMagenta.hex, 0.1),
  'Self-Referral': hexToRgba(palette.accentGreen.hex, 0.12),
  Other:        hexToRgba(palette.backgroundDark.hex, 0.07),
};

export default function ReferralSources() {
  const [sources, setSources] = useState([]);
  const [refData, setRefData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReferralSources(),
      getReferrals({ fields: ['referral_source_id', 'current_stage'] }),
    ]).then(([srcs, refs]) => {
      setSources(srcs.map((r) => ({ _id: r.id, ...r.fields })));
      setRefData(refs.map((r) => r.fields));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const enriched = useMemo(() => {
    const list = search.trim()
      ? sources.filter((s) => (s.name || '').toLowerCase().includes(search.toLowerCase()) || (s.type || '').toLowerCase().includes(search.toLowerCase()))
      : sources;

    return list.map((src) => {
      const refs = refData.filter((r) => r.referral_source_id === src.id);
      const admitted = refs.filter((r) => r.current_stage === 'SOC Completed').length;
      const convRate = refs.length ? Math.round((admitted / refs.length) * 100) : 0;
      return { ...src, refCount: refs.length, admitted, convRate };
    }).sort((a, b) => b.refCount - a.refCount);
  }, [sources, refData, search]);

  if (loading) return <LoadingState message="Loading referral sources…" />;

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Referral Sources</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{enriched.length} sources</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sources…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
        </div>
      </div>

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
              {['Source', 'Type', 'Referrals', 'Admissions', 'Conversion'].map((h) => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enriched.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No sources found.</td></tr>
            ) : enriched.map((src) => (
              <SourceRow key={src._id} source={src} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceRow({ source: src }) {
  const [hov, setHov] = useState(false);
  const typeBg = TYPE_COLORS[src.type] || TYPE_COLORS.Other;
  return (
    <tr onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.025) : 'transparent', transition: 'background 0.1s' }}>
      <td style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{src.name}</td>
      <td style={{ padding: '11px 14px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: typeBg, color: palette.backgroundDark.hex }}>{src.type || '—'}</span>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.refCount > 0 ? 650 : 400, color: src.refCount > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>{src.refCount}</td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.admitted > 0 ? 650 : 400, color: src.admitted > 0 ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>{src.admitted}</td>
      <td style={{ padding: '11px 14px', textAlign: 'center' }}>
        {src.refCount > 0 ? (
          <span style={{ fontSize: 13, fontWeight: 650, color: src.convRate >= 50 ? palette.accentGreen.hex : src.convRate >= 25 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {src.convRate}%
          </span>
        ) : <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>}
      </td>
    </tr>
  );
}
