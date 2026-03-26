import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCareStore } from '../../store/careStore.js';
import { createTaskOptimistic } from '../../store/mutations.js';
import { usePipelineData } from '../../hooks/usePipelineData.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { MODULE_COLUMN_DEFS, useColumnVisibility, useColumnFilters, ColumnPicker, FilterInput, FilterIcon, ColsIcon } from '../../utils/columnModel.jsx';
import StageBadge from '../common/StageBadge.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import EmptyState from '../common/EmptyState.jsx';
import { STAGE_SLUGS } from '../../data/stageConfig.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const TERMINAL = new Set(['NTUC', 'SOC Completed']);
const STAGE_BAR_COLOR = {
  'Lead Entry': palette.accentBlue.hex, 'Intake': hexToRgba(palette.accentBlue.hex, 0.66), 'Staffing Feasibility': hexToRgba(palette.accentBlue.hex, 0.33),
  'Eligibility Verification': palette.accentOrange.hex, 'Disenrollment Required': hexToRgba(palette.accentOrange.hex, 0.66), 'F2F/MD Orders Pending': hexToRgba(palette.accentOrange.hex, 0.33),
  'Clinical Intake RN Review': palette.primaryMagenta.hex, 'Conflict': hexToRgba(palette.primaryMagenta.hex, 0.66), 'Authorization Pending': hexToRgba(palette.primaryMagenta.hex, 0.33),
  'Admin Confirmation': palette.primaryDeepPlum.hex, 'Pre-SOC': hexToRgba(palette.accentGreen.hex, 0.33), 'SOC Scheduled': hexToRgba(palette.accentGreen.hex, 0.66),
  'SOC Completed': palette.accentGreen.hex, 'Hold': palette.highlightYellow.hex, 'NTUC': hexToRgba(palette.backgroundDark.hex, 0.33),
};
const STATUS_DOT = { Active: palette.accentGreen.hex, Pending: palette.highlightYellow.hex, Suspended: palette.accentOrange.hex, Revoked: hexToRgba(palette.backgroundDark.hex, 0.3) };
const ACTION_COLORS = { 'Referral Created': palette.accentGreen.hex, 'Stage Change': palette.accentBlue.hex, 'Note Added': palette.primaryMagenta.hex, 'Task Created': palette.accentOrange.hex, 'File Uploaded': palette.primaryDeepPlum.hex, 'Patient Created': palette.accentGreen.hex, 'Insurance Check': palette.highlightYellow.hex, 'Triage Submitted': palette.primaryMagenta.hex, 'Conflict Flagged': palette.accentOrange.hex };

