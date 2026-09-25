import palette, { hexToRgba } from '../../../utils/colors.js';
import { CLOSE_RATE_METHODOLOGY, COUNTS_NOTE, formatCloseRate } from '../../../utils/marketerPerformance.js';

function CountBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color }}>{value}</span>
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

  const barMax = Math.max(stats.received, stats.soc, stats.ntuc, stats.open, 1);

  return (
    <div style={{ padding: '20px 22px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        <KpiCard label="Close Rate" value={formatCloseRate(stats.closeRate)} sub="SOC ÷ (SOC + NTUC)" />
        <KpiCard label="SOC" value={stats.soc} sub="by SOC date" />
        <KpiCard label="NTUC" value={stats.ntuc} sub="by NTUC date" />
        <KpiCard label="Open Now" value={stats.open} sub="excluded from rate" />
      </div>

      <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.42), lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
        {CLOSE_RATE_METHODOLOGY}
      </p>
      <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.42), lineHeight: 1.5, marginBottom: 22, fontStyle: 'italic' }}>
        {COUNTS_NOTE}
      </p>

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 14 }}>Period Activity</p>
      <CountBar label="Referrals received (by referral date)" value={stats.received} max={barMax} color={palette.accentBlue.hex} />
      <CountBar label="SOC completed (by outcome date)" value={stats.soc} max={barMax} color={palette.accentGreen.hex} />
      <CountBar label="NTUC (by outcome date)" value={stats.ntuc} max={barMax} color={hexToRgba(palette.backgroundDark.hex, 0.35)} />
      <CountBar label="Open right now (all time)" value={stats.open} max={barMax} color={palette.primaryMagenta.hex} />

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
