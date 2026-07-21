/**
 * TaskComposer — single, reusable task-creation form used everywhere we
 * spawn a task: the Tasks page, the patient drawer Tasks tab, the Calendar
 * quick-add, the Team page assign modal, and the Department dashboard
 * assign-to-member flow.
 *
 * Required:
 *   - title (free text)
 *   - type  (singleSelect; OPWDD types filtered out unless the caller asks)
 *   - patient (must pick or be locked-in by the caller; submit blocked otherwise)
 *
 * Optional:
 *   - referral (filtered to the chosen patient's referrals)
 *   - physician (free-form via PhysicianPicker)
 *   - description, due_date, scheduled_date, priority
 *
 * Assignment:
 *   - When the current user has `task.assign`, an "Assign to" dropdown is
 *     shown listing the users they are permitted to assign to (filtered by
 *     `canAssignTo`). Defaults to the current user, or to `defaultAssigneeId`
 *     when supplied.
 *   - When they don't, the assignee is locked to the current user and a
 *     friendly notice is shown instead.
 *   - Callers like the Team / Department flows that want to *pre-target* a
 *     specific user pass `defaultAssigneeId={u.id}` + `lockAssignee`. In that
 *     case the dropdown is replaced by a non-editable chip.
 *
 * Variants:
 *   - `variant="inline"` (default): renders as a green/magenta panel inside
 *     the page (Tasks.jsx, TasksTab.jsx).
 *   - `variant="modal"`: renders wrapped in its own backdrop + modal shell
 *     (Calendar.jsx, Team.jsx, DepartmentDashboard.jsx).
 *
 * Callbacks:
 *   - onCreated(record): record returned by createTaskOptimistic (Airtable
 *     record on success; the optimistic temp record is replaced internally).
 *   - onCancel(): user dismissed the form (also fired when modal backdrop /
 *     Esc closes the dialog).
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { createTaskOptimistic } from '../../store/mutations.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import PhysicianPicker from '../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { isUserOoo, oooOptionSuffix, oooWindowLabel } from '../../utils/outOfOffice.js';

// ── Constants ────────────────────────────────────────────────────────────────
const TASK_TYPES_CORE = [
  'Insurance Barrier', 'Missing Document', 'Auth Needed', 'Disenrollment',
  'Escalation', 'Follow-Up', 'Staffing', 'Scheduling', 'Other',
];
const TASK_TYPES_OPWDD = [
  'OPWDD Outreach', 'OPWDD Missing Document', 'OPWDD Evaluation',
  'OPWDD Submission', 'OPWDD Code 95 Monitoring',
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const PRIORITY_COLORS = {
  Urgent: palette.primaryMagenta.hex,
  High:   palette.accentOrange.hex,
  Normal: palette.accentBlue.hex,
  Low:    hexToRgba(palette.backgroundDark.hex, 0.35),
};

// Mirror of the mapping used elsewhere in the app — keeps task routing
// consistent (assignee's role → route_to_role bucket) so OPS dashboards
// keep slotting tasks into the right queue.
const ROLE_ROUTE_MAP = {
  rol_001: 'Admin',
  rol_002: 'Admin',
  rol_003: 'Intake',
  rol_004: 'Admin',
  rol_005: 'Clinical',
  rol_006: 'Admin',
  rol_007: 'Admin',
};

// ── Component ────────────────────────────────────────────────────────────────
export default function TaskComposer({
  defaultPatient = null,
  defaultReferral = null,
  defaultPhysicianId = null,
  defaultAssigneeId = null,
  defaultScheduledDate = '',
  defaultDueDate = '',
  defaultType = '',
  defaultPriority = 'Normal',
  lockPatient = false,
  lockAssignee = false,
  includeOpwddTypes = false,
  variant = 'inline',
  title = 'New Task',
  onCreated,
  onCancel,
}) {
  const { appUser, appUserId } = useCurrentAppUser();
  const { can, canAssignTo } = usePermissions();
  const canAssign = can(PERMISSION_KEYS.TASK_ASSIGN);

  const storeUsers     = useCareStore((s) => s.users) || {};
  const storePatients  = useCareStore((s) => s.patients) || {};
  const storeReferrals = useCareStore((s) => s.referrals) || {};
  const storePhysicians = useCareStore((s) => s.physicians) || {};

  // ── Form state ──
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType]         = useState(defaultType);
  const [priority, setPriority] = useState(defaultPriority);
  const [dueDate, setDueDate]   = useState(defaultDueDate);
  const [scheduledDate, setScheduledDate] = useState(defaultScheduledDate);

  const [patient, setPatient]       = useState(defaultPatient);
  const [referral, setReferral]     = useState(defaultReferral);
  const [physician, setPhysician]   = useState(() => {
    if (!defaultPhysicianId) return null;
    return Object.values(storePhysicians).find((p) => p.id === defaultPhysicianId) || null;
  });

  const [assigneeId, setAssigneeId] = useState(
    defaultAssigneeId || appUserId || '',
  );
  const [patientSearch, setPatientSearch] = useState('');
  const [showPatientList, setShowPatientList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const patientSearchRef = useRef(null);

  // Keep assignee in sync if the current user resolves after first render
  // (useCurrentAppUser is async on first load — without this the dropdown
  // briefly shows "— Select team member —" until the parent rerenders).
  useEffect(() => {
    if (!defaultAssigneeId && !assigneeId && appUserId) {
      setAssigneeId(appUserId);
    }
  }, [appUserId, defaultAssigneeId, assigneeId]);

  // If the caller passes in a new locked patient (e.g. drawer switches
  // patients), reflect it without forcing a remount.
  useEffect(() => {
    if (defaultPatient && lockPatient) {
      setPatient(defaultPatient);
      setReferral(defaultReferral || null);
    }
  }, [defaultPatient, defaultReferral, lockPatient]);

  // Close patient search dropdown on outside click
  useEffect(() => {
    if (!showPatientList) return;
    const handler = (e) => {
      if (patientSearchRef.current && !patientSearchRef.current.contains(e.target)) {
        setShowPatientList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPatientList]);

  // Esc to close in modal variant
  useEffect(() => {
    if (variant !== 'modal' || !onCancel) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, onCancel]);

  // ── Derived data ──
  const taskTypes = useMemo(() => {
    return includeOpwddTypes
      ? [...TASK_TYPES_CORE, ...TASK_TYPES_OPWDD]
      : TASK_TYPES_CORE;
  }, [includeOpwddTypes]);

  const assignableUsers = useMemo(() => {
    if (!canAssign) return [];
    return Object.values(storeUsers)
      .filter((u) => u.status === 'Active')
      .filter((u) => u.id !== appUserId) // "Myself" is a dedicated top option
      .filter((u) => (canAssignTo ? canAssignTo(u.id) : true))
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
  }, [storeUsers, canAssign, canAssignTo, appUserId]);

  const patientResults = useMemo(() => {
    if (patient) return [];
    const q = patientSearch.trim().toLowerCase();
    const all = Object.values(storePatients).filter((p) => p.id);
    if (q.length < 2) return all.slice(0, 8);
    return all
      .filter((p) => {
        const name = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
        return (
          name.includes(q) ||
          (p.medicaid_number || '').toLowerCase().includes(q) ||
          (p.phone_primary || '').includes(q)
        );
      })
      .slice(0, 10);
  }, [patient, patientSearch, storePatients]);

  const patientReferrals = useMemo(() => {
    if (!patient?.id) return [];
    return Object.values(storeReferrals)
      .filter((r) => r.patient_id === patient.id)
      .sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0));
  }, [patient?.id, storeReferrals]);

  const lockedAssigneeUser = useMemo(() => {
    if (!lockAssignee || !defaultAssigneeId) return null;
    return Object.values(storeUsers).find((u) => u.id === defaultAssigneeId) || null;
  }, [lockAssignee, defaultAssigneeId, storeUsers]);

  const selectedAssigneeUser = useMemo(() => {
    const id = lockAssignee ? defaultAssigneeId : assigneeId;
    if (!id) return null;
    return Object.values(storeUsers).find((u) => u.id === id) || null;
  }, [lockAssignee, defaultAssigneeId, assigneeId, storeUsers]);

  const assigneeIsOoo = isUserOoo(selectedAssigneeUser);

  const canSubmit =
    !!taskTitle.trim() &&
    !!type &&
    !!patient?.id &&
    !saving;

  // ── Handlers ──
  function pickPatient(p) {
    setPatient(p);
    setPatientSearch('');
    setShowPatientList(false);
    setReferral(null);
  }

  function clearPatient() {
    if (lockPatient) return;
    setPatient(null);
    setReferral(null);
    setPatientSearch('');
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const effectiveAssignee = assigneeId || appUserId;
    const assignedUser = Object.values(storeUsers).find((u) => u.id === effectiveAssignee);
    const route_to_role = assignedUser
      ? (ROLE_ROUTE_MAP[assignedUser.role_id] || 'Admin')
      : (ROLE_ROUTE_MAP[appUser?.role_id] || 'Admin');

    const fields = {
      title: taskTitle.trim(),
      type,
      priority,
      status: 'Pending',
      source: 'Manual',
      route_to_role,
      assigned_to_id: effectiveAssignee || undefined,
      patient_id: patient.id,
      ...(referral?.id      ? { referral_id: referral.id }         : {}),
      ...(physician?.id     ? { physician_id: physician.id }       : {}),
      ...(description.trim()? { description: description.trim() } : {}),
      ...(dueDate           ? { due_date: dueDate }                 : {}),
      ...(scheduledDate     ? { scheduled_date: scheduledDate }    : {}),
    };

    try {
      const record = await createTaskOptimistic(fields);
      onCreated?.(record);
    } catch (e) {
      setError(e.message || 'Failed to create task');
      setSaving(false);
    }
  }

  // ── Render: shared body ──
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Title */}
      <Field label="Title" required>
        <input
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="What needs to be done?"
          style={inputStyle}
          autoFocus
        />
      </Field>

      {/* Type pills */}
      <Field label="Type" required>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {taskTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              style={{
                padding: '3px 10px', borderRadius: 16, fontSize: 11.5, fontWeight: 600,
                border: `1px solid ${type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.18)}`,
                background: type === t ? hexToRgba(palette.primaryMagenta.hex, 0.09) : 'transparent',
                color: type === t ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'inherit',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      {/* Patient picker (required) */}
      <Field label="Patient" required>
        {patient ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 8,
              background: hexToRgba(palette.primaryMagenta.hex, 0.06),
              border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
            }}
          >
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>
              {patient.first_name} {patient.last_name}
              {patient.medicaid_number && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                  · {patient.medicaid_number}
                </span>
              )}
            </span>
            {!lockPatient && (
              <button
                type="button"
                onClick={clearPatient}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  color: hexToRgba(palette.backgroundDark.hex, 0.45),
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = palette.primaryMagenta.hex)}
                onMouseLeave={(e) => (e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.45))}
              >
                × Change
              </button>
            )}
          </div>
        ) : (
          <div ref={patientSearchRef} style={{ position: 'relative' }}>
            <input
              value={patientSearch}
              onChange={(e) => { setPatientSearch(e.target.value); setShowPatientList(true); }}
              onFocus={() => setShowPatientList(true)}
              placeholder="Search by name, Medicaid #, or phone…"
              style={inputStyle}
            />
            {showPatientList && patientResults.length > 0 && (
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                  zIndex: 300, background: palette.backgroundLight.hex,
                  borderRadius: 8, border: `1px solid var(--color-border)`,
                  boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
                  maxHeight: 220, overflowY: 'auto',
                }}
              >
                {patientResults.map((p) => (
                  <button
                    key={p._id || p.id}
                    type="button"
                    onMouseDown={() => pickPatient(p)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 12px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12.5, color: palette.backgroundDark.hex,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.05))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontWeight: 600 }}>{p.first_name} {p.last_name}</span>
                    {p.dob && <span style={{ marginLeft: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>DOB {p.dob}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>

      {/* Referral picker (only if patient has referrals) */}
      {patient?.id && patientReferrals.length > 0 && (
        <Field label="Referral" optional>
          <select
            value={referral?.id || ''}
            onChange={(e) => setReferral(patientReferrals.find((r) => r.id === e.target.value) || null)}
            style={inputStyle}
          >
            <option value="">— No specific referral —</option>
            {patientReferrals.map((r) => (
              <option key={r._id || r.id} value={r.id}>
                {r.id}
                {r.current_stage ? ` — ${r.current_stage}` : ''}
                {r.division ? ` (${r.division})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* Physician picker (optional) */}
      <Field label="Physician" optional>
        <PhysicianPicker
          physicianId={physician?.id || null}
          onChange={(phy) => setPhysician(phy)}
          compact
        />
      </Field>

      {/* Priority */}
      <Field label="Priority">
        <div style={{ display: 'flex', gap: 5 }}>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 6,
                fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
                border: `1px solid ${priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
                background: priority === p ? hexToRgba(PRIORITY_COLORS[p], 0.1) : 'transparent',
                color: priority === p ? PRIORITY_COLORS[p] : hexToRgba(palette.backgroundDark.hex, 0.45),
                cursor: 'pointer', transition: 'all 0.1s',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </Field>

      {/* Dates */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Due date" optional style={{ flex: 1 }}>
          <input
            type="date"
            value={dueDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Scheduled date" optional style={{ flex: 1 }}>
          <input
            type="date"
            value={scheduledDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Description */}
      <Field label="Description" optional>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Additional context or steps…"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </Field>

      {/* Assignee */}
      <Field label="Assign to">
        {lockAssignee && lockedAssigneeUser ? (
          <div
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: hexToRgba(palette.accentBlue.hex, 0.07),
              border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.2)}`,
              fontSize: 13, fontWeight: 600, color: palette.accentBlue.hex,
            }}
          >
            {lockedAssigneeUser.first_name} {lockedAssigneeUser.last_name}
            {lockedAssigneeUser.id === appUserId && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, opacity: 0.7 }}>(you)</span>
            )}
            {isUserOoo(lockedAssigneeUser) && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: palette.accentOrange.hex }}>
                · Out of office
              </span>
            )}
          </div>
        ) : canAssign ? (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            style={inputStyle}
          >
            {appUserId ? (
              <option value={appUserId}>
                Myself{appUser ? ` — ${appUser.first_name || ''} ${appUser.last_name || ''}`.trimEnd() : ''}
                {oooOptionSuffix(Object.values(storeUsers).find((u) => u.id === appUserId) || appUser)}
              </option>
            ) : (
              <option value="">— Select team member —</option>
            )}
            {assignableUsers.length > 0 && (
              <optgroup label="Team">
                {assignableUsers.map((u) => (
                  <option key={u._id || u.id} value={u.id}>
                    {u.first_name} {u.last_name}{oooOptionSuffix(u)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          <div
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: hexToRgba(palette.accentGreen.hex, 0.08),
              border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.2)}`,
              fontSize: 13, color: palette.accentGreen.hex, fontWeight: 550,
            }}
          >
            Assigning to you — {appUser?.first_name} {appUser?.last_name}
          </div>
        )}
        {assigneeIsOoo && (
          <p
            data-testid="ooo-assign-warn"
            style={{
              margin: '8px 0 0',
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.4,
              fontWeight: 550,
              color: palette.accentOrange.hex,
              background: hexToRgba(palette.accentOrange.hex, 0.1),
              border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.22)}`,
            }}
          >
            This person is out of office{oooWindowLabel(selectedAssigneeUser) ? ` (${oooWindowLabel(selectedAssigneeUser)})` : ''}. You can still assign — they may not act on it until they return.
          </p>
        )}
      </Field>

      {error && (
        <p style={{ fontSize: 12, color: palette.primaryMagenta.hex }}>{error}</p>
      )}
    </div>
  );

  const footer = (
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      <button
        type="button"
        onClick={onCancel}
        style={{
          flex: 1, padding: '9px 0', borderRadius: 8,
          background: hexToRgba(palette.backgroundDark.hex, 0.06),
          border: 'none', fontSize: 13, fontWeight: 600,
          color: hexToRgba(palette.backgroundDark.hex, 0.6),
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          flex: 2, padding: '9px 0', borderRadius: 8, border: 'none',
          background: canSubmit ? palette.primaryMagenta.hex : hexToRgba(palette.primaryMagenta.hex, 0.3),
          color: palette.backgroundLight.hex,
          fontSize: 13, fontWeight: 650,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}
      >
        {saving ? 'Creating…' : 'Create Task'}
      </button>
    </div>
  );

  // ── Variant wrappers ──
  if (variant === 'modal') {
    return (
      <div
        onClick={(e) => e.target === e.currentTarget && onCancel?.()}
        style={{
          position: 'fixed', inset: 0, zIndex: 9992,
          background: hexToRgba(palette.backgroundDark.hex, 0.45),
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            background: palette.backgroundLight.hex,
            borderRadius: 14, width: '100%', maxWidth: 520,
            maxHeight: '90vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: `0 8px 40px ${hexToRgba(palette.backgroundDark.hex, 0.22)}`,
          }}
        >
          <div
            style={{
              padding: '18px 24px 14px', flexShrink: 0,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: `1px solid var(--color-border)`,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex }}>
              {title}
            </h3>
            <button
              type="button"
              onClick={onCancel}
              style={{
                width: 28, height: 28, borderRadius: 7,
                background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: hexToRgba(palette.backgroundDark.hex, 0.4),
              }}
            >
              <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 6px' }}>
            {body}
          </div>
          <div style={{ padding: '4px 24px 18px', flexShrink: 0 }}>
            {footer}
          </div>
        </div>
      </div>
    );
  }

  // Inline variant
  return (
    <div
      style={{
        padding: '16px 18px', borderRadius: 10, marginBottom: 18,
        border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
        background: hexToRgba(palette.primaryMagenta.hex, 0.03),
      }}
    >
      <p
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: palette.primaryMagenta.hex,
          marginBottom: 12,
        }}
      >
        {title}
      </p>
      {body}
      {footer}
    </div>
  );
}

// ── Style + tiny helpers ────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 11px', borderRadius: 7,
  border: '1px solid var(--color-border)',
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit',
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 650,
  letterSpacing: '0.02em',
  color: hexToRgba(palette.backgroundDark.hex, 0.55),
  marginBottom: 5,
};

function Field({ label, required, optional, children, style }) {
  return (
    <div style={style}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
        {optional && (
          <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 6 }}>
            (optional)
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
