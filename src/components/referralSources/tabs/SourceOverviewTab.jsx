import palette, { hexToRgba } from '../../../utils/colors.js';

function InfoRow({ label, value, mono, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span style={{
        fontSize: mono ? 12 : 13,
        fontWeight: 550,
        color: accent || palette.backgroundDark.hex,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
        textAlign: 'right',
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{value || '—'}</span>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SourceOverviewTab({ source, marketer, stats }) {
  const isUnassigned = !source.marketer_id;
  const memberSince = source.created_at
    ? new Date(source.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div style={{ padding: '20px 22px' }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
        Identity
      </p>
      <InfoRow label="Person" value={source.name} />
      <InfoRow label="Category" value={source.type} />
      <InfoRow label="Company / Entity" value={source.source_entity} />
      <InfoRow label="Source ID" value={source.id} mono />

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '22px 0 10px' }}>
        Assignment
      </p>
      <InfoRow
        label="Assigned Marketer"
        value={isUnassigned ? 'Unassigned' : marketer ? `${marketer.first_name} ${marketer.last_name}` : source.marketer_id}
        accent={isUnassigned ? palette.accentOrange.hex : undefined}
      />
      {marketer?.email && <InfoRow label="Marketer Email" value={marketer.email} />}
      {marketer?.region && (
        <InfoRow
          label="Marketer Region"
          value={Array.isArray(marketer.region) ? marketer.region.join(', ') : marketer.region}
        />
      )}

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '22px 0 10px' }}>
        Activity
      </p>
      <InfoRow label="First Referral" value={fmtDate(stats.firstReferral)} />
      <InfoRow label="Last Referral" value={fmtDate(stats.lastReferral)} />
      {memberSince && <InfoRow label="In System Since" value={memberSince} />}

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '22px 0 10px' }}>
        At a Glance
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Tile label="Total Referrals" value={stats.total} color={palette.primaryMagenta.hex} />
        <Tile label="Still Active" value={stats.active} color={palette.accentBlue.hex} />
        <Tile label="Admissions" value={stats.admitted} color={palette.accentGreen.hex} sub={`${stats.convRate}% conv.`} />
        <Tile label="NTUC" value={stats.ntuc} color={hexToRgba(palette.backgroundDark.hex, 0.45)} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ padding: '13px 14px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: color || palette.backgroundDark.hex, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
