import { useState, useEffect } from 'react';
import { getChecksByPatient } from '../../../api/insuranceChecks.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const FLAG_LABELS = {
  medicare_part_a: 'Medicare Part A',
  medicare_part_b: 'Medicare Part B',
  medicaid_active: 'Medicaid Active',
  has_open_hh_episode: 'Open HH Episode',
  hospice_overlap: 'Hospice Overlap',
  snf_present: 'SNF Present',
  hospital_present: 'Hospital Present',
  qmb_status: 'QMB Status',
  cdpap_active: 'CDPAP Active',
  auth_required: 'Auth Required',
  disenrollment_needed: 'Disenrollment Needed',
};

const FLAG_TYPES = {
  medicare_part_a: 'positive',
  medicare_part_b: 'positive',
  medicaid_active: 'positive',
  has_open_hh_episode: 'warning',
  hospice_overlap: 'warning',
  snf_present: 'warning',
  hospital_present: 'warning',
  qmb_status: 'neutral',
  cdpap_active: 'warning',
  auth_required: 'info',
  disenrollment_needed: 'warning',
};

const FLAG_COLORS = {
  positive: { bg: hexToRgba(palette.accentGreen.hex, 0.14),  text: palette.accentGreen.hex },
  warning:  { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), text: palette.primaryMagenta.hex },
  info:     { bg: hexToRgba(palette.accentBlue.hex, 0.14),    text: palette.accentBlue.hex },
  neutral:  { bg: hexToRgba(palette.backgroundDark.hex, 0.08), text: hexToRgba(palette.backgroundDark.hex, 0.55) },
};

export default function EligibilityTab({ patient }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    getChecksByPatient(patient.id)
      .then((records) => setChecks(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patient?.id]);

  if (loading) return <LoadingState message="Loading eligibility..." size="small" />;

  const latest = checks[0] || null;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
          Current Eligibility Status
        </h3>
        <button
          style={{
            padding: '6px 14px', borderRadius: 7,
            background: palette.primaryMagenta.hex,
            border: 'none', fontSize: 12, fontWeight: 600,
            color: palette.backgroundLight.hex, cursor: 'pointer',
          }}
        >
          Recheck
        </button>
      </div>

      {!latest ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: hexToRgba(palette.backgroundDark.hex, 0.35), fontSize: 13, fontStyle: 'italic' }}>
          No eligibility checks on record. Click Recheck to initiate.
        </div>
      ) : (
        <>
          <div style={{ padding: '14px 16px', background: hexToRgba(palette.backgroundDark.hex, 0.03), borderRadius: 10, border: `1px solid var(--color-border)`, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 2 }}>Source</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{latest.check_source || 'Unknown'}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 2 }}>Checked</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>
                  {latest.check_date ? new Date(latest.check_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </p>
              </div>
            </div>

            {latest.managed_care_plan && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 2 }}>Managed Care Plan</p>
                <p style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{latest.managed_care_plan}</p>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {Object.entries(FLAG_LABELS).map(([key, label]) => {
                const val = latest[key];
                if (val === null || val === undefined) return null;
                const isTrue = val === true || val === 'true' || val === 'TRUE';
                if (!isTrue) return null;
                const type = FLAG_TYPES[key];
                const colors = FLAG_COLORS[type];
                return (
                  <span
                    key={key}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                      background: colors.bg, color: colors.text,
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            {latest.result_summary && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: hexToRgba(palette.backgroundDark.hex, 0.03), borderRadius: 8, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.6 }}>
                {latest.result_summary}
              </div>
            )}
          </div>

          {checks.length > 1 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Check History ({checks.length - 1} previous)
              </p>
              {checks.slice(1).map((check, i) => (
                <div
                  key={check._id}
                  onClick={() => setExpanded(expanded === check._id ? null : check._id)}
                  style={{
                    padding: '10px 14px', borderRadius: 8, border: `1px solid var(--color-border)`,
                    marginBottom: 6, cursor: 'pointer',
                    background: expanded === check._id ? hexToRgba(palette.backgroundDark.hex, 0.03) : palette.backgroundLight.hex,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex }}>
                      {check.check_source || 'Unknown'} — {check.check_date ? new Date(check.check_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </p>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: expanded === check._id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                      <path d="M2 4l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.4)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {expanded === check._id && check.result_summary && (
                    <p style={{ marginTop: 8, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.6 }}>
                      {check.result_summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
