import { useEffect } from 'react';
import { useFlipWindow } from '../../hooks/useFlipWindow.js';
import FlipTableShell from '../common/FlipTableShell.jsx';
import { useNavigate } from 'react-router-dom';
import StageBadge from '../common/StageBadge.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { formatDaysInStage, overdueDaysInStage } from '../../utils/dashboardOverdue.js';
import { useLockedTableGrid } from '../../hooks/useLockedTableGrid.js';
import { lockedGridClass, lockColClass } from '../../utils/tableScrollMode.js';

const STAGE_ROUTE = {
  'Clinical Lead Pre-Check': '/modules/clinical-rn',
  'Lead Entry': '/modules/lead-entry',
  'Intake': '/modules/intake',
  'Eligibility Verification': '/modules/eligibility',
  'Disenrollment Required': '/modules/disenrollment',
  'F2F/MD Orders Pending': '/modules/f2f',
  'Clinical Intake RN Review': '/modules/clinical-rn',
  'Authorization Pending': '/modules/authorization',
  'Conflict': '/modules/conflict',
  'EMR Onboarding': '/modules/emr-onboarding',
  'Staffing Feasibility': '/modules/staffing',
  'Admin Confirmation': '/modules/admin-confirmation',
  'Pre-SOC': '/modules/pre-soc',
  'SOC Scheduled': '/modules/soc-scheduled',
  'SOC Completed': '/modules/completed',
  'Post Visit Intake': '/modules/intake',
  'Post Visit Clinical Review': '/modules/clinical-rn',
  'Completed': '/modules/completed',
  'Hold': '/modules/hold',
  'NTUC': '/modules/ntuc',
};

export default function OverduePatientsModal({ referrals, onClose, onOpenPatient }) {
  const navigate = useNavigate();
  const lockedGrid = useLockedTableGrid();
  const flip = useFlipWindow(referrals, lockedGrid, { rowHeight: 56, headerHeight: 36 });

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function openInModule(e, ref) {
    e.stopPropagation();
    const path = STAGE_ROUTE[ref.current_stage] || '/pipeline';
    navigate(path, { state: { selectReferralId: ref._id } });
    onClose();
  }

  function openPatient(ref) {
    onOpenPatient(ref);
    onClose();
  }

  return (
    <div
      data-testid="overdue-patients-modal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 720,
        maxHeight: 'min(80vh, 720px)', display: 'flex', flexDirection: 'column',
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Overdue patients</p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 0' }}>
              {referrals.length} in stage more than 14 days
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 7, border: '1px solid var(--color-border)',
              background: 'none', cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5),
              fontSize: 16, fontWeight: 700, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <FlipTableShell flip={flip} headerHeight={36} className={lockedGridClass(lockedGrid)} style={{ flex: 1, minHeight: 0 }}>
          {referrals.length === 0 ? (
            <p style={{ padding: '36px 20px', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
              No overdue patients right now.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
                  {['Patient', 'Stage', 'In stage', ''].map((h) => (
                    <th key={h} className={h === 'Patient' ? lockColClass(lockedGrid) : undefined} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flip.windowItems.map((ref) => {
                  const days = overdueDaysInStage(ref);
                  return (
                    <tr
                      key={ref._id}
                      onClick={() => openPatient(ref)}
                      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.04))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className={lockColClass(lockedGrid)} style={{ padding: '11px 16px' }}>
                        <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
                          {ref.patientName || ref.patient_id}
                        </p>
                        {ref.division && (
                          <div style={{ marginTop: 4 }}>
                            <DivisionBadge division={ref.division} size="small" />
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '11px 16px' }}>
                        <StageBadge stage={ref.current_stage} referral={ref} size="small" />
                      </td>
                      <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontSize: 13, fontWeight: days > 21 ? 700 : 600,
                          color: days > 21 ? palette.primaryMagenta.hex : palette.accentOrange.hex,
                        }}>
                          {formatDaysInStage(days)}
                        </span>
                      </td>
                      <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => openInModule(e, ref)}
                          title="Open this patient in their module queue"
                          style={{
                            padding: '5px 9px', borderRadius: 6,
                            border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
                            background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55),
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Open in module
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </FlipTableShell>
      </div>
    </div>
  );
}
