import { useState, useEffect, useMemo } from 'react';
import { useCareStore } from '../../../store/careStore.js';
import { updateTaskOptimistic } from '../../../store/mutations.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import TaskComposer from '../../tasks/TaskComposer.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import {
  daysUntilCalendarDate,
  fmtCalendarDate,
  parseCalendarDate,
} from '../../../utils/dateFormat.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function isOverdue(dueDate) {
  const diff = daysUntilCalendarDate(dueDate);
  return diff != null && diff < 0;
}

function fmtDue(d) {
  if (!d) return null;
  const diff = daysUntilCalendarDate(d);
  if (diff == null) return null;
  if (diff < 0) return { label: `Overdue ${Math.abs(diff)}d`, color: palette.primaryMagenta.hex };
  if (diff === 0) return { label: 'Due today', color: palette.accentOrange.hex };
  if (diff <= 7) return { label: `Due in ${diff}d`, color: '#7A5F00' };
  return { label: fmtCalendarDate(d, ''), color: hexToRgba(palette.backgroundDark.hex, 0.45) };
}

const PRIORITY_ACCENT = {
  Urgent: palette.primaryMagenta.hex,
  High:   palette.accentOrange.hex,
  Normal: palette.accentBlue.hex,
  Low:    hexToRgba(palette.backgroundDark.hex, 0.3),
};

const TYPE_ACCENT = {
  'Insurance Barrier': palette.accentOrange.hex,
  'Missing Document':  '#7A5F00',
  'Auth Needed':       palette.accentBlue.hex,
  'Escalation':        palette.primaryMagenta.hex,
  'Follow-Up':         palette.accentGreen.hex,
  'Staffing':          palette.accentBlue.hex,
  'Scheduling':        palette.accentGreen.hex,
  'Disenrollment':     palette.accentOrange.hex,
};

