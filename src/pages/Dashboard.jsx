import { useState, useMemo, useRef } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePreferences } from '../context/UserPreferencesContext.jsx';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLookups } from '../hooks/useLookups.js';
import { useCareStore } from '../store/careStore.js';
import EmptyState from '../components/common/EmptyState.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import { SkeletonStatCard, SkeletonTableRow, SkeletonStageCard, SkeletonRect } from '../components/common/Skeleton.jsx';
import NewReferralForm from '../components/forms/NewReferralForm.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import palette, { hexToRgba } from '../utils/colors.js';

const PIPELINE_STAGES = [
  'Lead Entry','Intake','Eligibility Verification','Disenrollment Required',
  'F2F/MD Orders Pending','Clinical Intake RN Review','Authorization Pending',
  'Conflict','Staffing Feasibility','Admin Confirmation',
  'Pre-SOC','SOC Scheduled','SOC Completed','Hold','NTUC',
];

const TERMINAL_STAGES = new Set(['NTUC', 'SOC Completed']);

// Maps each stage to its dedicated module route
const STAGE_ROUTE = {
  'Lead Entry':                '/modules/lead-entry',
  'Intake':                    '/modules/intake',
  'Eligibility Verification':  '/modules/eligibility',
  'Disenrollment Required':    '/modules/disenrollment',
  'F2F/MD Orders Pending':     '/modules/f2f',
  'Clinical Intake RN Review': '/modules/clinical-rn',
  'Authorization Pending':     '/modules/authorization',
  'Conflict':                  '/modules/conflict',
  'Staffing Feasibility':      '/modules/staffing',
  'Admin Confirmation':        '/modules/admin-confirmation',
  'Pre-SOC':                   '/modules/pre-soc',
  'SOC Scheduled':             '/modules/soc-scheduled',
  'SOC Completed':             '/modules/soc-completed',
  'Hold':                      '/modules/hold',
  'NTUC':                      '/modules/ntuc',
};

// Each base hue has three opacity tiers (33 / 66 / 100%) so all 15 stages
// get a visually unique shade without introducing new colors.
//
//  Blue family   → Lead Entry (100%) · Intake (66%) · Staffing Feasibility (33%)
//  Orange family → Eligibility (100%) · Disenrollment (66%) · F2F/MD (33%)
//  Magenta family→ Clinical Intake (100%) · Conflict (66%) · Auth Pending (33%)
//  Deep Plum     → Admin Confirmation (100%)
//  Green family  → SOC Completed (100%) · SOC Scheduled (66%) · Pre-SOC (33%)
//  Yellow        → Hold (100%)
//  Dark          → NTUC (33%)
const STAGE_BAR_COLOR = {
  'Lead Entry':                palette.accentBlue.hex,
  'Intake':                    hexToRgba(palette.accentBlue.hex, 0.66),
  'Staffing Feasibility':      hexToRgba(palette.accentBlue.hex, 0.33),

  'Eligibility Verification':  palette.accentOrange.hex,
  'Disenrollment Required':    hexToRgba(palette.accentOrange.hex, 0.66),
  'F2F/MD Orders Pending':     hexToRgba(palette.accentOrange.hex, 0.33),

  'Clinical Intake RN Review': palette.primaryMagenta.hex,
  'Conflict':                  hexToRgba(palette.primaryMagenta.hex, 0.66),
  'Authorization Pending':     hexToRgba(palette.primaryMagenta.hex, 0.33),

  'Admin Confirmation':        palette.primaryDeepPlum.hex,

  'SOC Completed':             palette.accentGreen.hex,
  'SOC Scheduled':             hexToRgba(palette.accentGreen.hex, 0.66),
  'Pre-SOC':                   hexToRgba(palette.accentGreen.hex, 0.33),

  'Hold':                      palette.highlightYellow.hex,
  'NTUC':                      hexToRgba(palette.backgroundDark.hex, 0.33),
};

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
  const { prefs, save } = usePreferences();
  const { can } = usePermissions();
  const mode = prefs.dashboardMode || 'executive';
  const canToggle = can(PERMISSION_KEYS.DASHBOARD_MODE_TOGGLE);

  function handleToggle() {
    const next = mode === 'executive' ? 'caseload' : 'executive';
    save({ dashboardMode: next });
  }

  return (
    <>
      {canToggle && (
        <DashboardModeToggle mode={mode} onToggle={handleToggle} />
      )}
      {mode === 'caseload' ? <CaseloadDashboard /> : <ExecutiveDashboard />}
    </>
  );
}

