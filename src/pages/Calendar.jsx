import { useState, useMemo, useCallback } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { useCareStore } from '../store/careStore.js';
import { createTaskOptimistic } from '../store/mutations.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import AccessDenied from '../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });

const EVENT_TYPE = { F2F: 'f2f', TASK_DUE: 'task_due', TASK_SCHEDULED: 'task_scheduled' };

const TYPE_STYLES = {
  [EVENT_TYPE.F2F]:            { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex, label: 'F2F Expiration' },
  [EVENT_TYPE.TASK_DUE]:       { bg: hexToRgba(palette.highlightYellow.hex, 0.22), color: '#7A5F00', label: 'Task Due' },
  [EVENT_TYPE.TASK_SCHEDULED]: { bg: hexToRgba(palette.accentGreen.hex, 0.14), color: palette.accentGreen.hex, label: 'Scheduled' },
};

const TASK_TYPES = [
  'Insurance Barrier', 'Missing Document', 'Auth Needed',
  'Disenrollment', 'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other',
];

export default function CalendarPage() {
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const { open: openDrawer } = usePatientDrawer();

  const storeReferrals = useCareStore((s) => s.referrals);
  const storePatients  = useCareStore((s) => s.patients);
  const storeTasks     = useCareStore((s) => s.tasks);
  const hydrated       = useCareStore((s) => s.hydrated);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [addModal, setAddModal]           = useState(null);
  const [view, setView]                   = useState('month');
  const [date, setDate]                   = useState(new Date());

  if (!can(PERMISSION_KEYS.CALENDAR_VIEW)) {
    return <AccessDenied message="You do not have permission to view the calendar." />;
  }

  const patientMap = storePatients;
  const referralMap = storeReferrals;

  const events = useMemo(() => {
    if (!hydrated || !appUserId) return [];
    const result = [];

    Object.values(referralMap).forEach((ref) => {
      if (!ref.f2f_expiration) return;
      const d = new Date(ref.f2f_expiration);
      if (isNaN(d.getTime())) return;
      const patient = patientMap[ref._patientRecordId] ||
        Object.values(patientMap).find((p) => p.id === ref.patient_id);
      const name = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Unknown';
      result.push({
        id: `f2f_${ref._id}`,
        type: EVENT_TYPE.F2F,
        title: `F2F — ${name}`,
        start: d,
        end: d,
        allDay: true,
        patient,
        referral: ref,
      });
    });

    Object.values(storeTasks).forEach((task) => {
      const isOwner = task.assigned_to_id === appUserId || task.created_by_id === appUserId;
      if (!isOwner) return;

      if (task.due_date) {
        const d = new Date(task.due_date);
        if (!isNaN(d.getTime())) {
          const patient = task.patient_id
            ? Object.values(patientMap).find((p) => p.id === task.patient_id)
            : null;
          result.push({
            id: `due_${task._id}`,
            type: EVENT_TYPE.TASK_DUE,
            title: task.title || 'Task',
            start: d,
            end: d,
            allDay: true,
            task,
            patient,
          });
        }
      }

      if (task.scheduled_date) {
        const d = new Date(task.scheduled_date);
        if (!isNaN(d.getTime())) {
          const patient = task.patient_id
            ? Object.values(patientMap).find((p) => p.id === task.patient_id)
            : null;
          result.push({
            id: `sched_${task._id}`,
            type: EVENT_TYPE.TASK_SCHEDULED,
            title: task.title || 'Scheduled',
            start: d,
            end: d,
            allDay: true,
            task,
            patient,
          });
        }
      }
    });

    return result;
  }, [hydrated, appUserId, referralMap, patientMap, storeTasks]);

  const eventPropGetter = useCallback((event) => {
    const style = TYPE_STYLES[event.type] || TYPE_STYLES[EVENT_TYPE.TASK_DUE];
    return {
      style: {
        background: style.bg,
        color: style.color,
        border: 'none',
        borderRadius: 6,
        padding: '2px 7px',
        fontSize: 11.5,
        fontWeight: 600,
        cursor: 'pointer',
        lineHeight: 1.4,
      },
    };
  }, []);

  function handleSelectEvent(event) {
    setSelectedEvent(event);
  }

  function handleSelectSlot(slotInfo) {
    if (!can(PERMISSION_KEYS.TASK_CREATE)) return;
    const d = slotInfo.start instanceof Date ? slotInfo.start : new Date(slotInfo.start);
    setAddModal({ date: d.toISOString().split('T')[0] });
  }

  function openPatientFromEvent(event) {
    if (event.patient) {
      const tab = event.task ? 'tasks' : 'overview';
      openDrawer(event.patient, event.referral || null, tab);
    }
    setSelectedEvent(null);
  }

  const calendarStyle = `
    .rbc-calendar { font-family: inherit; }
    .rbc-toolbar { margin-bottom: 14px; }
    .rbc-toolbar button { border: none; background: ${hexToRgba(palette.backgroundDark.hex, 0.06)}; color: ${palette.backgroundDark.hex}; border-radius: 6px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .rbc-toolbar button:hover { background: ${hexToRgba(palette.backgroundDark.hex, 0.1)}; }
    .rbc-toolbar button.rbc-active { background: ${palette.primaryMagenta.hex}; color: ${palette.backgroundLight.hex}; }
    .rbc-header { border: none !important; padding: 8px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: ${hexToRgba(palette.backgroundDark.hex, 0.4)}; }
    .rbc-month-view, .rbc-time-view { border: none !important; }
    .rbc-month-row { border: none !important; }
    .rbc-day-bg { border: none !important; }
    .rbc-day-bg + .rbc-day-bg { border-left: 1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)} !important; }
    .rbc-month-row + .rbc-month-row { border-top: 1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)} !important; }
    .rbc-off-range-bg { background: ${hexToRgba(palette.backgroundDark.hex, 0.02)} !important; }
    .rbc-today { background: ${hexToRgba(palette.primaryMagenta.hex, 0.04)} !important; }
    .rbc-date-cell { padding: 4px 8px; font-size: 12px; font-weight: 500; color: ${hexToRgba(palette.backgroundDark.hex, 0.55)}; }
    .rbc-date-cell.rbc-now { font-weight: 700; color: ${palette.primaryMagenta.hex}; }
    .rbc-event { margin: 1px 3px; }
    .rbc-event:focus { outline: none; box-shadow: 0 0 0 2px ${hexToRgba(palette.primaryMagenta.hex, 0.3)}; }
    .rbc-show-more { color: ${palette.primaryMagenta.hex}; font-size: 11px; font-weight: 600; padding: 2px 6px; }
    .rbc-row-segment { padding: 0 2px 1px; }
    .rbc-toolbar-label { font-size: 16px; font-weight: 700; color: ${palette.backgroundDark.hex}; }
    .rbc-time-header, .rbc-time-content { border: none !important; }
    .rbc-time-slot { border: none !important; }
    .rbc-timeslot-group { border-bottom: 1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)} !important; }
    .rbc-time-header-content { border: none !important; }
    .rbc-allday-cell { border: none !important; }
    .rbc-header + .rbc-header { border-left: none !important; }
  `;

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{calendarStyle}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Calendar</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            F2F expirations, task due dates, and scheduled callbacks
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Legend */}
          {Object.values(TYPE_STYLES).map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: s.bg, border: `1.5px solid ${s.color}` }} />
              <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 550 }}>{s.label}</span>
            </div>
          ))}
          {can(PERMISSION_KEYS.TASK_CREATE) && (
            <button
              onClick={() => setAddModal({ date: new Date().toISOString().split('T')[0] })}
              style={{
                marginLeft: 8, padding: '8px 16px', borderRadius: 8,
                background: palette.primaryMagenta.hex, border: 'none',
                fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              Add Task
            </button>
          )}
        </div>
      </div>

      {/* Calendar */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <BigCalendar
          localizer={localizer}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={['month', 'week', 'day']}
          selectable={can(PERMISSION_KEYS.TASK_CREATE)}
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          eventPropGetter={eventPropGetter}
          popup
          style={{ height: '100%' }}
          formats={{
            eventTimeRangeFormat: () => '',
          }}
          components={{
            event: CalendarEvent,
          }}
        />
      </div>

      {/* Event detail popover */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          resolveUser={resolveUser}
          onOpenPatient={() => openPatientFromEvent(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {/* Quick add task modal */}
      {addModal && (
        <QuickAddTask
          defaultDate={addModal.date}
          appUserId={appUserId}
          onClose={() => setAddModal(null)}
          onCreated={() => setAddModal(null)}
        />
      )}
    </div>
  );
}

// ── Custom event renderer ────────────────────────────────────────────────────

function CalendarEvent({ event }) {
  const isF2F = event.type === EVENT_TYPE.F2F;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
      {isF2F && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 2v6h6M12 18v-6M9 15h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.title}</span>
    </div>
  );
}

// ── Event detail popover ─────────────────────────────────────────────────────

function EventDetail({ event, resolveUser, onOpenPatient, onClose }) {
  const style = TYPE_STYLES[event.type] || TYPE_STYLES[EVENT_TYPE.TASK_DUE];

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 9990, background: hexToRgba(palette.backgroundDark.hex, 0.3), display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, padding: '20px 24px', width: 360, boxShadow: `0 8px 40px ${hexToRgba(palette.backgroundDark.hex, 0.2)}` }}>
        {/* Type badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 5, background: style.bg, color: style.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {style.label}
          </span>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 10 }}>
          {event.title}
        </h3>

        <div style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.7 }}>
          <p><strong>Date:</strong> {event.start ? format(event.start, 'MMM d, yyyy') : '—'}</p>

          {event.task && (
            <>
              {event.task.description && <p><strong>Details:</strong> {event.task.description}</p>}
              <p><strong>Type:</strong> {event.task.type || '—'}</p>
              <p><strong>Priority:</strong> {event.task.priority || 'Normal'}</p>
              <p><strong>Status:</strong> {event.task.status || '—'}</p>
              {event.task.assigned_to_id && <p><strong>Assigned to:</strong> {resolveUser(event.task.assigned_to_id)}</p>}
            </>
          )}

          {event.referral && event.type === EVENT_TYPE.F2F && (
            <>
              <p><strong>Division:</strong> {event.referral.division || '—'}</p>
              <p><strong>Stage:</strong> {event.referral.current_stage || '—'}</p>
            </>
          )}
        </div>

        {event.patient && (
          <button
            onClick={onOpenPatient}
            style={{
              marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8,
              background: palette.primaryMagenta.hex, border: 'none',
              fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex,
              cursor: 'pointer',
            }}
          >
            Open Patient{event.task ? ' → Tasks' : ''}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Full task creation modal ─────────────────────────────────────────────────

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const PRIORITY_COLORS = {
  Urgent: palette.primaryMagenta.hex,
  High:   palette.accentOrange.hex,
  Normal: palette.accentGreen.hex,
  Low:    hexToRgba(palette.backgroundDark.hex, 0.35),
};
const ROLE_ROUTE_MAP = {
  'rol_003': 'Intake', 'rol_005': 'Clinical', 'rol_006': 'Admin',
  'rol_001': 'Admin', 'rol_002': 'Admin', 'rol_004': 'Admin', 'rol_007': 'Admin',
};

function QuickAddTask({ defaultDate, appUserId, onClose, onCreated }) {
  const { can } = usePermissions();
  const { appUser } = useCurrentAppUser();

  const storeUsers    = useCareStore((s) => s.users);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);

  const canAssign = can(PERMISSION_KEYS.TASK_ASSIGN);

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [type, setType]               = useState('Follow-Up');
  const [priority, setPriority]       = useState('Normal');
  const [dueDate, setDueDate]         = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaultDate || '');
  const [assigneeId, setAssigneeId]   = useState(appUserId || '');
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const activeUsers = useMemo(() => {
    if (!canAssign) return [];
    return Object.values(storeUsers)
      .filter((u) => u.status === 'Active')
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
  }, [storeUsers, canAssign]);

  const patientResults = useMemo(() => {
    if (!patientSearch.trim() || patientSearch.length < 2) return [];
    const q = patientSearch.toLowerCase();
    return Object.values(storePatients)
      .filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [patientSearch, storePatients]);

  const patientReferrals = useMemo(() => {
    if (!selectedPatient) return [];
    return Object.values(storeReferrals)
      .filter((r) => r.patient_id === selectedPatient.id)
      .sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0));
  }, [selectedPatient, storeReferrals]);

  function pickPatient(p) {
    setSelectedPatient(p);
    setPatientSearch(`${p.first_name} ${p.last_name}`);
    setSelectedReferral(null);
  }

  function clearPatient() {
    setSelectedPatient(null);
    setSelectedReferral(null);
    setPatientSearch('');
  }

  function handleSubmit() {
    if (!title.trim() || !type) return;
    setSaving(true);
    setError(null);

    const effectiveAssignee = assigneeId || appUserId;
    const assignedUser = activeUsers.find((u) => u.id === effectiveAssignee);
    const route_to_role = assignedUser
      ? (ROLE_ROUTE_MAP[assignedUser.role_id] || 'Admin')
      : (ROLE_ROUTE_MAP[appUser?.role_id] || 'Admin');

    const fields = {
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      priority,
      route_to_role,
      status: 'Pending',
      source: 'Manual',
      assigned_to_id: effectiveAssignee || undefined,
      patient_id: selectedPatient?.id || undefined,
      referral_id: selectedReferral?.id || undefined,
      due_date: dueDate || undefined,
      scheduled_date: scheduledDate || undefined,
    };

    createTaskOptimistic(fields)
      .then(() => onCreated())
      .catch((err) => { setError(err.message); setSaving(false); });
  }

  const canSubmit = title.trim() && type && !saving;

  const lbl = { fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 };
  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 7,
    border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
    background: hexToRgba(palette.backgroundDark.hex, 0.03),
    fontSize: 13, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit',
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 9992, background: hexToRgba(palette.backgroundDark.hex, 0.45), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: `0 8px 40px ${hexToRgba(palette.backgroundDark.hex, 0.22)}` }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 14px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundDark.hex }}>New Task</h3>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 10px' }}>

          {/* Title */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Title <span style={{ color: palette.primaryMagenta.hex }}>*</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" style={inp} autoFocus />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Description <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>(optional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Additional context or steps…" rows={2} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {/* Type pills */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Type <span style={{ color: palette.primaryMagenta.hex }}>*</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {TASK_TYPES.map((t) => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding: '3px 9px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
                  background: type === t ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'transparent',
                  color: type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                  cursor: 'pointer',
                }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Priority</label>
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              {PRIORITIES.map((p) => (
                <button key={p} onClick={() => setPriority(p)} style={{
                  flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
                  background: priority === p ? hexToRgba(PRIORITY_COLORS[p], 0.1) : 'transparent',
                  color: priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.45),
                  cursor: 'pointer',
                }}>{p}</button>
              ))}
            </div>
          </div>

          {/* Due date + Scheduled date */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Due Date <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>(optional)</span></label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inp} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Scheduled Date <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>(optional)</span></label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={inp} />
            </div>
          </div>

          {/* Assignee */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Assign To</label>
            {canAssign ? (
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={inp}>
                <option value="">— Select team member —</option>
                {activeUsers.map((u) => (
                  <option key={u._id} value={u.id}>
                    {u.first_name} {u.last_name}{u.id === appUserId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ padding: '7px 11px', borderRadius: 7, background: hexToRgba(palette.accentGreen.hex, 0.08), fontSize: 12.5, color: palette.accentGreen.hex, fontWeight: 550 }}>
                Assigned to you — {appUser?.first_name} {appUser?.last_name}
              </div>
            )}
          </div>

          {/* Patient search */}
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <label style={lbl}>Link to Patient <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>(optional)</span></label>
            {selectedPatient ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 7, background: hexToRgba(palette.primaryMagenta.hex, 0.06) }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </span>
                <button onClick={clearPatient} style={{ background: 'none', border: 'none', cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 11, fontWeight: 600 }}>Clear</button>
              </div>
            ) : (
              <input
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search by patient name…"
                style={inp}
              />
            )}
            {!selectedPatient && patientResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: palette.backgroundLight.hex, borderRadius: 8, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`, maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
                {patientResults.map((p) => (
                  <div
                    key={p._id}
                    onClick={() => pickPatient(p)}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: palette.backgroundDark.hex, transition: 'background 0.1s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.05))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontWeight: 600 }}>{p.first_name} {p.last_name}</span>
                    {p.dob && <span style={{ marginLeft: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>DOB: {p.dob}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Referral picker (if patient selected and has referrals) */}
          {selectedPatient && patientReferrals.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Link to Referral <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>(optional)</span></label>
              <select value={selectedReferral?.id || ''} onChange={(e) => setSelectedReferral(patientReferrals.find((r) => r.id === e.target.value) || null)} style={inp}>
                <option value="">— No specific referral —</option>
                {patientReferrals.map((r) => (
                  <option key={r._id} value={r.id}>
                    {r.id} — {r.current_stage} ({r.division})
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px 18px', flexShrink: 0, display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 8,
              background: canSubmit ? palette.primaryMagenta.hex : hexToRgba(palette.primaryMagenta.hex, 0.3),
              border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
