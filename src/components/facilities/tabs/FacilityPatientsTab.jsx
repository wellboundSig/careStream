import { useState } from 'react';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FacilityPatientsTab({ referrals, loading }) {
  const { open: openPatient } = usePatientDrawer();
  const [filter, setFilter] = useState('all');

  const displayed = filter === 'active'
    ? referrals.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed')
    : filter === 'admitted'
    ? referrals.filter((r) => r.current_stage === 'SOC Completed')
    : referrals;

  if (loading) return <LoadingState message="Loading patients…" size="small" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 22px 10px', borderBottom: `1px solid var(--color-border)`, display: 'flex', gap: 6 }}>
        {[['all', `All (${referrals.length})`], ['active', 'Active'], ['admitted', 'Admitted']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: filter === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07), color: filter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6), transition: 'all 0.12s' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayed.length === 0 ? (
          <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>No referrals in this view.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {['Patient', 'Division', 'Stage', 'Referral Date'].map((h) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((ref) => (
                <tr key={ref._id}
                  onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                  style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</td>
                  <td style={{ padding: '9px 14px' }}><DivisionBadge division={ref.division} size="small" /></td>
                  <td style={{ padding: '9px 14px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{fmtDate(ref.referral_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
