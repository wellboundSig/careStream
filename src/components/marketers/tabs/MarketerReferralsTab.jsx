import { useState } from 'react';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const F2F_COLORS = {
  Green: palette.accentGreen.hex, Yellow: palette.highlightYellow.hex,
  Orange: palette.accentOrange.hex, Red: palette.primaryMagenta.hex,
  Expired: hexToRgba(palette.backgroundDark.hex, 0.3),
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MarketerReferralsTab({ referrals }) {
  const { open: openPatient } = usePatientDrawer();
  const [filter, setFilter] = useState('all');

  const displayed = filter === 'all' ? referrals
    : filter === 'active' ? referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed')
    : filter === 'admitted' ? referrals.filter((r) => r.current_stage === 'SOC Completed')
    : referrals.filter((r) => r.current_stage === 'NTUC');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 22px 10px', borderBottom: `1px solid var(--color-border)`, display: 'flex', gap: 6 }}>
        {[['all', 'All'], ['active', 'Active'], ['admitted', 'Admitted'], ['ntuc', 'NTUC']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: filter === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.06), color: filter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6), transition: 'all 0.12s' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayed.length === 0 ? (
          <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>No referrals in this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {['Patient', 'Division', 'Stage', 'F2F', 'Date'].map((h) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((ref) => {
                const f2fColor = F2F_COLORS[ref.f2f_urgency] || null;
                return (
                  <tr key={ref._id} onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>
                      {ref.patientName || ref.patient_id}
                    </td>
                    <td style={{ padding: '9px 14px' }}><DivisionBadge division={ref.division} size="small" /></td>
                    <td style={{ padding: '9px 14px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                    <td style={{ padding: '9px 14px' }}>
                      {f2fColor ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: f2fColor, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: f2fColor, display: 'inline-block' }} />{ref.f2f_urgency}</span>
                        : <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{fmtDate(ref.referral_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
