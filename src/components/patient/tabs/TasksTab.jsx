import { useState, useEffect } from 'react';
import { getTasksByPatient, updateTask } from '../../../api/tasks.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const STATUS_COLORS = {
  Pending: { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  'In Progress': { bg: hexToRgba(palette.accentBlue.hex, 0.12), text: '#005B84' },
  Completed: { bg: hexToRgba(palette.accentGreen.hex, 0.12), text: '#3A6E00' },
  Cancelled: { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

const PRIORITY_COLORS = {
  Urgent: palette.primaryMagenta.hex,
  High: palette.accentOrange.hex,
  Normal: palette.accentBlue.hex,
  Low: hexToRgba(palette.backgroundDark.hex, 0.3),
};

export default function TasksTab({ patient }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    getTasksByPatient(patient.id)
      .then((records) => setTasks(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patient?.id]);

  async function markComplete(task) {
    try {
      await updateTask(task._id, { status: 'Completed', completed_at: new Date().toISOString() });
      setTasks((prev) => prev.map((t) => t._id === task._id ? { ...t, status: 'Completed' } : t));
    } catch {}
  }

  const displayed = filter === 'open'
    ? tasks.filter((t) => t.status === 'Pending' || t.status === 'In Progress')
    : filter === 'completed'
    ? tasks.filter((t) => t.status === 'Completed')
    : tasks;

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['open', 'Open'], ['completed', 'Done'], ['all', 'All']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: `1px solid var(--color-border)`,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: filter === id ? palette.primaryMagenta.hex : 'none',
                color: filter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                transition: 'all 0.12s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button style={{ padding: '6px 14px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
          + Task
        </button>
      </div>

      {loading ? (
        <LoadingState message="Loading tasks..." size="small" />
      ) : displayed.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '32px 0', fontStyle: 'italic' }}>
          {filter === 'open' ? 'No open tasks.' : 'No tasks in this view.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayed.map((task) => (
            <TaskCard key={task._id} task={task} onComplete={markComplete} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onComplete }) {
  const statusColors = STATUS_COLORS[task.status] || STATUS_COLORS.Pending;
  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.Normal;
  const isBlocking = task.blocks_stage_progression === true || task.blocks_stage_progression === 'true';
  const isCompleted = task.status === 'Completed';

  return (
    <div
      style={{
        padding: '12px 14px', borderRadius: 9,
        border: `1px solid ${isBlocking && !isCompleted ? hexToRgba(palette.primaryMagenta.hex, 0.3) : 'var(--color-border)'}`,
        background: isBlocking && !isCompleted ? hexToRgba(palette.primaryMagenta.hex, 0.03) : palette.backgroundLight.hex,
        opacity: isCompleted ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            {isBlocking && !isCompleted && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex }}>
                BLOCKING
              </span>
            )}
            <span
              style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                background: statusColors.bg, color: statusColors.text,
              }}
            >
              {task.status}
            </span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: priorityColor, display: 'inline-block', flexShrink: 0 }} title={task.priority} />
          </div>
          <p style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex, lineHeight: 1.4, textDecoration: isCompleted ? 'line-through' : 'none' }}>
            {task.title}
          </p>
          {task.description && (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginTop: 4, lineHeight: 1.5 }}>
              {task.description}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            {task.assigned_to_id && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Assigned: {task.assigned_to_id}
              </p>
            )}
            {task.due_date && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Due: {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>
        {!isCompleted && (
          <button
            onClick={() => onComplete(task)}
            style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              background: palette.accentGreen.hex,
              border: 'none',
              color: palette.backgroundLight.hex,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'filter 0.12s',
            }}
            title="Mark complete"
            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 6.5l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