function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtTime(ts) { if (!ts) return '—'; const diff = Date.now() - new Date(ts).getTime(); const m = Math.floor(diff / 60000); if (m < 2) return 'Just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function initials(f, l) { return `${(f || '?')[0]}${(l || '')[0] || ''}`.toUpperCase(); }

export default function DepartmentDashboard({ department, scope }) {
  const { data: referrals } = usePipelineData();
  const { resolveUser, resolveSource, resolveRole, resolveFacility } = useLookups();
  const { open: openPatient } = usePatientDrawer();
  const { appUserId } = useCurrentAppUser();
  const navigate = useNavigate();
  const storeUsers = useCareStore((s) => s.users);
  const activityLog = useCareStore((s) => s.activityLog);
  const storePatients = useCareStore((s) => s.patients);
  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.TASK_ASSIGN);
  const [expandedMember, setExpandedMember] = useState(null);
  const [search, setSearch] = useState('');
  const [showColPicker, setShowColPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const colPickerRef = useRef(null);
  const barRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const { visibleCols, setVisibleCols, activeColumns } = useColumnVisibility(MODULE_COLUMN_DEFS);
  const { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters } = useColumnFilters(MODULE_COLUMN_DEFS);

  const scopeStages = useMemo(() => {
    if (!scope?.stage_access) return [];
    if (typeof scope.stage_access === 'string') { try { return JSON.parse(scope.stage_access); } catch { return scope.stage_access.split(',').map((s) => s.trim()); } }
    return Array.isArray(scope.stage_access) ? scope.stage_access : [];
  }, [scope]);

  const members = useMemo(() => Object.values(storeUsers).filter((u) => u.department_id === department.id && (u.status === 'Active' || !u.status)).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')), [storeUsers, department.id]);

  const scopedReferrals = useMemo(() => {
    if (!scopeStages.length) return referrals.filter((r) => !TERMINAL.has(r.current_stage));
    return referrals.filter((r) => new Set(scopeStages).has(r.current_stage));
  }, [referrals, scopeStages]);

  const activeCount = scopedReferrals.filter((r) => !TERMINAL.has(r.current_stage)).length;
  const now = Date.now();
  const overdueCount = scopedReferrals.filter((r) => { if (TERMINAL.has(r.current_stage) || r.current_stage === 'Hold' || !r.updated_at) return false; return Math.floor((now - new Date(r.updated_at).getTime()) / 86400000) > 14; }).length;
  const stageCounts = useMemo(() => { const c = {}; scopedReferrals.forEach((r) => { c[r.current_stage] = (c[r.current_stage] || 0) + 1; }); return c; }, [scopedReferrals]);
  const activeStages = scopeStages.length > 0 ? scopeStages.filter((s) => stageCounts[s] > 0) : Object.keys(stageCounts).filter((s) => stageCounts[s] > 0);

  const displayedReferrals = useMemo(() => {
    let list = scopedReferrals;
    if (search.trim()) { const q = search.toLowerCase(); list = list.filter((r) => (r.patientName || '').toLowerCase().includes(q) || (r.patient_id || '').toLowerCase().includes(q)); }
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue; const q = val.toLowerCase();
      list = list.filter((r) => { switch (key) { case 'division': return (r.division || '').toLowerCase().includes(q); case 'source': return (resolveSource(r.referral_source_id) || '').toLowerCase().includes(q); case 'owner': return (resolveUser(r.intake_owner_id) || '').toLowerCase().includes(q); case 'insurance': return (r.patient?.insurance_plan || '').toLowerCase().includes(q); case 'facility': return (resolveFacility(r.facility_id) || '').toLowerCase().includes(q); default: return true; } });
    }
    return [...list].sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0));
  }, [scopedReferrals, search, colFilters, resolveSource, resolveUser, resolveFacility]);

  const allActivities = useMemo(() => Object.values(activityLog || {}), [activityLog]);
  function getMemberActs(uid, n) { return allActivities.filter((a) => a.actor_id === uid).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, n); }
  function patName(pid) { if (!pid) return null; const p = Object.values(storePatients).find((pt) => pt.id === pid); return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : null; }
  const hasAnyFilter = search.trim() || hasActiveFilters;

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; setContextMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [contextMenu]);

  function handleMemberRightClick(e, member) {
    if (!isAdmin || member.id === appUserId) return;
    e.preventDefault();
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 80), user: member });
  }

  function renderCell(col, ref) {
    const days = ref.updated_at ? Math.max(0, Math.floor((now - new Date(ref.updated_at).getTime()) / 86400000)) : 0;
    switch (col.key) {
      case 'patient': return <td key="patient" style={{ padding: '11px 14px' }}><p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</p></td>;
      case 'division': return <td key="division" style={{ padding: '11px 14px' }}><DivisionBadge division={ref.division} size="small" /></td>;
      case 'source': return <td key="source" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSource(ref.referral_source_id) || '—'}</td>;
      case 'triage': return <td key="triage" style={{ padding: '11px 14px' }}><StageBadge stage={ref.current_stage} size="small" /></td>;
      case 'days': return <td key="days" style={{ padding: '11px 14px' }}><span style={{ fontSize: 13, fontWeight: days > 14 ? 650 : 400, color: days > 14 ? palette.primaryMagenta.hex : days > 7 ? palette.accentOrange.hex : palette.backgroundDark.hex }}>{days === 0 ? 'Today' : `${days}d`}</span></td>;
      case 'f2f': return <td key="f2f" style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{ref.f2f_expiration ? `${Math.ceil((new Date(ref.f2f_expiration) - now) / 86400000)}d` : '—'}</td>;
      case 'owner': return <td key="owner" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveUser(ref.intake_owner_id) || '—'}</td>;
      case 'insurance': return <td key="ins" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{ref.patient?.insurance_plan || '—'}</td>;
      case 'facility': return <td key="fac" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveFacility(ref.facility_id) || '—'}</td>;
      case 'activity': return <td key="act" style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{fmtDate(ref.referral_date)}</td>;
      default: return <td key={col.key} />;
    }
  }

  return (
    <div data-testid="department-dashboard">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>{department.name}</h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{members.length} member{members.length !== 1 ? 's' : ''} · {activeCount} active · Supervisor: {resolveUser(department.supervisor)}{department.division ? ` · ${department.division}` : ''}</p>
        </div>
      </div>

      {/* KPI cards — same style as main dashboard: border, colored top */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Active Cases', value: activeCount, sub: 'in department scope', color: palette.primaryMagenta.hex },
          { label: 'Stages', value: Object.keys(stageCounts).length, sub: 'with patients', color: palette.accentBlue.hex },
          { label: 'Overdue >14d', value: overdueCount, sub: 'in stage too long', color: overdueCount > 0 ? palette.accentOrange.hex : palette.accentGreen.hex, alert: overdueCount > 0 },
          { label: 'Team', value: members.length, sub: 'active members', color: palette.primaryDeepPlum.hex },
        ].map((c) => (
          <div key={c.label} style={{ background: palette.backgroundLight.hex, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6, border: `1px solid var(--color-border)`, borderTop: `3px solid ${c.color}` }}>
            <p style={{ fontSize: 11, fontWeight: 650, letterSpacing: '0.05em', color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase' }}>{c.label}</p>
            <p style={{ fontSize: 32, fontWeight: 700, color: c.alert ? c.color : palette.backgroundDark.hex, lineHeight: 1 }}>{c.value}</p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Stage distribution bar — same as main dashboard */}
      {activeCount > 0 && (
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, padding: '16px 20px', border: `1px solid var(--color-border)`, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Stage Distribution</p>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>{activeCount} in scope · double-click to open module</p>
          </div>
          <div style={{ position: 'relative' }}>
            <div ref={barRef} style={{ display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', gap: 1.5, background: hexToRgba(palette.backgroundDark.hex, 0.05) }}>
              {activeStages.map((stage) => (<div key={stage} style={{ width: `${(stageCounts[stage] / activeCount) * 100}%`, minWidth: 3, background: STAGE_BAR_COLOR[stage] || hexToRgba(palette.backgroundDark.hex, 0.3), cursor: 'pointer', transition: 'filter 0.1s' }}
                onMouseEnter={(e) => { if (!barRef.current) return; const br = barRef.current.getBoundingClientRect(); const sr = e.currentTarget.getBoundingClientRect(); setTooltip({ stage, count: stageCounts[stage], x: Math.max(60, Math.min(sr.left - br.left + sr.width / 2, br.width - 60)) }); e.currentTarget.style.filter = 'brightness(1.12)'; }}
                onMouseLeave={(e) => { setTooltip(null); e.currentTarget.style.filter = ''; }}
                onDoubleClick={() => { const slug = STAGE_SLUGS[stage]; if (slug) navigate(`/modules/${slug}`); }} />))}
            </div>
            {tooltip && <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', left: tooltip.x, transform: 'translateX(-50%)', background: palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '5px 11px', borderRadius: 6, fontSize: 11.5, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20 }}><strong>{tooltip.stage}</strong> · {tooltip.count}<span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `5px solid ${palette.backgroundDark.hex}` }} /></div>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            {activeStages.slice(0, 8).map((s) => (<span key={s} onClick={() => { const slug = STAGE_SLUGS[s]; if (slug) navigate(`/modules/${slug}`); }} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_BAR_COLOR[s] }} /><strong>{stageCounts[s]}</strong> {s}</span>))}
          </div>
        </div>
      )}

      {/* Team — matching Team.jsx UserCard style */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 14 }}>Team</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {members.map((m) => {
            const acts = getMemberActs(m.id, expandedMember === m.id ? 30 : 3);
            const expanded = expandedMember === m.id;
            const photo = m.clerk_image_url || null;
            const roleName = resolveRole(m.role_id);
            const sc = STATUS_DOT[m.status] || STATUS_DOT.Active;
            const isMe = m.id === appUserId;
            return (
              <div key={m.id} data-testid={`member-card-${m.id}`} onContextMenu={(e) => handleMemberRightClick(e, m)}
                title={isAdmin && m.id !== appUserId ? 'Right-click to assign task' : undefined}
                style={{ borderRadius: 12, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, overflow: 'hidden', cursor: isAdmin && m.id !== appUserId ? 'context-menu' : 'default' }}>
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {photo ? <img src={photo} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.14), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: palette.primaryMagenta.hex }}>{initials(m.first_name, m.last_name)}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.first_name} {m.last_name}{isMe && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: hexToRgba(palette.primaryMagenta.hex, 0.7) }}>you</span>}</p>
                    </div>
                    <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>{m.email}</p>
                    {roleName && <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex }}>{roleName}</span>}
                  </div>
                  <button onClick={() => setExpandedMember(expanded ? null : m.id)} style={{ padding: '5px 11px', borderRadius: 6, background: expanded ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', color: expanded ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>{expanded ? 'Collapse' : 'Activity'}</button>
                </div>
                {(expanded || acts.length > 0) && (
                  <div style={{ padding: '0 16px 12px', maxHeight: expanded ? 400 : 100, overflowY: 'auto', borderTop: `1px solid var(--color-border)` }}>
                    {acts.length === 0 ? <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3), fontStyle: 'italic', padding: '10px 0' }}>No recent activity</p>
                    : acts.map((a) => {
                      const ac = ACTION_COLORS[a.action] || hexToRgba(palette.backgroundDark.hex, 0.4);
                      const pn = patName(a.patient_id);
                      return (
                        <div key={a._id || a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ac, flexShrink: 0, marginTop: 5 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>{a.action}</span>
                              <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.3), marginLeft: 'auto', flexShrink: 0 }}>{fmtTime(a.timestamp)}</span>
                            </div>
                            {a.detail && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginTop: 1, lineHeight: 1.4 }}>{a.detail}</p>}
                            {pn && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 1 }}>{pn}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Patient table — full filter/column system like module pages */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex }}>Patients Under Department Scope ({displayedReferrals.length})</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 7, padding: '0 10px', height: 32, flex: 1, maxWidth: 260, position: 'relative' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
            {search && <button onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 4, width: 16, height: 16, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowFilters((v) => !v)} style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none', fontSize: 12, fontWeight: 600, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer', flexShrink: 0 }}>
            <FilterIcon /> Filters {hasActiveFilters && <span style={{ width: 6, height: 6, borderRadius: '50%', background: palette.accentBlue.hex }} />}
          </button>
          <div ref={colPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setShowColPicker((v) => !v)} style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, border: `1px solid ${showColPicker ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: showColPicker ? hexToRgba(palette.primaryMagenta.hex, 0.07) : 'none', fontSize: 12, fontWeight: 600, color: showColPicker ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}><ColsIcon /> Columns</button>
            {showColPicker && <ColumnPicker columnDefs={MODULE_COLUMN_DEFS} visibleCols={visibleCols} onChange={setVisibleCols} onClose={() => setShowColPicker(false)} />}
          </div>
          {hasAnyFilter && <button onClick={() => { setSearch(''); clearFilters(); }} style={{ height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'none', fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer', flexShrink: 0 }}>Clear all</button>}
        </div>
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
          {displayedReferrals.length === 0 ? <EmptyState title="No patients under department scope" subtitle={hasAnyFilter ? 'Try clearing filters.' : 'Patients will appear when they enter stages within this department scope.'} />
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                  {activeColumns.map((col) => (<th key={col.key} title={col.tooltip} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: col.tooltip ? 'help' : 'default' }}>{col.label}{col.tooltip && <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 9 }}>ⓘ</span>}</th>))}
                </tr>
                {showFilters && (
                  <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                    {activeColumns.map((col) => (<th key={col.key} style={{ padding: '4px 8px' }}>{col.filterable ? <FilterInput value={colFilters[col.key] || ''} onChange={(v) => setColFilter(col.key, v)} placeholder={col.label} /> : null}</th>))}
                  </tr>
                )}
              </thead>
              <tbody>
                {displayedReferrals.map((ref) => (
                  <tr key={ref._id} onDoubleClick={() => openPatient(ref.patient || { id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                    style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'default', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')} title="Double-click to open">
                    {activeColumns.map((col) => renderCell(col, ref))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {/* Right-click context menu — same pattern as Team.jsx */}
      {contextMenu && (
        <div onMouseDown={(e) => e.stopPropagation()} style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 8000, background: palette.backgroundLight.hex, borderRadius: 9, boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`, border: `1px solid var(--color-border)`, overflow: 'hidden', minWidth: 170 }}>
          <div style={{ padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {contextMenu.user.first_name} {contextMenu.user.last_name}
          </div>
          <button onClick={() => { setAssignTarget(contextMenu.user); setContextMenu(null); }}
            style={{ width: '100%', padding: '9px 14px', border: 'none', background: 'none', textAlign: 'left', fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.06))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke={palette.primaryMagenta.hex} strokeWidth="2.2" strokeLinecap="round"/></svg>
            Assign Task
          </button>
        </div>
      )}

      {/* Assign task modal — same pattern as Team.jsx */}
      {assignTarget && (
        <DeptAssignTaskModal target={assignTarget} appUserId={appUserId} resolveRole={resolveRole} onClose={() => setAssignTarget(null)} />
      )}
    </div>
  );
}

