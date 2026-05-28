import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import TaskComposer from '../components/tasks/TaskComposer.jsx';
import AccessDenied from '../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });

const EVENT_TYPE = { F2F: 'f2f', TASK_DUE: 'task_due', TASK_SCHEDULED: 'task_scheduled' };

const TYPE_STYLES = {
  [EVENT_TYPE.F2F]:            { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex, label: 'F2F Expiration' },
  [EVENT_TYPE.TASK_DUE]:       { bg: hexToRgba(palette.highlightYellow.hex, 0.22), color: '#7A5F00', label: 'Task Due' },
  [EVENT_TYPE.TASK_SCHEDULED]: { bg: hexToRgba(palette.accentGreen.hex, 0.14), color: palette.accentGreen.hex, label: 'Scheduled' },
};

function OutlookGate({ onBypass }) {
  const [showBypass, setShowBypass] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.shiftKey && (e.key === 'B' || e.key === 'b')) setShowBypass(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: hexToRgba(palette.accentBlue.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="18" rx="2" stroke={palette.accentBlue.hex} strokeWidth="1.6" />
            <path d="M16 2v4M8 2v4M3 10h18" stroke={palette.accentBlue.hex} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 8 }}>Connect Your Calendar</h2>
        <p style={{ fontSize: 14, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.6, marginBottom: 24 }}>
          Sync your Microsoft Outlook calendar.
        </p>
        <button style={{ padding: '12px 28px', borderRadius: 8, background: '#0078d4', border: 'none', fontSize: 14, fontWeight: 650, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 23 23" fill="none">
            <path d="M1 1h10v10H1z" fill="#f25022"/><path d="M12 1h10v10H12z" fill="#7fba00"/>
            <path d="M1 12h10v10H1z" fill="#00a4ef"/><path d="M12 12h10v10H12z" fill="#ffb900"/>
          </svg>
          Sign in with Microsoft
        </button>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 16 }}>
          This will connect your Outlook calendar to CareStream.
        </p>
        {showBypass && (
          <button onClick={onBypass} style={{ marginTop: 20, padding: '8px 20px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>
            Use local calendar (dev bypass)
          </button>
        )}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const { open: openDrawer } = usePatientDrawer();
  const [calendarBypassed, setCalendarBypassed] = useState(false);

  const storeReferrals = useCareStore((s) => s.referrals);
  const storePatients  = useCareStore((s) => s.patients);
  const storeTasks     = useCareStore((s) => s.tasks);
  const hydrated       = useCareStore((s) => s.hydrated);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [addModal, setAddModal]           = useState(null);
  const [view, setView]                   = useState('month');
  const [date, setDate]                   = useState(new Date());

  const showAccessDenied = !can(PERMISSION_KEYS.CALENDAR_VIEW);
  const showOutlookGate = !showAccessDenied && !calendarBypassed;

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

  if (showAccessDenied) return <AccessDenied message="You do not have permission to view the calendar." />;
  if (showOutlookGate) return <OutlookGate onBypass={() => setCalendarBypassed(true)} />;

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
        <TaskComposer
          variant="modal"
          title="New Task"
          defaultScheduledDate={addModal.date}
          onCancel={() => setAddModal(null)}
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

