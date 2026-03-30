import palette, { hexToRgba } from '../../../utils/colors.js';

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), flex: 1 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color: color || palette.backgroundDark.hex, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{value || '—'}</span>
    </div>
  );
}

export default function MarketerOverviewTab({ marketer, stats }) {
  const lastRef = stats.lastReferral
    ? new Date(stats.lastReferral).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <StatCard label="Total Referrals" value={stats.total} color={palette.primaryMagenta.hex} />
        <StatCard label="Active" value={stats.active} color={palette.accentBlue.hex} />
        <StatCard label="Admissions" value={stats.admitted} sub={`${stats.convRate}% conv.`} color={palette.accentGreen.hex} />
        <StatCard label="NTUC" value={stats.ntuc} color={hexToRgba(palette.backgroundDark.hex, 0.45)} />
      </div>

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>Contact Info</p>
      <InfoRow label="Email" value={marketer.email} />
      <InfoRow label="Phone" value={marketer.phone} />
      <InfoRow label="Region" value={(() => {
        if (!marketer.region) return '—';
        const regions = Array.isArray(marketer.region) ? marketer.region : String(marketer.region).split(',').map((r) => r.trim()).filter(Boolean);
        return regions.join(', ');
      })()} />
      <InfoRow label="Division" value={marketer.division} />
      <InfoRow label="Status" value={marketer.status} />
      <InfoRow label="Last Referral" value={lastRef} />
      <InfoRow label="Member Since" value={marketer.created_at ? new Date(marketer.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'} />
    </div>
  );
}
