import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAllTasks, updateTask } from '../api/tasks.js';
import { getPatients } from '../api/patients.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { useLookups } from '../hooks/useLookups.js';
import TaskCard, { taskUrgencyLevel } from '../components/tasks/TaskCard.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const URGENCY_ORDER = { overdue: 0, today: 1, week: 2, future: 3, none: 4 };
const PRIORITY_ORDER = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

const TASK_TYPES = ['Insurance Barrier', 'Missing Document', 'Auth Needed', 'Disenrollment', 'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other'];

const SECTIONS = [
  { id: 'overdue', label: 'Overdue',    color: palette.primaryMagenta.hex },
  { id: 'today',   label: 'Due Today',  color: palette.accentOrange.hex },
  { id: 'week',    label: 'This Week',  color: '#7A5F00' },
  { id: 'future',  label: 'Upcoming',   color: hexToRgba(palette.backgroundDark.hex, 0.45) },
  { id: 'none',    label: 'No Due Date',color: hexToRgba(palette.backgroundDark.hex, 0.35) },
];

export default function Tasks() {
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const [allTasks, setAllTasks] = useState([]);
  const [patientNameMap, setPatientNameMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('mine');         // 'mine' | 'all'
  const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'all' | 'done'
  const [typeFilter, setTypeFilter] = useState('');
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setLoading(true);
    getAllTasks()
      .then(async (recs) => {
        const tasks = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setAllTasks(tasks);

        // Resolve patient names for all unique patient_ids in the task list
        const pids = [...new Set(tasks.map((t) => t.patient_id).filter(Boolean))];
        if (pids.length) {
          const formula = `OR(${pids.map((id) => `{id} = "${id}"`).join(',')})`;
          const patients = await getPatients({ filterByFormula: formula }).catch(() => []);
          const nameMap = {};
          patients.forEach((p) => {
            if (p.fields.id) nameMap[p.fields.id] = `${p.fields.first_name || ''} ${p.fields.last_name || ''}`.trim();
          });
          setPatientNameMap(nameMap);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const resolvePatient = useCallback(
    (id) => patientNameMap[id] || null,
    [patientNameMap]
  );

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }

  async function handleComplete(task) {
    try {
      await updateTask(task._id, { status: 'Completed', completed_at: new Date().toISOString() });
      setAllTasks((prev) => prev.map((t) => t._id === task._id ? { ...t, status: 'Completed' } : t));
      showToast('Task marked complete');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleStatusChange(task, newStatus) {
    try {
      await updateTask(task._id, { status: newStatus });
      setAllTasks((prev) => prev.map((t) => t._id === task._id ? { ...t, status: newStatus } : t));
    } catch {}
  }

  const filtered = useMemo(() => {
    let list = allTasks;

    if (mode === 'mine' && appUserId) {
      list = list.filter((t) => t.assigned_to_id === appUserId);
    }
    if (statusFilter === 'open') {
      list = list.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
    } else if (statusFilter === 'done') {
      list = list.filter((t) => t.status === 'Completed' || t.status === 'Cancelled');
    }
    if (typeFilter) {
      list = list.filter((t) => t.type === typeFilter);
    }
    if (blockingOnly) {
      list = list.filter((t) => t.blocks_stage_progression === true || t.blocks_stage_progression === 'true');
    }
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
    [filtered]
  );

  const mineCount = allTasks.filter((t) => appUserId && t.assigned_to_id === appUserId && (t.status === 'Pending' || t.status === 'In Progress')).length;

  if (loading) return <LoadingState message="Loading tasks…" />;

  return (
    <>
      <div style={{ padding: '22px 28px', maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Tasks</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} · {mode === 'mine' ? `assigned to ${appUserName || 'you'}` : 'all users'}
            </p>
          </div>

          {/* Mine / All toggle */}
          <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: `1px solid var(--color-border)` }}>
            <ModeBtn label={`My Tasks${mineCount > 0 ? ` (${mineCount})` : ''}`} active={mode === 'mine'} onClick={() => setMode('mine')} />
            <ModeBtn label="All Tasks" active={mode === 'all'} onClick={() => setMode('all')} />
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 7, padding: '0 10px', height: 34, width: 220 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>

          {/* Status */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[['open', 'Open'], ['all', 'All'], ['done', 'Done']].map(([id, label]) => (
              <FilterBtn key={id} label={label} active={statusFilter === id} onClick={() => setStatusFilter(id)} />
            ))}
          </div>

          {/* Type */}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 7, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, color: typeFilter ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.45), cursor: 'pointer', fontFamily: 'inherit' }}>
            <option value="">All types</option>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Blocking only */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', color: blockingOnly ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55), fontWeight: blockingOnly ? 650 : 400 }}>
            <input type="checkbox" checked={blockingOnly} onChange={(e) => setBlockingOnly(e.target.checked)} style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14 }} />
            Blocking only
          </label>
        </div>

        {/* Task sections */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '52px 0', color: hexToRgba(palette.backgroundDark.hex, 0.35), fontSize: 14, fontStyle: 'italic' }}>
            {mode === 'mine' ? 'No tasks assigned to you.' : 'No tasks match the current filters.'}
          </div>
        ) : (
          SECTIONS.map((section) => {
            const tasks = bySection[section.id];
            if (!tasks?.length) return null;
            return (
              <SectionGroup key={section.id} section={section} tasks={tasks} resolveUser={resolveUser} resolvePatient={resolvePatient} onComplete={handleComplete} onStatusChange={handleStatusChange} />
            );
          })
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

function SectionGroup({ section, tasks, resolveUser, resolvePatient, onComplete, onStatusChange }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: 24 }}>
      <button onClick={() => setCollapsed((c) => !c)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px', marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: section.color }}>{section.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: hexToRgba(section.color === '#7A5F00' ? palette.highlightYellow.hex : section.color, 0.14), color: section.color }}>{tasks.length}</span>
        <span style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.08) }} />
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task) => (
            <TaskCard key={task._id} task={task} resolveUser={resolveUser} resolvePatient={resolvePatient} onComplete={onComplete} onStatusChange={onStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModeBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: '7px 16px', background: active ? palette.primaryMagenta.hex : 'none', color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55), border: 'none', fontSize: 12.5, fontWeight: active ? 650 : 450, cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
}

function FilterBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.06), color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6), fontSize: 12, fontWeight: active ? 650 : 450, cursor: 'pointer', transition: 'all 0.12s' }}>
      {label}
    </button>
  );
}