const TASK_TYPES = ['Insurance Barrier', 'Missing Document', 'Auth Needed', 'Disenrollment', 'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other'];

function DeptAssignTaskModal({ target, appUserId, resolveRole, onClose }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { const h = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const canSubmit = type && title.trim() && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true); setError(null);
    try {
      await createTaskOptimistic({ title: title.trim(), type, description: desc.trim() || undefined, assigned_to_id: target.id, due_date: dueDate || undefined, status: 'Pending', route_to_role: 'Admin' });
      setSuccess(true);
    } catch (err) { setError(err.message || 'Failed'); setSaving(false); }
  }

  const inp = { width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), color: palette.backgroundDark.hex, boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: hexToRgba(palette.backgroundDark.hex, 0.45), backdropFilter: 'blur(3px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: palette.backgroundLight.hex, borderRadius: 14, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 3 }}>Assign Task</p>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundDark.hex }}>{target.first_name} {target.last_name}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        {success ? (
          <div style={{ padding: '36px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: palette.accentGreen.hex, marginBottom: 8 }}>Task assigned</p>
            <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer' }}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inp, cursor: 'pointer' }}><option value="">Task type *</option>{TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title *" style={inp} autoFocus />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" rows={2} style={{ ...inp, resize: 'vertical' }} />
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={new Date().toISOString().split('T')[0]} style={inp} />
            </div>
            {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: '8px 22px', borderRadius: 8, background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 13, fontWeight: 650, color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{saving ? 'Assigning…' : 'Assign Task'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
