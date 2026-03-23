import { useState, useMemo, useCallback } from 'react';
import { useCareStore } from '../store/careStore.js';
import { updateTaskOptimistic } from '../store/mutations.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { useLookups } from '../hooks/useLookups.js';
import TaskCard, { taskUrgencyLevel } from '../components/tasks/TaskCard.jsx';
import { SkeletonRect } from '../components/common/Skeleton.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import AccessDenied from '../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const URGENCY_ORDER   = { overdue: 0, today: 1, week: 2, future: 3, none: 4 };
const PRIORITY_ORDER  = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const TASK_TYPES      = ['Insurance Barrier', 'Missing Document', 'Auth Needed', 'Disenrollment', 'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other'];

const SECTIONS = [
  { id: 'overdue', label: 'Overdue',      color: palette.primaryMagenta.hex, alert: true },
  { id: 'today',   label: 'Due Today',    color: palette.accentOrange.hex,   alert: false },
  { id: 'week',    label: 'This Week',    color: '#7A5F00',                  alert: false },
  { id: 'future',  label: 'Upcoming',     color: hexToRgba(palette.backgroundDark.hex, 0.5), alert: false },
  { id: 'none',    label: 'No Due Date',  color: hexToRgba(palette.backgroundDark.hex, 0.38), alert: false },
];

export default function Tasks() {
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser }            = useLookups();
  const storeTasks    = useCareStore((s) => s.tasks);
  const storePatients = useCareStore((s) => s.patients);
  const hydrated      = useCareStore((s) => s.hydrated);

  const [mode, setMode]                   = useState('mine');
  const [statusFilter, setStatusFilter]   = useState('open');
  const [typeFilter, setTypeFilter]       = useState('');
  const [blockingOnly, setBlockingOnly]   = useState(false);
  const [search, setSearch]               = useState('');
  const [toast, setToast]                 = useState(null);

  const allTasks = useMemo(() => Object.values(storeTasks), [storeTasks]);

  const patientNameMap = useMemo(() => {
    const map = {};
    Object.values(storePatients).forEach((p) => {
      if (p.id) map[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    });
    return map;
  }, [storePatients]);

  const patientRecordMap = useMemo(() => {
    const map = {};
    Object.values(storePatients).forEach((p) => {
      if (p.id) map[p.id] = p;
    });
    return map;
  }, [storePatients]);

  const resolvePatient = useCallback((id) => patientNameMap[id] || null, [patientNameMap]);
  const resolvePatientRecord = useCallback((id) => patientRecordMap[id] || null, [patientRecordMap]);

  const { can } = usePermissions();

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }

  function handleComplete(task) {
    if (!can(PERMISSION_KEYS.TASK_COMPLETE)) return;
    updateTaskOptimistic(task._id, { status: 'Completed', completed_at: new Date().toISOString() })
      .then(() => showToast('Task marked complete'))
      .catch((err) => showToast(err.message, 'error'));
  }

  function handleStatusChange(task, newStatus) {
    updateTaskOptimistic(task._id, { status: newStatus }).catch(() => {});
  }

  const filtered = useMemo(() => {
    let list = allTasks;
    if (mode === 'mine' && appUserId)  list = list.filter((t) => t.assigned_to_id === appUserId);
    if (statusFilter === 'open')       list = list.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
    else if (statusFilter === 'done')  list = list.filter((t) => t.status === 'Completed' || t.status === 'Cancelled');
    if (typeFilter)                    list = list.filter((t) => t.type === typeFilter);
    if (blockingOnly)                  list = list.filter((t) => t.blocks_stage_progression === true || t.blocks_stage_progression === 'true');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.patient_id || '').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const ua = URGENCY_ORDER[taskUrgencyLevel(a.due_date)] ?? 4;
      const ub = URGENCY_ORDER[taskUrgencyLevel(b.due_date)] ?? 4;
      if (ua !== ub) return ua - ub;
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [allTasks, mode, statusFilter, typeFilter, blockingOnly, search, appUserId]);

  const bySection = useMemo(() =>
    SECTIONS.reduce((acc, s) => {
      acc[s.id] = filtered.filter((t) => taskUrgencyLevel(t.due_date) === s.id);
      return acc;
    }, {}),
  [filtered]);

  const mineCount = allTasks.filter((t) =>
    appUserId && t.assigned_to_id === appUserId &&
    (t.status === 'Pending' || t.status === 'In Progress')
  ).length;

  if (!can(PERMISSION_KEYS.TASK_VIEW)) return <AccessDenied message="You do not have permission to view tasks." />;

  return (
    <>
      <div style={{ padding: '24px 28px', maxWidth: 860 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Tasks</h1>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} · {mode === 'mine' ? `assigned to ${appUserName || 'you'}` : 'all users'}
            </p>
          </div>

          {/* Mine / All toggle — visually distinct from filter pills */}
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.03) }}>
            <ScopeBtn label={`My Tasks${mineCount > 0 ? ` (${mineCount})` : ''}`} active={mode === 'mine'} onClick={() => setMode('mine')} />
            <ScopeBtn label="All Tasks" active={mode === 'all'} onClick={() => setMode('all')} />
          </div>
        </div>

        {/* ── Filter bar ── single unified row ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, alignItems: 'center', flexWrap: 'wrap' }}>

          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid var(--color-border)`, borderRadius: 7, padding: '0 10px', height: 33, minWidth: 200, flex: '0 1 220px' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.3)} strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.3)} strokeWidth="2" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>

          {/* Open / All / Done — segmented control */}
          <div style={{ display: 'flex', background: hexToRgba(palette.backgroundDark.hex, 0.05), borderRadius: 7, padding: 2, gap: 2 }}>
            {[['open', 'Open'], ['all', 'All'], ['done', 'Done']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                style={{
                  padding: '4px 13px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: statusFilter === id ? 650 : 450,
                  background: statusFilter === id ? palette.backgroundLight.hex : 'transparent',
                  color: statusFilter === id ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                  boxShadow: statusFilter === id ? `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.1)}` : 'none',
                  transition: 'all 0.1s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Type dropdown */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ height: 33, padding: '0 9px', borderRadius: 7, border: `1px solid var(--color-border)`, background: typeFilter ? hexToRgba(palette.accentBlue.hex, 0.07) : palette.backgroundLight.hex, fontSize: 12.5, color: typeFilter ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', fontFamily: 'inherit', fontWeight: typeFilter ? 600 : 400 }}
          >
            <option value="">All types</option>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Blocking toggle — compact pill */}
          <button
            onClick={() => setBlockingOnly((v) => !v)}
            style={{
              height: 33, padding: '0 12px', borderRadius: 7, border: `1px solid ${blockingOnly ? hexToRgba(palette.primaryMagenta.hex, 0.4) : 'var(--color-border)'}`,
              background: blockingOnly ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'transparent',
              color: blockingOnly ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
              fontSize: 12.5, fontWeight: blockingOnly ? 650 : 400, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'all 0.12s',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: blockingOnly ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.25), flexShrink: 0 }} />
            Blocking
          </button>
        </div>

        {/* ── Task sections ── */}
        {!hydrated ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRect key={i} height={72} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: hexToRgba(palette.backgroundDark.hex, 0.32), fontSize: 14, fontStyle: 'italic' }}>
            {mode === 'mine' ? 'No tasks assigned to you.' : 'No tasks match the current filters.'}
          </div>
        ) : (
          SECTIONS.map((section) => {
            const tasks = bySection[section.id];
            if (!tasks?.length) return null;
            return (
              <SectionGroup
                key={section.id}
                section={section}
                tasks={tasks}
                resolveUser={resolveUser}
                resolvePatient={resolvePatient}
                resolvePatientRecord={resolvePatientRecord}
                onComplete={handleComplete}
                onStatusChange={handleStatusChange}
              />
            );
          })
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.22)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