export default function TasksTab({ patient, referral, autoNewTask, onAutoNewTaskConsumed, readOnly = false }) {
  const { resolveUser }          = useLookups();
  useCurrentAppUser(); // ensure current user hydrates for TaskComposer
  const allTasks                 = useCareStore((s) => s.tasks);
  const hydrated                 = useCareStore((s) => s.hydrated);
  const [filter, setFilter]      = useState('open');
  const [confirmId, setConfirmId]= useState(null);
  const [showForm, setShowForm]  = useState(false);

  const { can } = usePermissions();
  void can(PERMISSION_KEYS.TASK_ASSIGN); // permission gating moved into TaskComposer

  const tasks = useMemo(() => {
    if (!patient?.id) return [];
    return Object.values(allTasks)
      .filter((t) => t.patient_id === patient.id)
      .sort((a, b) => {
        const da = parseCalendarDate(a.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
        const db = parseCalendarDate(b.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
  }, [allTasks, patient?.id]);

  const loading = !hydrated;

  useEffect(() => {
    if (autoNewTask) {
      setShowForm(true);
      onAutoNewTaskConsumed?.();
    }
  }, [autoNewTask, onAutoNewTaskConsumed]);

  function markComplete(task) {
    setConfirmId(null);
    updateTaskOptimistic(task._id, { status: 'Completed', completed_at: new Date().toISOString() }).catch(() => {});
  }

  function handleTaskCreated() {
    setShowForm(false);
  }

  const open      = tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress');
  const completed = tasks.filter((t) => t.status === 'Completed' || t.status === 'Cancelled');
  const displayed = filter === 'open' ? open : filter === 'done' ? completed : tasks;

  const sorted = [...displayed].sort((a, b) => {
    const aOver = isOverdue(a.due_date) ? 0 : 1;
    const bOver = isOverdue(b.due_date) ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pOrder = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
    return (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <div style={{ padding: '12px 20px 10px', borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[['open', `Open (${open.length})`], ['done', 'Done'], ['all', 'All']].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: filter === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07), color: filter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6), transition: 'all 0.12s' }}>
              {label}
            </button>
          ))}
        </div>
        {!readOnly && (
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ padding: '5px 12px', borderRadius: 6, background: showForm ? hexToRgba(palette.primaryMagenta.hex, 0.12) : palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: showForm ? palette.primaryMagenta.hex : palette.backgroundLight.hex, cursor: 'pointer', transition: 'all 0.15s' }}
        >
          {showForm ? '✕ Cancel' : '+ Task'}
        </button>
        )}
      </div>

      {/* Inline new task form */}
      {showForm && !readOnly && (
        <div style={{ padding: '12px 20px 0' }}>
          <TaskComposer
            variant="inline"
            title={`New Task — ${patient?.first_name || ''} ${patient?.last_name || ''}`.trim()}
            defaultPatient={patient}
            defaultReferral={referral}
            lockPatient
            onCreated={handleTaskCreated}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 32px' }}>
        {loading ? (
          <LoadingState message="Loading tasks..." size="small" />
        ) : sorted.length === 0 ? (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), textAlign: 'center', padding: '32px 0', fontStyle: 'italic' }}>
            {filter === 'open' ? 'No open tasks.' : 'No tasks in this view.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map((task) => (
              <TaskCard
                key={task._id}
                task={task}
                resolveUser={resolveUser}
                confirmPending={confirmId === task._id}
                onRequestComplete={readOnly ? undefined : () => setConfirmId(task._id)}
                onConfirmComplete={readOnly ? undefined : () => markComplete(task)}
                onCancelComplete={readOnly ? undefined : () => setConfirmId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────────
function TaskCard({ task, resolveUser, confirmPending, onRequestComplete, onConfirmComplete, onCancelComplete }) {
  const isDone = task.status === 'Completed' || task.status === 'Cancelled';
  const due = fmtDue(task.due_date);
  const overdue = isOverdue(task.due_date) && !isDone;
  const isBlocking = task.blocks_stage_progression === true || task.blocks_stage_progression === 'true';
  const priorityColor = PRIORITY_ACCENT[task.priority] || PRIORITY_ACCENT.Normal;
  const typeColor = TYPE_ACCENT[task.type] || hexToRgba(palette.backgroundDark.hex, 0.4);
  const assignedName = resolveUser ? resolveUser(task.assigned_to_id) : null;

  return (
    <div style={{
      borderRadius: 10,
      background: palette.backgroundLight.hex,
      borderLeft: `3px solid ${isBlocking && !isDone ? palette.primaryMagenta.hex : overdue ? palette.primaryMagenta.hex : hexToRgba(priorityColor, 0.6)}`,
      padding: '11px 13px',
      opacity: isDone ? 0.6 : 1,
      boxShadow: overdue && !isDone ? `0 0 0 1px ${hexToRgba(palette.primaryMagenta.hex, 0.18)}` : `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
    }}>
      {/* Badges */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
        {isBlocking && !isDone && (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: hexToRgba(palette.primaryMagenta.hex, 0.14), color: palette.primaryMagenta.hex }}>Blocking</span>
        )}
        {task.type && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: hexToRgba(typeColor, 0.12), color: typeColor }}>{task.type}</span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: priorityColor, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{task.priority || 'Normal'}</span>
        </span>
        {task.status && task.status !== 'Pending' && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: hexToRgba(palette.backgroundDark.hex, 0.06), color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            {task.status}
          </span>
        )}
      </div>

      {/* Title */}
      <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.35, marginBottom: 6, textDecoration: isDone ? 'line-through' : 'none' }}>
        {task.title}
      </p>

      {/* Meta */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: confirmPending ? 10 : 0 }}>
        {due && (
          <span style={{ fontSize: 11.5, fontWeight: overdue ? 650 : 500, color: due.color, display: 'flex', alignItems: 'center', gap: 3 }}>
            {overdue && <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}
            {due.label}
          </span>
        )}
        {assignedName && assignedName !== task.assigned_to_id && (
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>→ {assignedName}</span>
        )}
        {task.route_to_role && (
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>{task.route_to_role}</span>
        )}
      </div>

      {/* Confirm to complete */}
      {!isDone && onRequestComplete && (
        <div style={{ marginTop: 8 }}>
          {confirmPending ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6), flex: 1 }}>Mark as complete?</span>
              <button onClick={onConfirmComplete} style={{ padding: '5px 12px', borderRadius: 6, background: palette.accentGreen.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>Confirm</button>
              <button onClick={onCancelComplete} style={{ padding: '5px 10px', borderRadius: 6, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
            </div>
          ) : (
            <button onClick={onRequestComplete} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), transition: 'color 0.12s', fontFamily: 'inherit' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = palette.accentGreen.hex)}
              onMouseLeave={(e) => (e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.4))}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/><path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Mark complete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

