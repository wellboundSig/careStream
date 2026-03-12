import { useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const PIPELINE_STAGES = [
  'Lead Entry','Intake','Eligibility Verification','Disenrollment Required',
  'F2F/MD Orders Pending','Clinical Intake RN Review','Authorization Pending',
  'Conflict','Staffing Feasibility','Admin Confirmation',
  'Pre-SOC','SOC Scheduled','SOC Completed','Hold','NTUC',
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(d) {
  if (!d) return null;
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${diff}d ago`;
}

export default function Dashboard() {
  const { division } = useOutletContext();
  const { data: referrals, loading } = usePipelineData();
  const { open: openPatient } = usePatientDrawer();

  const filtered = useMemo(
    () => division === 'All' ? referrals : referrals.filter((r) => r.division === division),
    [referrals, division]
  );

  const stageCounts = useMemo(() =>
    PIPELINE_STAGES.reduce((acc, s) => { acc[s] = filtered.filter((r) => r.current_stage === s).length; return acc; }, {}),
    [filtered]
  );

  const activeCount = filtered.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed').length;

  const newThisWeek = filtered.filter((r) => {
    if (!r.referral_date) return false;
    return Date.now() - new Date(r.referral_date).getTime() < 7 * 86400000;
  }).length;

  const recentPatients = useMemo(() =>
    [...filtered]
      .sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0))
      .slice(0, 12),
    [filtered]
  );

  if (loading) return <LoadingState message="Loading dashboard..." />;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          {division === 'All' ? 'All divisions' : division}
        </p>
      </div>

      {/* ── 1. Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Active Referrals"       value={activeCount}    sub="currently in pipeline"     color={palette.primaryMagenta.hex} />
        <StatCard label="New This Week"           value={newThisWeek}   sub="referrals received"         color={palette.accentBlue.hex} />
        <StatCard label="On Hold"                 value={stageCounts['Hold'] || 0} sub="awaiting resolution" color={palette.highlightYellow.hex} />
        <StatCard label="Not Taken Under Care"    value={stageCounts['NTUC'] || 0} sub="no admission" color={hexToRgba(palette.backgroundDark.hex, 0.4)} />
      </div>

      {/* ── 2. Patient list ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex }}>Recent Referrals</h2>
          <Link to="/patients" style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 550 }}>View all</Link>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px var(--color-card-shadow)` }}>
          {recentPatients.length === 0 ? (
            <EmptyState title="No referrals yet" subtitle="New referrals will appear here." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
                  {['Patient', 'Division', 'Stage', 'Priority', 'Referral Date'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 650, letterSpacing: '0.04em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentPatients.map((ref) => (
                  <tr
                    key={ref._id}
                    onDoubleClick={() => openPatient(ref.patient || { id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                    style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, transition: 'background 0.1s', cursor: 'default' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    title="Double-click to open patient"
                  >
                    <td style={{ padding: '11px 16px' }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</p>
                    </td>
                    <td style={{ padding: '11px 16px' }}><DivisionBadge division={ref.division} size="small" /></td>
                    <td style={{ padding: '11px 16px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                    <td style={{ padding: '11px 16px' }}><PriorityDot priority={ref.priority} /></td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                      {formatDate(ref.referral_date)}
                      {ref.referral_date && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>{daysAgo(ref.referral_date)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 3. Pipeline Snapshot ── (last) */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 14 }}>Pipeline Snapshot</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {PIPELINE_STAGES.filter((s) => s !== 'Hold' && s !== 'NTUC').map((stage) => (
            <StageCard key={stage} stage={stage} count={stageCounts[stage] || 0} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <StageCard stage="Hold" count={stageCounts['Hold'] || 0} muted />
          <StageCard stage="NTUC" count={stageCounts['NTUC'] || 0} muted />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, padding: '18px 20px', boxShadow: `0 1px 4px var(--color-card-shadow)`, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `3px solid ${color}` }}>
      <p style={{ fontSize: 11, fontWeight: 650, letterSpacing: '0.05em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: 32, fontWeight: 700, color: palette.backgroundDark.hex, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub}</p>
    </div>
  );
}

function StageCard({ stage, count, muted }) {
  return (
    <div style={{ background: muted ? hexToRgba(palette.backgroundDark.hex, 0.03) : palette.backgroundLight.hex, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}>
      <p style={{ fontSize: 11, fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, muted ? 0.35 : 0.55), marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stage}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: muted ? hexToRgba(palette.backgroundDark.hex, 0.35) : palette.backgroundDark.hex, lineHeight: 1 }}>{count}</p>
    </div>
  );
}

function PriorityDot({ priority }) {
  const colors = { Low: hexToRgba(palette.backgroundDark.hex, 0.25), Normal: palette.accentBlue.hex, High: palette.accentOrange.hex, Critical: palette.primaryMagenta.hex };
  const c = colors[priority] || colors.Normal;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{priority || 'Normal'}</span>
    </span>
  );
}
