import { useState } from 'react';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TYPE_COLORS = {
  'Insurance Barrier': palette.accentOrange.hex,
  'Missing Document':  palette.highlightYellow.hex,
  'Auth Needed':       palette.accentBlue.hex,
  'Escalation':        palette.primaryMagenta.hex,
  'Follow-Up':         palette.accentGreen.hex,
  'Staffing':          palette.accentBlue.hex,
  'Scheduling':        palette.accentGreen.hex,
  'Disenrollment':     palette.accentOrange.hex,
  'Other':             hexToRgba(palette.backgroundDark.hex, 0.45),
};

const PRIORITY_STYLES = {
  Urgent: { bg: hexToRgba(palette.primaryMagenta.hex, 0.18), text: palette.primaryMagenta.hex },
  High:   { bg: hexToRgba(palette.accentOrange.hex, 0.18),   text: palette.accentOrange.hex },
  Normal: { bg: hexToRgba(palette.accentBlue.hex, 0.14),     text: palette.accentBlue.hex },
  Low:    { bg: hexToRgba(palette.backgroundDark.hex, 0.08), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

const STATUS_STYLES = {
  'Pending':     { bg: hexToRgba(palette.highlightYellow.hex, 0.2), text: '#7A5F00' },
  'In Progress': { bg: hexToRgba(palette.accentBlue.hex, 0.16),     text: palette.accentBlue.hex },
  'Completed':   { bg: hexToRgba(palette.accentGreen.hex, 0.16),    text: palette.accentGreen.hex },
  'Cancelled':   { bg: hexToRgba(palette.backgroundDark.hex, 0.08), text: hexToRgba(palette.backgroundDark.hex, 0.4) },
};

export function taskUrgencyLevel(dueDate) {
  if (!dueDate) return 'none';
  const diff = Math.floor((new Date(dueDate) - Date.now()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'future';
}

const URGENCY_COLOR = {
  overdue: palette.primaryMagenta.hex,
  today:   palette.accentOrange.hex,
  week:    '#7A5F00',
  future:  hexToRgba(palette.backgroundDark.hex, 0.4),
  none:    hexToRgba(palette.backgroundDark.hex, 0.35),
};

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const diff = Math.floor((d - Date.now()) / 86400000);
  if (diff < 0) return `Overdue ${Math.abs(diff)}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 7) return `Due in ${diff}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TaskCard({ task, resolveUser, resolvePatient, onComplete, onStatusChange }) {
  const { open: openPatient } = usePatientDrawer();
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);

  const urgency = taskUrgencyLevel(task.due_date);
  const isBlocking = task.blocks_stage_progression === true || task.blocks_stage_progression === 'true';
  const isDone = task.status === 'Completed' || task.status === 'Cancelled';
  const typeColor = TYPE_COLORS[task.type] || TYPE_COLORS.Other;
  const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.Normal;
  const statusStyle = STATUS_STYLES[task.status] || STATUS_STYLES.Pending;
  const dueLabel = formatDue(task.due_date);
  const dueColor = URGENCY_COLOR[urgency];
  const assignedName = resolveUser ? resolveUser(task.assigned_to_id) : (task.assigned_to_id || '—');

  async function handleComplete() {
    if (completing || isDone) return;
    setCompleting(true);
    await onComplete(task);
    setCompleting(false);
  }

  function openPatientTasks() {
    if (!task.patient_id) return;
    openPatient(
      { id: task.patient_id, _id: task.patient_id, division: 'ALF' },
      task.referral_id ? { _id: task.referral_id, id: task.referral_id, current_stage: '' } : null,
      'tasks'
    );
  }

  return (
    <div style={{
      padding: '13px 16px',
      borderRadius: 10,
      background: palette.backgroundLight.hex,
      borderLeft: isBlocking && !isDone ? `3px solid ${palette.primaryMagenta.hex}` : `3px solid ${hexToRgba(typeColor, 0.5)}`,
      opacity: isDone ? 0.6 : 1,
      transition: 'box-shadow 0.12s',
      boxShadow: urgency === 'overdue' && !isDone ? `0 0 0 1px ${hexToRgba(palette.primaryMagenta.hex, 0.2)}` : `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Badges row */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
            {isBlocking && !isDone && (
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4, background: hexToRgba(palette.primaryMagenta.hex, 0.14), color: palette.primaryMagenta.hex }}>
                Blocking
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: hexToRgba(typeColor, 0.14), color: typeColor }}>{task.type || 'Other'}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: priorityStyle.bg, color: priorityStyle.text }}>{task.priority || 'Normal'}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: statusStyle.bg, color: statusStyle.text }}>{task.status}</span>
            {task.route_to_role && (
              <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontWeight: 500 }}>{task.route_to_role}</span>
            )}
          </div>

          {/* Title */}
          <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.35, marginBottom: 4, textDecoration: isDone ? 'line-through' : 'none' }}>
            {task.title}
          </p>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {dueLabel && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: isDone ? hexToRgba(palette.backgroundDark.hex, 0.35) : dueColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                {urgency === 'overdue' && !isDone && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                )}
                {dueLabel}
              </span>
            )}
            {task.patient_id && (
              <button onClick={openPatientTasks} style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 550, padding: 0, fontFamily: 'inherit' }}>
                {resolvePatient?.(task.patient_id) || task.patient_id}
              </button>
            )}
            {task.assigned_to_id && (
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>→ {assignedName}</span>
            )}
            {task.source === 'System' && (
              <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>System</span>
            )}
          </div>

          {/* Description (expandable) */}
          {task.description && (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, display: expanded ? 'block' : '-webkit-box', WebkitLineClamp: expanded ? undefined : 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {task.description}
              </p>
              {task.description.length > 80 && (
                <button onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleComplete}
              disabled={completing}
              title="Mark complete"
              style={{ width: 32, height: 32, borderRadius: 8, background: palette.accentGreen.hex, border: 'none', color: palette.backgroundLight.hex, cursor: completing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: completing ? 0.6 : 1, transition: 'filter 0.12s' }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <select
              value={task.status}
              onChange={(e) => onStatusChange(task, e.target.value)}
              style={{ fontSize: 10.5, padding: '3px 4px', borderRadius: 6, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.6), fontFamily: 'inherit' }}
            >
              <option>Pending</option>
              <option>In Progress</option>
              <option>Completed</option>
              <option>Cancelled</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
