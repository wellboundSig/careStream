import InfoRow, { SectionTitle } from './InfoRow.jsx';
import { fmtDateTime, timeAgo } from '../../../utils/clinicianInfo.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

export default function ClinicianProfileTab({ clinician }) {
  const d = clinician.device || {};
  const lastSeenIso = d.lastSeen || clinician.location?.lastSeen;

  return (
    <div style={{ padding: '20px 22px' }}>
      <SectionTitle>Identity</SectionTitle>
      <InfoRow label="Display name" value={clinician.displayName || clinician.name} />
      <InfoRow label="Worker ID" value={clinician.workerId} mono copyable />
      <InfoRow label="Discipline" value={clinician.discipline} />
      <InfoRow label="ZIP (assigned)" value={clinician.zip} />

      <SectionTitle>Enrollment</SectionTitle>
      <InfoRow label="Device alias" value={d.aliasName || d.deviceName} />
      <InfoRow label="Esper device ID" value={clinician.id} mono copyable />
      {d.suid && <InfoRow label="SUID" value={d.suid} mono copyable />}
      <InfoRow label="Active in Esper" value={d.isActive === null || d.isActive === undefined ? null : d.isActive ? 'Yes' : 'No'} accent={d.isActive ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4)} />
      <InfoRow label="Enrolled" value={fmtDateTime(d.enrollmentTime)} />

      <SectionTitle>Activity</SectionTitle>
      <InfoRow
        label="Online status"
        value={clinician.online ? 'Online' : 'Offline'}
        accent={clinician.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45)}
      />
      <InfoRow label="Device state" value={d.state} />
      <InfoRow
        label="Last seen"
        value={lastSeenIso ? `${timeAgo(lastSeenIso)} · ${fmtDateTime(lastSeenIso)}` : null}
      />

      {clinician.tags?.length > 0 && (
        <>
          <SectionTitle>Esper tags</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {clinician.tags.map((t) => (
              <span key={t} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 12, background: hexToRgba(palette.backgroundDark.hex, 0.05), color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
