import InfoRow, { SectionTitle } from './InfoRow.jsx';
import { timeAgo, fmtDateTime, fmtCoords, googleMapsUrl } from '../../../utils/clinicianInfo.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

// Anonymous OSM tile preview. No API key required; centered on the last
// reported location. We layer a marker on top via a CSS overlay because
// raw tile servers don't accept ad-hoc markers.
function OsmMapPreview({ lat, lon }) {
  // bbox roughly 0.01° in each direction (~1km square at mid latitudes)
  const d = 0.01;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: 10, overflow: 'hidden', border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`, background: hexToRgba(palette.backgroundDark.hex, 0.04) }}>
      <iframe
        title="Device last position"
        src={src}
        style={{ width: '100%', height: 220, border: 'none', display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

export default function ClinicianLocationTab({ clinician }) {
  const loc = clinician.location;
  const lat = loc?.lat;
  const lon = loc?.lon;
  const hasGPS = typeof lat === 'number' && typeof lon === 'number';
  const reportedAt = loc?.lastSeen || clinician.device?.lastSeen;

  return (
    <div style={{ padding: '20px 22px 32px' }}>
      {!hasGPS ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', background: hexToRgba(palette.backgroundDark.hex, 0.03), borderRadius: 12, border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.1)}` }}>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
            No GPS data reported.
          </p>
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), lineHeight: 1.5 }}>
            The device hasn&rsquo;t shared a location with Esper yet. Make sure location reporting is enabled in the Esper policy for this device.
          </p>
        </div>
      ) : (
        <>
          <SectionTitle>Last known position</SectionTitle>
          <OsmMapPreview lat={lat} lon={lon} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '10px 12px', borderRadius: 9, background: hexToRgba(palette.accentBlue.hex, 0.05), border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.18)}` }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: palette.backgroundDark.hex, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {fmtCoords({ lat, lon })}
              </p>
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 2 }}>
                {reportedAt ? `Reported ${timeAgo(reportedAt)}` : 'Reported time unknown'}
              </p>
            </div>
            <a
              href={googleMapsUrl({ lat, lon })}
              target="_blank"
              rel="noreferrer noopener"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 650, padding: '6px 11px', borderRadius: 7, background: palette.accentBlue.hex, color: '#fff', textDecoration: 'none' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Open in Maps
            </a>
          </div>

          <SectionTitle>Details</SectionTitle>
          <InfoRow label="Latitude"  value={lat?.toFixed(6)} mono copyable />
          <InfoRow label="Longitude" value={lon?.toFixed(6)} mono copyable />
          <InfoRow label="Reported at" value={fmtDateTime(reportedAt)} />
          <InfoRow label="Time since" value={timeAgo(reportedAt)} />
          <InfoRow label="Assigned ZIP" value={clinician.zip} />
        </>
      )}
    </div>
  );
}
