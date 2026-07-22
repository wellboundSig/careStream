import { useLookups } from '../../../hooks/useLookups.js';
import { isNetworkFacility } from '../../../hooks/useFacilityData.js';
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

export default function FacilityOverviewTab({ facility, cocNurses = [] }) {
  const { resolveEntity, resolveMarketer } = useLookups();
  if (!facility) return null;

  const network = isNetworkFacility(facility);
  const zip = facility.address_zip || facility.zipcode;
  const addr = network
    ? [facility.address_street, zip].filter(Boolean).join(', ')
    : [facility.address_street, facility.address_city, facility.address_state, zip].filter(Boolean).join(', ');

  const marketerName = facility.marketer_id
    ? resolveMarketer(facility.marketer_id)
    : null;
  const entityName = facility.entity_id
    ? resolveEntity(facility.entity_id)
    : null;

  return (
    <div style={{ padding: '20px 22px 40px', overflowY: 'auto', height: '100%' }}>
      <Section title="Location">
        <Row label="Address" value={addr || null} />
        <Row label="Region" value={facility.region} />
        {!network && <Row label="Phone" value={facility.phone} />}
        {!network && <Row label="Fax" value={facility.fax} />}
        {network && zip && <Row label="ZIP" value={zip} />}
      </Section>

      {network ? (
        <Section title="Network">
          <Row
            label="Marketer"
            value={marketerName && marketerName !== facility.marketer_id ? marketerName : null}
          />
          <Row label="Case Manager" value={facility.case_manager} />
          <Row
            label="Entity"
            value={entityName && entityName !== '—' ? entityName : facility.entity_id}
          />
          <Row label="Facility ID" value={facility.id} />
        </Section>
      ) : (
        <Section title="Primary Contact">
          <Row label="Name" value={facility.primary_contact_name} />
          <Row label="Phone" value={facility.primary_contact_phone} />
          <Row label="Email" value={facility.primary_contact_email} />
        </Section>
      )}

      {network && cocNurses.length > 0 && (
        <Section title="COC Nurses">
          {cocNurses.map((c) => (
            <Row key={c._id || c.id} label="Assigned" value={c.userName || c.user_id} />
          ))}
        </Section>
      )}

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
