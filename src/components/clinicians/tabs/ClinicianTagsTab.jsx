import { SectionTitle } from './InfoRow.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

export default function ClinicianTagsTab({ clinician }) {
  const tags = Array.isArray(clinician.tags) ? clinician.tags : [];

  return (
    <div style={{ padding: '20px 22px 28px' }}>
      <SectionTitle>Esper tags</SectionTitle>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 12, lineHeight: 1.5 }}>
        Raw tag list from Esper. CareStream parses these into discipline, worker ID, and ZIP. Anything additional shows up below for reference.
      </p>

      {tags.length === 0 ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
          No tags reported.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {tags.map((t) => (
            <span key={t} style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 14, background: hexToRgba(palette.backgroundDark.hex, 0.05), color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
              {t}
            </span>
          ))}
        </div>
      )}

      <SectionTitle>Parsed values</SectionTitle>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {[
          ['Discipline',  clinician.discipline],
          ['Worker ID',   clinician.workerId],
          ['ZIP',         clinician.zip],
          ['Display name', clinician.displayName || clinician.name],
        ].map(([k, v]) => (
          <li key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
            <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{k}</span>
            <span style={{ fontSize: 13, color: v ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.3), fontWeight: 550 }}>{v || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
