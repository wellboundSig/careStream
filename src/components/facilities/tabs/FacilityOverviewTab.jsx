import palette, { hexToRgba } from '../../../utils/colors.js';

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.3), maxWidth: 260, textAlign: 'right', wordBreak: 'break-word' }}>
        {value || '—'}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

export default function FacilityOverviewTab({ facility }) {
  if (!facility) return null;
  const addr = [facility.address_street, facility.address_city, facility.address_state, facility.address_zip].filter(Boolean).join(', ');

  return (
    <div style={{ padding: '20px 22px 40px' }}>
      <Section title="Location">
        <Row label="Address" value={addr || null} />
        <Row label="Region" value={facility.region} />
        <Row label="Phone" value={facility.phone} />
        <Row label="Fax" value={facility.fax} />
      </Section>

      <Section title="Primary Contact">
        <Row label="Name" value={facility.primary_contact_name} />
        <Row label="Phone" value={facility.primary_contact_phone} />
        <Row label="Email" value={facility.primary_contact_email} />
      </Section>

      {facility.services_provided_internally && (
        <Section title="Services Provided Internally">
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.6 }}>{facility.services_provided_internally}</p>
        </Section>
      )}

      {facility.notes && (
        <Section title="Notes">
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{facility.notes}</p>
        </Section>
      )}
    </div>
  );
}
