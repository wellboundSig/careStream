import palette, { hexToRgba } from '../../../utils/colors.js';

function FunnelBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color }}>{value} <span style={{ fontSize: 11, fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), textAlign: 'center' }}>
      <p style={{ fontSize: 30, fontWeight: 800, color: palette.primaryMagenta.hex, lineHeight: 1, marginBottom: 4 }}>{value}</p>
      <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{label}</p>
      {sub && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub}</p>}
    </div>
  );
}

export default function MarketerMetricsTab({ stats, ntucReasons, referrals }) {
  const stageBreakdown = referrals.reduce((acc, r) => {
    acc[r.current_stage] = (acc[r.current_stage] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: '20px 22px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiCard label="Conversion Rate" value={`${stats.convRate}%`} sub="leads → SOC" />
        <KpiCard label="Total Referrals" value={stats.total} sub="all time" />
        <KpiCard label="Admissions" value={stats.admitted} sub="SOC completed" />
      </div>

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 14 }}>Referral Funnel</p>
      <FunnelBar label="Total Referrals" value={stats.total} total={stats.total} color={palette.accentBlue.hex} />
      <FunnelBar label="Still Active" value={stats.active} total={stats.total} color={palette.primaryMagenta.hex} />
      <FunnelBar label="SOC Completed" value={stats.admitted} total={stats.total} color={palette.accentGreen.hex} />
      <FunnelBar label="NTUC" value={stats.ntuc} total={stats.total} color={hexToRgba(palette.backgroundDark.hex, 0.35)} />

      {Object.keys(ntucReasons).length > 0 && (
        <>
          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '24px 0 12px' }}>NTUC Reasons</p>
          {Object.entries(ntucReasons).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
            <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{reason}</span>
              <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.primaryMagenta.hex }}>{count}</span>
            </div>
          ))}
        </>
      )}

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '24px 0 12px' }}>Current Stage Breakdown</p>
      {Object.entries(stageBreakdown).sort(([, a], [, b]) => b - a).map(([stage, count]) => (
        <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
          <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{stage}</span>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{count}</span>
        </div>
      ))}
    </div>
  );
}