function DashboardModeToggle({ mode, onToggle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 24px 0' }}>
      <button
        onClick={onToggle}
        data-testid="dashboard-mode-toggle"
        style={{
          padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
          background: hexToRgba(palette.primaryDeepPlum.hex, 0.06),
          border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.15)}`,
          fontSize: 11.5, fontWeight: 650, color: palette.primaryDeepPlum.hex,
          display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {mode === 'executive' ? 'My Caseload' : 'Executive View'}
      </button>
    </div>
  );
}

// ── Caseload Dashboard ────────────────────────────────────────────────────────

function CaseloadDashboard() {
  const { division } = useOutletContext();
  const { data: referrals, loading } = usePipelineData();
  const { appUserId, appUserName } = useCurrentAppUser();
  const { open: openPatient } = usePatientDrawer();
  const { resolveSource, resolveUser } = useLookups();
  const allTasks = useCareStore((s) => s.tasks);
  const isMobile = useIsMobile();

  const myReferrals = useMemo(() => {
    if (!appUserId) return [];
    return referrals
      .filter((r) => r.intake_owner_id === appUserId)
      .filter((r) => division === 'All' || r.division === division)
      .filter((r) => r.current_stage !== 'SOC Completed' && r.current_stage !== 'NTUC');
  }, [referrals, appUserId, division]);

  const myTasks = useMemo(() => {
    if (!appUserId) return [];
    return Object.values(allTasks)
      .filter((t) => t.assigned_to_id === appUserId && t.status !== 'Completed' && t.status !== 'Cancelled');
  }, [allTasks, appUserId]);

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days');
  const [sortDir, setSortDir] = useState('desc');

  const filteredRefs = useMemo(() => {
    let list = myReferrals;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.patientName || '').toLowerCase().includes(q) ||
        (r.current_stage || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortField === 'days') {
        const da = a.updated_at ? Math.floor((Date.now() - new Date(a.updated_at).getTime()) / 86400000) : 0;
        const db = b.updated_at ? Math.floor((Date.now() - new Date(b.updated_at).getTime()) / 86400000) : 0;
        return sortDir === 'desc' ? db - da : da - db;
      }
      if (sortField === 'name') {
        return sortDir === 'asc'
          ? (a.patientName || '').localeCompare(b.patientName || '')
          : (b.patientName || '').localeCompare(a.patientName || '');
      }
      if (sortField === 'stage') {
        return sortDir === 'asc'
          ? (a.current_stage || '').localeCompare(b.current_stage || '')
          : (b.current_stage || '').localeCompare(a.current_stage || '');
      }
      return 0;
    });
  }, [myReferrals, search, sortField, sortDir]);

  function toggleSort(field) {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  const stageBuckets = useMemo(() => {
    const buckets = {};
    myReferrals.forEach((r) => { buckets[r.current_stage] = (buckets[r.current_stage] || 0) + 1; });
    return Object.entries(buckets).sort(([, a], [, b]) => b - a);
  }, [myReferrals]);

  const overdue = myReferrals.filter((r) => {
    if (!r.updated_at || r.current_stage === 'Hold') return false;
    return Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000) > 14;
  }).length;

  if (loading) return <DashboardSkeleton isMobile={isMobile} />;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>My Caseload</h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {appUserName} · {myReferrals.length} active case{myReferrals.length !== 1 ? 's' : ''}
            {division !== 'All' && ` · ${division}`}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <StatCard label="My Cases" value={myReferrals.length} sub="active referrals" color={palette.primaryMagenta.hex} />
        <StatCard label="Open Tasks" value={myTasks.length} sub="assigned to me" color={palette.accentBlue.hex} />
        <StatCard label="Overdue" value={overdue} sub="in stage >14 days" color={overdue > 0 ? palette.accentOrange.hex : palette.accentGreen.hex} alert={overdue > 0} />
        <StatCard label="Stages" value={stageBuckets.length} sub="across modules" color={palette.primaryDeepPlum.hex} />
      </div>

      {/* Stage breakdown pills */}
      {stageBuckets.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {stageBuckets.map(([stage, count]) => (
            <span key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, background: hexToRgba(palette.backgroundDark.hex, 0.05), fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
              <StageBadge stage={stage} size="small" /> {count}
            </span>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 7, padding: '0 10px', height: 32, flex: 1, maxWidth: 300 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search my cases..." style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 4, width: 16, height: 16, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>}
        </div>
        {[{ label: 'Days', field: 'days' }, { label: 'Name', field: 'name' }, { label: 'Stage', field: 'stage' }].map((s) => {
          const active = sortField === s.field;
          return (
            <button key={s.field} onClick={() => toggleSort(s.field)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: active ? palette.primaryMagenta.hex : 'none', color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              {s.label}{active && <span style={{ fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
            </button>
          );
        })}
      </div>

      {/* Queue table */}
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {filteredRefs.length === 0 ? (
          <EmptyState title="No cases in your caseload" subtitle={search ? 'Try a different search.' : 'Cases assigned to you will appear here.'} />
        ) : (
          <table data-testid="caseload-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
                {['Patient', 'Module / Stage', 'Division', 'Days', 'Source', 'Referral Date'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', color: hexToRgba(palette.backgroundDark.hex, 0.4), textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRefs.map((ref) => {
                const days = ref.updated_at ? Math.max(0, Math.floor((Date.now() - new Date(ref.updated_at).getTime()) / 86400000)) : 0;
                return (
                  <tr key={ref._id}
                    onDoubleClick={() => openPatient(ref.patient || { id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                    style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, transition: 'background 0.1s', cursor: 'default' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    title="Double-click to open"
                  >
                    <td style={{ padding: '11px 14px' }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</p>
                      {ref.patient?.medicaid_number && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Medicaid: {ref.patient.medicaid_number}</p>}
                    </td>
                    <td style={{ padding: '11px 14px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                    <td style={{ padding: '11px 14px' }}><DivisionBadge division={ref.division} size="small" /></td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 13, fontWeight: days > 14 ? 650 : 400, color: days > 14 ? palette.primaryMagenta.hex : days > 7 ? palette.accentOrange.hex : palette.backgroundDark.hex }}>
                        {days === 0 ? 'Today' : `${days}d`}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSource(ref.referral_source_id) || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{ref.referral_date ? formatDate(ref.referral_date) : '—'}</td>
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

// ── Executive Dashboard (preserved existing behavior) ─────────────────────────

function ExecutiveDashboard() {
  const { division } = useOutletContext();
  const { data: referrals, loading } = usePipelineData();
  const { open: openPatient } = usePatientDrawer();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { can } = usePermissions();
  const [showNewReferral, setShowNewReferral] = useState(false);

  const filtered = useMemo(
    () => division === 'All' ? referrals : referrals.filter((r) => r.division === division),
    [referrals, division],
  );

  const stageCounts = useMemo(() =>
    PIPELINE_STAGES.reduce((acc, s) => {
      acc[s] = filtered.filter((r) => r.current_stage === s).length;
      return acc;
    }, {}),
    [filtered],
  );

  const activeCount = filtered.filter((r) => !TERMINAL_STAGES.has(r.current_stage)).length;

  // New this week vs last week (WoW delta)
  const now = Date.now();
  const newThisWeek = filtered.filter((r) => r.referral_date && now - new Date(r.referral_date).getTime() < 7 * 86400000).length;
  const newLastWeek = filtered.filter((r) => {
    if (!r.referral_date) return false;
    const ms = now - new Date(r.referral_date).getTime();
    return ms >= 7 * 86400000 && ms < 14 * 86400000;
  }).length;

  // Referrals that have been in their current (non-terminal) stage for > 14 days
  const overdueCount = useMemo(() =>
    filtered.filter((r) => {
      if (TERMINAL_STAGES.has(r.current_stage) || r.current_stage === 'Hold') return false;
      if (!r.updated_at) return false;
      return Math.floor((now - new Date(r.updated_at).getTime()) / 86400000) > 14;
    }).length,
    [filtered],
  );

  const recentPatients = useMemo(() =>
    [...filtered]
      .sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0))
      .slice(0, 12),
    [filtered],
  );

  // With the hydration gate in AppShell, `loading` is almost always false.
  // But as a safety fallback, show skeletons (not a spinner) if data isn't ready.
  if (loading) return <DashboardSkeleton isMobile={isMobile} />;

  const wowDelta = newThisWeek - newLastWeek;

  // ── Mobile dashboard ────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ padding: '16px 16px 8px' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}>Dashboard</h1>
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Updated {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>

        {/* KPI 2×2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          <StatCard label="Active" value={activeCount} sub="in pipeline" color={palette.primaryMagenta.hex} />
          <StatCard label="New This Week" value={newThisWeek} sub={`${newLastWeek} last week`} delta={wowDelta} color={palette.accentBlue.hex} />
          <StatCard label="On Hold" value={stageCounts['Hold'] || 0} sub="awaiting" color={palette.highlightYellow.hex} />
          <StatCard label="Overdue" value={overdueCount} sub="›14 days" color={overdueCount > 0 ? palette.accentOrange.hex : palette.accentGreen.hex} alert={overdueCount > 0} />
        </div>

        {/* Recent referrals — card list */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Recent Referrals
          </p>
          {recentPatients.length === 0 ? (
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>No referrals yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentPatients.slice(0, 8).map((ref) => (
                <div
                  key={ref._id}
                  style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: palette.backgroundLight.hex,
                    border: `1px solid var(--color-border)`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex }}>
                      {ref.patientName || ref.patient_id}
                    </p>
                    <StageBadge stage={ref.current_stage} size="small" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <DivisionBadge division={ref.division} size="small" />
                    {ref.referral_date && (
                      <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                        {formatDate(ref.referral_date)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New referral modal */}
        {showNewReferral && (
          <NewReferralForm
            onClose={() => setShowNewReferral(false)}
            onSuccess={() => { triggerDataRefresh(); setShowNewReferral(false); }}
          />
        )}
      </div>
    );
  }

  // ── Desktop dashboard (unchanged) ──────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Dashboard</h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {division === 'All' ? 'All divisions' : division}
            &nbsp;·&nbsp;
            <span>Updated {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          </p>
        </div>
        {can(PERMISSION_KEYS.REFERRAL_CREATE) && (
          <button
            onClick={() => setShowNewReferral(true)}
            style={{ padding: '8px 16px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}
          >
            + New Referral
          </button>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <StatCard label="Active Referrals" value={activeCount} sub="currently in pipeline" color={palette.primaryMagenta.hex} />
        <StatCard label="New This Week" value={newThisWeek} sub={newLastWeek > 0 ? `${newLastWeek} last week` : 'vs. last week'} delta={wowDelta} color={palette.accentBlue.hex} />
        <StatCard label="On Hold" value={stageCounts['Hold'] || 0} sub="awaiting resolution" color={palette.highlightYellow.hex} />
        <StatCard label="Overdue  ›14 days" value={overdueCount} sub="in stage too long" color={overdueCount > 0 ? palette.accentOrange.hex : palette.accentGreen.hex} alert={overdueCount > 0} />
      </div>

      {/* ── Stage distribution bar ── */}
      {activeCount > 0 && (
        <StageDistributionBar
          stageCounts={stageCounts}
          total={activeCount}
          onNavigateToStage={(stage) => navigate(STAGE_ROUTE[stage] ?? '/pipeline')}
        />
      )}

      {/* ── Recent referrals ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex }}>Recent Referrals</h2>
          <Link to="/patients" style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 550 }}>View all</Link>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
          {recentPatients.length === 0 ? (
            <EmptyState title="No referrals yet" subtitle="New referrals will appear here." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
                  {['Patient', 'Division', 'Stage', 'Priority', 'Referral Date'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 650, letterSpacing: '0.04em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>
                      {h}
                    </th>
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

      {/* ── Pipeline snapshot ── */}
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

      {/* ── New referral modal ── */}
      {showNewReferral && (
        <NewReferralForm
          onClose={() => setShowNewReferral(false)}
          onSuccess={({ patient, referral }) => {
            triggerDataRefresh();
            openPatient(patient, referral);
          }}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, delta, alert }) {
  const hasDelta = delta !== undefined && delta !== null;
  return (
    <div
      style={{
        background:    palette.backgroundLight.hex,
        borderRadius:  12,
        padding:       '18px 20px',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
        borderTop:     `3px solid ${color}`,
        border:        `1px solid var(--color-border)`,
        borderTop:     `3px solid ${color}`,
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 650, letterSpacing: '0.05em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <p style={{ fontSize: 32, fontWeight: 700, color: alert ? color : palette.backgroundDark.hex, lineHeight: 1 }}>{value}</p>
        {hasDelta && delta !== 0 && (
          <span
            title={`${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than last week`}
            style={{
              fontSize:   12,
              fontWeight: 650,
              color:      delta > 0 ? palette.accentGreen.hex : palette.accentOrange.hex,
              display:    'flex',
              alignItems: 'center',
              gap:        2,
            }}
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
        {hasDelta && delta === 0 && (
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>→ same</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub}</p>
    </div>
  );
}

function StageDistributionBar({ stageCounts, total, onNavigateToStage }) {
  const barRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { stage, count, x }

  const activeStages = PIPELINE_STAGES.filter((s) => stageCounts[s] > 0);
  const topStages = [...activeStages]
    .sort((a, b) => stageCounts[b] - stageCounts[a])
    .slice(0, 6);

  function handleSegmentEnter(e, stage) {
    if (!barRef.current) return;
    const barRect = barRef.current.getBoundingClientRect();
    const segRect = e.currentTarget.getBoundingClientRect();
    const cx = segRect.left - barRect.left + segRect.width / 2;
    // Clamp so the tooltip never bleeds outside the bar
    const clamped = Math.max(60, Math.min(cx, barRect.width - 60));
    setTooltip({ stage, count: stageCounts[stage], x: clamped });
    e.currentTarget.style.filter = 'brightness(1.12) saturate(1.1)';
  }

  function handleSegmentLeave(e) {
    setTooltip(null);
    e.currentTarget.style.filter = '';
  }

  return (
    <div
      style={{
        background:   palette.backgroundLight.hex,
        borderRadius: 12,
        padding:      '16px 20px',
        border:       `1px solid var(--color-border)`,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
          Stage Distribution
        </p>
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
          {total} active&nbsp;·&nbsp;double-click a segment to open its module
        </p>
      </div>

      {/* Bar — position:relative so the tooltip can be absolutely positioned inside */}
      <div style={{ position: 'relative' }}>
        <div
          ref={barRef}
          style={{
            display:      'flex',
            height:       14,
            borderRadius: 6,
            overflow:     'hidden',
            gap:          1.5,
            background:   hexToRgba(palette.backgroundDark.hex, 0.05),
          }}
        >
          {activeStages.map((stage) => {
            const pct = (stageCounts[stage] / total) * 100;
            return (
              <div
                key={stage}
                style={{
                  width:        `${pct}%`,
                  minWidth:     3,
                  background:   STAGE_BAR_COLOR[stage] || hexToRgba(palette.backgroundDark.hex, 0.3),
                  flexShrink:   0,
                  cursor:       'pointer',
                  transition:   'filter 0.1s',
                }}
                onMouseEnter={(e) => handleSegmentEnter(e, stage)}
                onMouseLeave={handleSegmentLeave}
                onDoubleClick={() => onNavigateToStage(stage)}
              />
            );
          })}
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position:      'absolute',
              bottom:        'calc(100% + 10px)',
              left:          tooltip.x,
              transform:     'translateX(-50%)',
              background:    palette.backgroundDark.hex,
              color:         palette.backgroundLight.hex,
              padding:       '5px 11px',
              borderRadius:  6,
              fontSize:      11.5,
              fontWeight:    500,
              whiteSpace:    'nowrap',
              pointerEvents: 'none',
              zIndex:        20,
              boxShadow:     `0 4px 14px ${hexToRgba(palette.backgroundDark.hex, 0.22)}`,
            }}
          >
            <strong style={{ fontWeight: 700 }}>{tooltip.stage}</strong>
            &ensp;·&ensp;
            {tooltip.count} referral{tooltip.count !== 1 ? 's' : ''}
            {/* Arrow */}
            <span
              style={{
                position:    'absolute',
                top:         '100%',
                left:        '50%',
                transform:   'translateX(-50%)',
                width:       0,
                height:      0,
                borderLeft:  '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop:   `5px solid ${palette.backgroundDark.hex}`,
              }}
            />
          </div>
        )}
      </div>

      {/* Legend — top stages by count */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        {topStages.map((stage) => (
          <span
            key={stage}
            onClick={() => onNavigateToStage(stage)}
            title={`Open ${stage} module`}
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:        5,
              fontSize:   11,
              color:      hexToRgba(palette.backgroundDark.hex, 0.55),
              cursor:     'pointer',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_BAR_COLOR[stage], flexShrink: 0, display: 'inline-block' }} />
            <strong style={{ fontWeight: 700 }}>{stageCounts[stage]}</strong>
            &nbsp;{stage}
          </span>
        ))}
      </div>
    </div>
  );
}

function StageCard({ stage, count, muted }) {
  return (
    <div
      style={{
        background:   muted ? hexToRgba(palette.backgroundDark.hex, 0.03) : palette.backgroundLight.hex,
        border:       `1px solid var(--color-border)`,
        borderRadius: 10,
        padding:      '14px 16px',
        cursor:       'pointer',
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, muted ? 0.35 : 0.55), marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stage}>{stage}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: muted ? hexToRgba(palette.backgroundDark.hex, 0.35) : palette.backgroundDark.hex, lineHeight: 1 }}>{count}</p>
    </div>
  );
}

function PriorityDot({ priority }) {
  const colors = {
    Low:      hexToRgba(palette.backgroundDark.hex, 0.25),
    Normal:   palette.accentBlue.hex,
    High:     palette.accentOrange.hex,
    Critical: palette.primaryMagenta.hex,
  };
  const c = colors[priority] || colors.Normal;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{priority || 'Normal'}</span>
    </span>
  );
}

function DashboardSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <div style={{ padding: '16px 16px 8px' }}>
        <SkeletonRect width={120} height={20} style={{ marginBottom: 8 }} />
        <SkeletonRect width={80} height={12} style={{ marginBottom: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)}
        </div>
        <SkeletonRect width={100} height={12} style={{ marginBottom: 12 }} />
        {[0, 1, 2, 3].map((i) => (
          <SkeletonRect key={i} height={68} style={{ marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <SkeletonRect width={140} height={22} style={{ marginBottom: 6 }} />
          <SkeletonRect width={180} height={12} />
        </div>
        <SkeletonRect width={120} height={36} borderRadius={8} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)}
      </div>
      <SkeletonRect height={80} style={{ marginBottom: 24 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <SkeletonRect width={120} height={14} />
        <SkeletonRect width={60} height={14} />
      </div>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
              {['Patient', 'Division', 'Stage', 'Priority', 'Referral Date'].map((h) => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 650, letterSpacing: '0.04em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonTableRow key={i} columns={5} />)}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 28 }}>
        <SkeletonRect width={140} height={14} style={{ marginBottom: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {Array.from({ length: 13 }).map((_, i) => <SkeletonStageCard key={i} />)}
        </div>
      </div>
    </div>
  );
}
