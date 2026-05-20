import palette, { hexToRgba } from '../../../utils/colors.js';

function FunnelBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color }}>
          {value}{' '}
          <span style={{ fontSize: 11, fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), textAlign: 'center' }}>
      <p style={{ fontSize: 30, fontWeight: 800, color: color || palette.primaryMagenta.hex, lineHeight: 1, marginBottom: 4 }}>{value}</p>
      <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{label}</p>
      {sub && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '24px 0 12px' }}>
      {children}
    </p>
  );
}

function BreakdownRow({ label, count, total, color }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: color || palette.backgroundDark.hex }}>
          {count}
          <span style={{ fontSize: 11, fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginLeft: 6 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.06), overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color || hexToRgba(palette.backgroundDark.hex, 0.35), borderRadius: 2 }} />
      </div>
    </div>
  );
}

export default function SourceMetricsTab({ stats, stageBreakdown, divisionBreakdown, ntucReasons }) {
  const stageEntries  = Object.entries(stageBreakdown).sort(([, a], [, b]) => b - a);
  const divEntries    = Object.entries(divisionBreakdown).sort(([, a], [, b]) => b - a);
  const ntucEntries   = Object.entries(ntucReasons).sort(([, a], [, b]) => b - a);

  return (
    <div style={{ padding: '20px 22px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <KpiCard label="Conversion Rate" value={`${stats.convRate}%`} sub="leads → SOC" color={palette.accentGreen.hex} />
        <KpiCard label="Total Referrals" value={stats.total} sub="all time" color={palette.primaryMagenta.hex} />
        <KpiCard label="Admissions" value={stats.admitted} sub="SOC completed" color={palette.accentBlue.hex} />
      </div>

      <SectionTitle>Pipeline Funnel</SectionTitle>
      <FunnelBar label="Total Referrals" value={stats.total} total={stats.total} color={palette.accentBlue.hex} />
      <FunnelBar label="Still Active"   value={stats.active}  total={stats.total} color={palette.primaryMagenta.hex} />
      <FunnelBar label="SOC Completed"  value={stats.admitted} total={stats.total} color={palette.accentGreen.hex} />
      <FunnelBar label="NTUC"           value={stats.ntuc}    total={stats.total} color={hexToRgba(palette.backgroundDark.hex, 0.35)} />

      {divEntries.length > 0 && (
        <>
          <SectionTitle>Division Mix</SectionTitle>
          {divEntries.map(([div, count]) => (
            <BreakdownRow
              key={div}
              label={div}
              count={count}
              total={stats.total}
              color={div === 'ALF' ? palette.highlightYellow.hex : palette.primaryMagenta.hex}
            />
          ))}
        </>
      )}

      {stageEntries.length > 0 && (
        <>
          <SectionTitle>Current Stage Distribution</SectionTitle>
          {stageEntries.map(([stage, count]) => (
            <BreakdownRow
              key={stage}
              label={stage}
              count={count}
              total={stats.total}
              color={stage === 'SOC Completed' ? palette.accentGreen.hex : stage === 'NTUC' ? hexToRgba(palette.backgroundDark.hex, 0.35) : palette.accentBlue.hex}
            />
          ))}
        </>
      )}

      {ntucEntries.length > 0 && (
        <>
          <SectionTitle>NTUC Reasons</SectionTitle>
          {ntucEntries.map(([reason, count]) => (
            <BreakdownRow key={reason} label={reason} count={count} total={stats.ntuc} color={hexToRgba(palette.backgroundDark.hex, 0.45)} />
          ))}
        </>
      )}
    </div>
  );
}
