import palette, { hexToRgba } from '../../../utils/colors.js';

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: color || (value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.3)) }}>{value || '—'}</span>
    </div>
  );
}

function StatusPill({ enrolled, label }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: enrolled ? hexToRgba(palette.accentGreen.hex, 0.15) : hexToRgba(palette.primaryMagenta.hex, 0.1), color: enrolled ? palette.accentGreen.hex : palette.primaryMagenta.hex }}>
      {label}: {enrolled ? 'Enrolled' : 'Not Enrolled'}
    </span>
  );
}

export default function PhysicianOverviewTab({ physician }) {
  if (!physician) return null;
  const addr = [physician.address_street, physician.address_city, physician.address_state, physician.address_zip].filter(Boolean).join(', ');
  const pecosChecked = physician.pecos_last_checked
    ? new Date(physician.pecos_last_checked).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div style={{ padding: '20px 22px 40px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatusPill enrolled={physician.is_pecos_enrolled === true || physician.is_pecos_enrolled === 'true'} label="PECOS" />
        <StatusPill enrolled={physician.is_opra_enrolled === true || physician.is_opra_enrolled === 'true'} label="OPRA" />
      </div>

      <Row label="NPI" value={physician.npi?.toString()} />
      <Row label="Phone" value={physician.phone} />
      <Row label="Fax" value={physician.fax} />
      <Row label="Address" value={addr || null} />
      {physician.facility_id && <Row label="Affiliated Facility" value={physician.facility_id} />}
      {pecosChecked && <Row label="PECOS Last Checked" value={pecosChecked} color={hexToRgba(palette.backgroundDark.hex, 0.55)} />}
    </div>
  );
}