/* ── Section group ── */
function SectionGroup({ section, tasks, resolveUser, resolvePatient, resolvePatientRecord, onComplete, onStatusChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const isAlert = section.alert; // overdue section

  return (
    <div style={{ marginBottom: 28 }}>

      {/* Section header */}
      {isAlert ? (
        /* Overdue — alert banner */
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', cursor: 'pointer', border: 'none',
            background: hexToRgba(palette.primaryMagenta.hex, 0.08),
            borderLeft: `3px solid ${palette.primaryMagenta.hex}`,
            borderRadius: 7, padding: '9px 14px', marginBottom: 10,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke={palette.primaryMagenta.hex} strokeWidth="2"/>
            <path d="M12 8v4M12 16h.01" stroke={palette.primaryMagenta.hex} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 700, color: palette.primaryMagenta.hex, letterSpacing: '0.03em' }}>
            {tasks.length} Overdue task{tasks.length !== 1 ? 's' : ''} — action required
          </span>
          <span style={{ flex: 1 }} />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke={palette.primaryMagenta.hex} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      ) : (
        /* Standard section header */
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px' }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: section.color }}>
            {section.label}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {tasks.length}
          </span>
          <span style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke={hexToRgba(palette.backgroundDark.hex, 0.3)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              resolveUser={resolveUser}
              resolvePatient={resolvePatient}
              resolvePatientRecord={resolvePatientRecord}
              onComplete={onComplete}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Scope button (Mine / All) ── */
function ScopeBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 12.5,
        background: active ? palette.backgroundDark.hex : 'transparent',
        color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
        fontWeight: active ? 650 : 450,
        transition: 'all 0.12s', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
