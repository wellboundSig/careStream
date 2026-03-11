import { useMemo } from 'react';
import DivisionBadge from '../common/DivisionBadge.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// Stages that indicate "approaching staffing" but not yet there
const RADAR_STAGES = new Set([
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
]);

export default function RadarPanel({ allReferrals = [] }) {
  const radar = useMemo(() =>
    allReferrals
      .filter((r) => RADAR_STAGES.has(r.current_stage))
      .sort((a, b) => {
        // Sort by F2F urgency first (most urgent first), then by referral date
        const urgOrder = { Expired: 0, Red: 1, Orange: 2, Yellow: 3, Green: 4, '': 5 };
        const ua = urgOrder[a.f2f_urgency || ''] ?? 5;
        const ub = urgOrder[b.f2f_urgency || ''] ?? 5;
        if (ua !== ub) return ua - ub;
        return new Date(b.referral_date || 0) - new Date(a.referral_date || 0);
      }),
    [allReferrals]
  );

  if (radar.length === 0) {
    return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', padding: '8px 0' }}>No patients approaching staffing.</p>;
  }

  return (
    <div>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
        {radar.length} patient{radar.length !== 1 ? 's' : ''} approaching staffing
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
        {radar.map((r) => {
          const zip = r.patient?.address_zip;
          const services = Array.isArray(r.services_requested) ? r.services_requested : [];
          const f2fColor = { Expired: palette.primaryMagenta.hex, Red: palette.primaryMagenta.hex, Orange: palette.accentOrange.hex, Yellow: '#7A5F00' }[r.f2f_urgency] || null;
          return (
            <div key={r._id} style={{ padding: '8px 10px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.025), borderLeft: `3px solid ${f2fColor || hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                    {r.patientName || r.patient_id}
                  </p>
                  {zip && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>ZIP: {zip}</p>}
                </div>
                <DivisionBadge division={r.division} size="small" />
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 3 }}>
                {services.map((s) => (
                  <span key={s} style={{ fontSize: 10.5, fontWeight: 650, padding: '1px 6px', borderRadius: 4, background: hexToRgba(palette.accentGreen.hex, 0.12), color: palette.accentGreen.hex }}>{s}</span>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{r.current_stage}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
