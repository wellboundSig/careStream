import { useState } from 'react';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

/* ─── Type → hue mapping ───────────────────────────────────────── */
const TYPE_COLORS = {
  'Insurance Barrier': palette.accentOrange.hex,
  'Missing Document':  palette.highlightYellow.hex,
  'Auth Needed':       palette.accentBlue.hex,
  'Escalation':        palette.primaryMagenta.hex,
  'Follow-Up':         palette.accentGreen.hex,
  'Staffing':          palette.accentBlue.hex,
  'Scheduling':        palette.accentGreen.hex,
  'Disenrollment':     palette.accentOrange.hex,
  'Other':             hexToRgba(palette.backgroundDark.hex, 0.4),
};

/* Priority — rendered as a small dot/label, not a heavyweight badge */
const PRIORITY_META = {
  Urgent: { color: palette.primaryMagenta.hex, label: 'Urgent' },
  High:   { color: palette.accentOrange.hex,   label: 'High' },
  Normal: null,
  Low:    null,
};

/* Status colors — used only in the dropdown area, not as a badge */
const STATUS_STYLES = {
  'Pending':     { bg: hexToRgba(palette.highlightYellow.hex, 0.18), text: '#7A5F00' },
  'In Progress': { bg: hexToRgba(palette.accentBlue.hex, 0.14),      text: palette.accentBlue.hex },
  'Completed':   { bg: hexToRgba(palette.accentGreen.hex, 0.14),     text: palette.accentGreen.hex },
  'Cancelled':   { bg: hexToRgba(palette.backgroundDark.hex, 0.07),  text: hexToRgba(palette.backgroundDark.hex, 0.4) },
};

export function taskUrgencyLevel(dueDate) {
  if (!dueDate) return 'none';
  const diff = Math.floor((new Date(dueDate) - Date.now()) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7)  return 'week';
  return 'future';
}

const URGENCY_COLOR = {
  overdue: palette.primaryMagenta.hex,
  today:   palette.accentOrange.hex,
  week:    '#7A5F00',
  future:  hexToRgba(palette.backgroundDark.hex, 0.4),
  none:    hexToRgba(palette.backgroundDark.hex, 0.32),
};

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d    = new Date(dateStr);
  const diff = Math.floor((d - Date.now()) / 86400000);
  if (diff < 0)  return `Overdue ${Math.abs(diff)}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 7)  return `Due in ${diff}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TaskCard({ task, resolveUser, resolvePatient, resolvePatientRecord, onComplete, onStatusChange }) {
  const { open: openPatient } = usePatientDrawer();
  const [expanded, setExpanded]     = useState(false);
  const [completing, setCompleting] = useState(false);

  const urgency      = taskUrgencyLevel(task.due_date);
  const isBlocking   = task.blocks_stage_progression === true || task.blocks_stage_progression === 'true';
  const isDone       = task.status === 'Completed' || task.status === 'Cancelled';
  const isOverdue    = urgency === 'overdue';
  const typeColor    = TYPE_COLORS[task.type] || TYPE_COLORS.Other;
  const priorityMeta = PRIORITY_META[task.priority] ?? null;
  const dueLabel     = formatDue(task.due_date);
  const dueColor     = URGENCY_COLOR[urgency];
  const assignedName = resolveUser ? resolveUser(task.assigned_to_id) : (task.assigned_to_id || null);

  /* Left border: blocking > type color */
  const leftBorder = isBlocking && !isDone
    ? `3px solid ${palette.primaryMagenta.hex}`
    : `3px solid ${hexToRgba(typeColor, 0.55)}`;

  async function handleComplete() {
    if (completing || isDone) return;
    setCompleting(true);
    await onComplete(task);
    setCompleting(false);
  }

  function openPatientTasks() {
    if (!task.patient_id) return;
    const patientObj = resolvePatientRecord?.(task.patient_id)
      ?? { id: task.patient_id, _id: task.patient_id };
    openPatient(
      patientObj,
      task.referral_id ? { _id: task.referral_id, id: task.referral_id, current_stage: '' } : null,
      'tasks'
    );
  }

  return (
    <div style={{
      padding: '11px 14px 11px 16px',
      borderRadius: 9,
      background: palette.backgroundLight.hex,
      borderLeft: leftBorder,
      border: `1px solid var(--color-border)`,
      borderLeftWidth: 3,
      opacity: isDone ? 0.52 : 1,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>

        {/* ── Main content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Row 1: type chip + blocking flag + priority dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: hexToRgba(typeColor, 0.12),
              color: typeColor === palette.highlightYellow.hex ? '#7A5F00' : typeColor,
              letterSpacing: '0.01em',
            }}>
              {task.type || 'Other'}
            </span>

            {isBlocking && !isDone && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                padding: '2px 6px', borderRadius: 4,
                background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                color: palette.primaryMagenta.hex,
                border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.2)}`,
              }}>
                Blocking
              </span>
            )}

            {priorityMeta && !isDone && (
              <span style={{ fontSize: 10, fontWeight: 650, color: priorityMeta.color, display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: priorityMeta.color, display: 'inline-block', flexShrink: 0 }} />
                {priorityMeta.label}
              </span>
            )}

            {task.route_to_role && (
              <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.32), marginLeft: 'auto' }}>
                {task.route_to_role}
              </span>
            )}
          </div>

          {/* Row 2: Title */}
          <p style={{
            fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex,
            lineHeight: 1.35, marginBottom: 6,
            textDecoration: isDone ? 'line-through' : 'none',
          }}>
            {task.title}
          </p>

          {/* Row 3: Meta */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {dueLabel && (
              <span style={{
                fontSize: 11.5, fontWeight: isOverdue ? 650 : 500,
                color: isDone ? hexToRgba(palette.backgroundDark.hex, 0.3) : dueColor,
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                {isOverdue && !isDone && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
                {dueLabel}
              </span>
            )}

            {task.patient_id && (
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <button onClick={openPatientTasks} style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 550, padding: 0, fontFamily: 'inherit' }}>
                  {resolvePatient?.(task.patient_id) || task.patient_id}
                </button>
              </span>
            )}

            {assignedName && (
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                </svg>
                {assignedName}
              </span>
            )}

            {task.source === 'System' && (
              <span style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>System</span>
            )}
          </div>

          {/* Row 4: Description — 1-line clamped */}
          {task.description && (
            <div style={{ marginTop: 6 }}>
              <p style={{
                fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.5,
                display: expanded ? 'block' : '-webkit-box',
                WebkitLineClamp: expanded ? undefined : 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {task.description}
              </p>
              {task.description.length > 72 && (
                <button onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Right column: status top, complete bottom ── */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0, minHeight: 56 }}>

          {/* Status dropdown — top right */}
          <select
            value={task.status}
            onChange={(e) => onStatusChange(task, e.target.value)}
            style={{
              fontSize: 10.5, padding: '3px 6px', borderRadius: 5,
              border: `1px solid var(--color-border)`,
              background: palette.backgroundLight.hex,
              color: hexToRgba(palette.backgroundDark.hex, 0.5),
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            <option>Pending</option>
            <option>In Progress</option>
            <option>Completed</option>
            <option>Cancelled</option>
          </select>

          {/* Mark complete — green text, bottom right */}
          {!isDone && (
            <button
              onClick={handleComplete}
              disabled={completing}
              style={{
                fontSize: 11.5, fontWeight: 600,
                color: completing ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex,
                background: 'none', border: 'none', cursor: completing ? 'not-allowed' : 'pointer',
                padding: 0, fontFamily: 'inherit',
                transition: 'opacity 0.12s',
              }}
            >
              {completing ? 'Saving…' : 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
