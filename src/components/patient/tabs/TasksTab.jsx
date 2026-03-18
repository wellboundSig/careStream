import { useState, useEffect, useMemo } from 'react';
import { useCareStore } from '../../../store/careStore.js';
import { updateTaskOptimistic, createTaskOptimistic } from '../../../store/mutations.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const ADMIN_ROLE_IDS = ['rol_001', 'rol_002', 'rol_004', 'rol_007'];

const TASK_TYPES = [
  'Insurance Barrier', 'Missing Document', 'Auth Needed',
  'Disenrollment', 'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other',
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const PRIORITY_COLORS = {
  Urgent: palette.primaryMagenta.hex,
  High:   palette.accentOrange.hex,
  Normal: palette.accentBlue.hex,
  Low:    hexToRgba(palette.backgroundDark.hex, 0.35),
};

// Auto-derive route_to_role from assignee's role
const ROLE_ROUTE_MAP = {
  'rol_003': 'Intake',
  'rol_005': 'Clinical',
  'rol_006': 'Admin',
  'rol_001': 'Admin',
  'rol_002': 'Admin',
  'rol_004': 'Admin',
  'rol_007': 'Admin',
};

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function fmtDate(d) {
  if (!d) return null;
  const diff = Math.floor((new Date(d) - Date.now()) / 86400000);
  if (diff < 0) return { label: `Overdue ${Math.abs(diff)}d`, color: palette.primaryMagenta.hex };
  if (diff === 0) return { label: 'Due today', color: palette.accentOrange.hex };
  if (diff <= 7) return { label: `Due in ${diff}d`, color: '#7A5F00' };
  return { label: new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: hexToRgba(palette.backgroundDark.hex, 0.45) };
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

export default function TasksTab({ patient, referral, autoNewTask, onAutoNewTaskConsumed }) {
  const { resolveUser }          = useLookups();
  const { appUser, appUserId }   = useCurrentAppUser();
  const allTasks                 = useCareStore((s) => s.tasks);
  const hydrated                 = useCareStore((s) => s.hydrated);
  const [filter, setFilter]      = useState('open');
  const [confirmId, setConfirmId]= useState(null);
  const [showForm, setShowForm]  = useState(false);

  const isAdmin = ADMIN_ROLE_IDS.includes(appUser?.role_id);

  const tasks = useMemo(() => {
    if (!patient?.id) return [];
    return Object.values(allTasks)
      .filter((t) => t.patient_id === patient.id)
      .sort((a, b) => new Date(a.due_date || '9999') - new Date(b.due_date || '9999'));
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
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ padding: '5px 12px', borderRadius: 6, background: showForm ? hexToRgba(palette.primaryMagenta.hex, 0.12) : palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: showForm ? palette.primaryMagenta.hex : palette.backgroundLight.hex, cursor: 'pointer', transition: 'all 0.15s' }}
        >
          {showForm ? '✕ Cancel' : '+ Task'}
        </button>
      </div>

      {/* Inline new task form */}
      {showForm && (
        <NewTaskForm
          patient={patient}
          referral={referral}
          appUser={appUser}
          appUserId={appUserId}
          isAdmin={isAdmin}
          onCreated={handleTaskCreated}
          onCancel={() => setShowForm(false)}
        />
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
                onRequestComplete={() => setConfirmId(task._id)}
                onConfirmComplete={() => markComplete(task)}
                onCancelComplete={() => setConfirmId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── New Task Form ──────────────────────────────────────────────────────────────
const EMPTY = { type: '', title: '', description: '', priority: 'Normal', due_date: '' };

function NewTaskForm({ patient, referral, appUser, appUserId, isAdmin, onCreated, onCancel }) {
  const [form, setForm]         = useState(EMPTY);
  const [assigneeId, setAssigneeId] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const storeUsers              = useCareStore((s) => s.users);

  const users = useMemo(() => {
    if (!isAdmin) return [];
    return Object.values(storeUsers)
      .filter((u) => u.status === 'Active')
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
  }, [storeUsers, isAdmin]);

  useEffect(() => {
    if (appUserId) setAssigneeId(appUserId);
  }, [appUserId]);

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  function handleSubmit() {
    if (!form.type || !form.title.trim()) return;
    setSaving(true);
    setError(null);

    const effectiveAssignee = assigneeId || appUserId;

    const assignedUser = users.find((u) => u.id === effectiveAssignee);
    const route_to_role = assignedUser
      ? (ROLE_ROUTE_MAP[assignedUser.role_id] || 'Admin')
      : (ROLE_ROUTE_MAP[appUser?.role_id] || 'Admin');

    createTaskOptimistic({
      title:          form.title.trim(),
      description:    form.description.trim() || undefined,
      type:           form.type,
      route_to_role,
      priority:       form.priority,
      status:         'Pending',
      assigned_to_id: effectiveAssignee || undefined,
      patient_id:     patient?.id || undefined,
      referral_id:    referral?._id || undefined,
      due_date:       form.due_date || undefined,
    }).then(() => {
      onCreated();
    }).catch((err) => {
      setError(err.message || 'Failed to create task');
      setSaving(false);
    });
  }

  const canSubmit = form.type && form.title.trim() && !saving;

  return (
    <div style={{
      borderBottom: `1px solid var(--color-border)`,
      background: hexToRgba(palette.primaryMagenta.hex, 0.025),
      padding: '14px 20px 16px',
      flexShrink: 0,
      maxHeight: '60vh',
      overflowY: 'auto',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 12 }}>
        New Task — {patient?.first_name} {patient?.last_name}
      </p>

      {/* Task type pills */}
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Type <span style={{ color: palette.primaryMagenta.hex }}>*</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
          {TASK_TYPES.map((t) => (
            <button key={t} onClick={() => set('type', t)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${form.type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.18)}`,
              background: form.type === t ? hexToRgba(palette.primaryMagenta.hex, 0.09) : 'transparent',
              color: form.type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
              cursor: 'pointer', transition: 'all 0.1s',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Title <span style={{ color: palette.primaryMagenta.hex }}>*</span></label>
        <input
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Brief description of what needs to be done…"
          style={inp}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Description <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>(optional)</span></label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Additional context or steps…"
          rows={2}
          style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      {/* Priority + Due date (side by side) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Priority</label>
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            {PRIORITIES.map((p) => (
              <button key={p} onClick={() => set('priority', p)} style={{
                flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: `1px solid ${form.priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
                background: form.priority === p ? hexToRgba(PRIORITY_COLORS[p], 0.1) : 'transparent',
                color: form.priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.45),
                cursor: 'pointer', transition: 'all 0.1s',
              }}>{p}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Due Date <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>(optional)</span></label>
          <input
            type="date"
            value={form.due_date}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => set('due_date', e.target.value)}
            style={{ ...inp, marginTop: 5 }}
          />
        </div>
      </div>

      {/* Assignee */}
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Assign to</label>
        {isAdmin ? (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            style={{ ...inp, marginTop: 5 }}
          >
            <option value="">— Select team member —</option>
            {users.map((u) => (
              <option key={u._id} value={u.id}>
                {u.first_name} {u.last_name}{u.id === appUserId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <div style={{
            marginTop: 5, padding: '6px 10px', borderRadius: 7,
            background: hexToRgba(palette.accentBlue.hex, 0.07),
            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.2)}`,
            fontSize: 12.5, color: palette.accentBlue.hex, fontWeight: 550,
          }}>
            Assigning to you — {appUser?.first_name} {appUser?.last_name}
          </div>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
            background: canSubmit ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
            color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
            fontSize: 12.5, fontWeight: 650, cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'filter 0.12s',
          }}
          onMouseEnter={(e) => canSubmit && (e.currentTarget.style.filter = 'brightness(1.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
        >
          {saving ? 'Creating…' : 'Create Task'}
        </button>
        <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.06), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────────
function TaskCard({ task, resolveUser, confirmPending, onRequestComplete, onConfirmComplete, onCancelComplete }) {
  const isDone = task.status === 'Completed' || task.status === 'Cancelled';
  const due = fmtDate(task.due_date);
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
      {!isDone && (
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

// ── Style helpers ──────────────────────────────────────────────────────────────
const lbl = {
  fontSize: 11.5, fontWeight: 650,
  color: hexToRgba(palette.backgroundDark.hex, 0.55),
  display: 'block',
};

const inp = {
  width: '100%', boxSizing: 'border-box',
  padding: '7px 10px', borderRadius: 7,
  border: `1px solid var(--color-border)`,
  fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
  background: palette.backgroundLight.hex,
  color: palette.backgroundDark.hex,
  display: 'block',
};
