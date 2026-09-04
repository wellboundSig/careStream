/**
 * AuthorizationWorkspace — the ONE authorization UI (2026-06 redesign).
 *
 * Rendered by:
 *   - AuthorizationsTab.jsx (patient drawer — variant="drawer")
 *   - StagePanel.jsx        (module-page right panel — variant="panel")
 *
 * Model: ONE Authorizations row per insurance, two staff actions:
 *   - Log a request  (Pending — who asked, what services, from where)
 *   - Record a response (Active / Inactive — per-service payer decisions)
 * Follow-ups live as JSON on the same row. Existing rows are unchanged.
 *   - ALF: NAR / Follow-up needed (→ Denied or Single Case Agreement) / Approved
 *   - SPN: Approved / Partial Approval (note required) / Denied / Balance bill Medicaid
 *
 * Recording an auth response NEVER changes the pipeline stage. ALF "Denied"
 * raises a Conflict flag + a supervisor task; everything else just records
 * (conflict/OPWDD routing is handled by their own modules).
 */

import { useMemo, useState } from 'react';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useCareStore, mergeEntities, removeEntity } from '../../../store/careStore.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { createAuthorization, updateAuthorization, deleteAuthorization } from '../../../api/authorizations.js';
import { recordActivity } from '../../../api/activityLog.js';
import { createNoteOptimistic, createTaskOptimistic, updateReferralOptimistic } from '../../../store/mutations.js';
import { flagConflict } from '../../../utils/conflictFlagging.js';
import { isNoAuthRequired, noAuthRequiredCopy } from '../../../data/policies/authorizationPolicies.js';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { fmtCalendarDate, todayCalendarDate } from '../../../utils/dateFormat.js';
import {
  DIVISION,
  AUDIT_ACTION,
  CONFLICT_REASON,
  CONFLICT_SOURCE_MODULE,
  PAYER_TYPE_STAFF_OPTIONS,
  ORDER_RANK_OPTIONS,
  ORDER_RANK,
  INSURANCE_CATEGORY,
  VERIFICATION_SOURCE_OPTIONS,
  AUTH_UNIT_TYPE,
  AUTH_UNIT_TYPE_OPTIONS,
  AUTH_STATUS,
  AUTH_COVERAGE_STATUS,
  AUTH_COVERAGE_STATUS_OPTIONS,
  AUTH_DECISION,
  authDecisionOptionsForDivision,
  AUTH_FOLLOW_UP_OUTCOME_OPTIONS_ALF,
  AUTH_FOLLOW_UP_TYPE_OPTIONS,
} from '../../../data/eligibilityEnums.js';
import { determineAllowedServicesByDivision } from '../../../data/policies/serviceAvailabilityPolicies.js';
import { useAuthorizationData } from './useAuthorizationData.js';
import { tokens, inputStyle, primaryBtn, secondaryBtn, sectionHeading, cardStyle } from './workspaceStyles.js';

// Decisions that mean "approved with units" (capture date received + limits).
const UNIT_DECISIONS = new Set([AUTH_DECISION.APPROVED, AUTH_DECISION.PARTIAL]);

function safeParse(json, fallback) {
  if (Array.isArray(json) || (json && typeof json === 'object')) return json;
  try { const v = JSON.parse(json); return v ?? fallback; } catch { return fallback; }
}

function newServiceLine(service, { requestOnly = false } = {}) {
  return {
    service,
    decision: requestOnly ? '' : AUTH_DECISION.APPROVED,
    follow_up_outcome: '',     // ALF only, when decision === follow_up_needed
    visit_limit: '',
    unit_type: AUTH_UNIT_TYPE.VISIT,
    approval_received_date: '',
    note: '',
  };
}

function isPendingCoverage(status) {
  return status === AUTH_COVERAGE_STATUS.PENDING;
}

function defaultCoverageStatus(response) {
  if (response?.coverage_status) return response.coverage_status;
  if (!response) return AUTH_COVERAGE_STATUS.PENDING;
  const rollup = (response.auth_status || response.status || '').toString().toLowerCase();
  const lines = safeParse(response.service_lines, []);
  if (rollup === 'pending' || rollup === 'follow_up_needed' || !lines.length) {
    return AUTH_COVERAGE_STATUS.PENDING;
  }
  return AUTH_COVERAGE_STATUS.ACTIVE;
}

function requestIsLogged(response) {
  if (!response) return false;
  return !!(
    response.request_initial_date
    || String(response.request_requested_from || '').trim()
    || response.requested_by_user_id
  );
}

function responseHasDecisions(response) {
  return safeParse(response?.service_lines, []).some((l) => l.decision);
}

function followUpTypeLabel(type) {
  const hit = AUTH_FOLLOW_UP_TYPE_OPTIONS.find((o) => o.value === type);
  return hit?.label || type || 'Follow-up';
}

// Roll the per-service decisions up into the single `auth_status` the module
// queue + legacy consumers read. A Pending coverage status always stays
// pending — requested, waiting — regardless of leftover line decisions.
function rollupAuthStatus(lines, coverageStatus) {
  if (isPendingCoverage(coverageStatus)) return AUTH_STATUS.PENDING;
  if (!lines.length) return AUTH_STATUS.PENDING;
  const decisions = lines.map((l) => l.decision);
  if (decisions.some((d) => d === AUTH_DECISION.FOLLOW_UP_NEEDED)) return AUTH_STATUS.FOLLOW_UP_NEEDED;
  if (decisions.every((d) => d === AUTH_DECISION.NAR)) return AUTH_STATUS.NAR;
  if (decisions.some((d) => d === AUTH_DECISION.APPROVED || d === AUTH_DECISION.PARTIAL)) return AUTH_STATUS.APPROVED;
  if (decisions.some((d) => d === AUTH_DECISION.DENIED)) return AUTH_STATUS.DENIED;
  return AUTH_STATUS.PENDING;
}

function legacyStatusFromRollup(rollup) {
  if (rollup === 'approved') return 'Approved';
  if (rollup === 'denied') return 'Denied';
  return 'Pending';
}

function asUserId(value) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] || null) : value;
}

function userDisplayName(usersById, userId) {
  const id = asUserId(userId);
  if (!id) return null;
  const list = Object.values(usersById || {});
  const u = list.find((x) => x.id === id || x._id === id);
  if (!u) return id;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email || id;
}

function MetaRows({ t, rows }) {
  const visible = (rows || []).filter((r) => r.value);
  if (!visible.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '5px 10px', margin: '8px 0 10px' }}>
      {visible.map((r) => (
        <div key={r.label} style={{ display: 'contents' }}>
          <span style={{ fontSize: t.fontLabel, fontWeight: 700, color: '#737373', paddingTop: 1 }}>{r.label}</span>
          <span style={{ fontSize: t.fontMuted, color: palette.backgroundDark.hex, fontWeight: 550, lineHeight: 1.4 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function fmtRequestStamp(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return String(iso); }
}

export default function AuthorizationWorkspace({
  patient, referral, readOnly = false, variant = 'drawer',
  onInitiateTransition, onSelectedReferralLeftModule,
}) {
  const t = tokens(variant);
  const { can } = usePermissions();
  const { appUser, appUserId } = useCurrentAppUser();
  const storeDepartments = useCareStore((s) => s.departments);
  const storeUsers = useCareStore((s) => s.users);
  const patientRecordId = patient?._id || null;
  const verifierRecordId = appUser?._id || null;
  const [obtaining, setObtaining] = useState(false);
  const [obtainError, setObtainError] = useState(null);

  const division = referral?.division === DIVISION.ALF ? DIVISION.ALF : DIVISION.SPECIAL_NEEDS;
  const { allowed: AUTH_SERVICES } = determineAllowedServicesByDivision({ division });

  const { loading, authorizations, insurances } = useAuthorizationData({
    patient, patientId: patient?.id, referralId: referral?.id,
  });

  const canEdit = !readOnly && can(PERMISSION_KEYS.AUTH_DECIDE);
  const canDeleteResponse = can(PERMISSION_KEYS.AUTH_DELETE_RESPONSE);
  const alreadyObtained = !!referral?.auth_obtained_at;

  // Latest auth response per insurance (rows are pre-sorted newest-first).
  const responseByInsurance = useMemo(() => {
    const map = new Map();
    for (const a of authorizations) {
      const insId = Array.isArray(a.payer_insurance_id) ? a.payer_insurance_id[0] : a.payer_insurance_id;
      if (!insId) continue;
      if (!map.has(insId)) map.set(insId, a);
    }
    return map;
  }, [authorizations]);

  function findSupervisorUserId() {
    const actor = Object.values(storeUsers || {}).find((u) => u.id === appUserId || u._id === appUserId);
    const deptId = actor?.department_id;
    if (!deptId) return null;
    const dept = Object.values(storeDepartments || {}).find((d) => d.id === deptId);
    return dept?.supervisor || null;
  }

  async function handleAuthorizationObtained() {
    if (!canEdit || !referral?._id || obtaining || alreadyObtained) return;
    setObtaining(true);
    setObtainError(null);
    const now = new Date().toISOString();
    const ownerId = referral.intake_owner_id || null;
    const patientName = patient
      ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
      : (referral.patientName || referral.patient_id || 'Patient');

    try {
      // 1) Stamp referral — drives the row icon + drops Auth Pending membership.
      await updateReferralOptimistic(referral._id, {
        auth_obtained_at: now,
        auth_obtained_by_id: appUserId || 'unknown',
      });

      // 2) Notify intake owner (task → realtime toast + Tasks page).
      if (ownerId) {
        createTaskOptimistic({
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: `Authorization obtained — ${patientName}`,
          type: 'Auth Needed',
          status: 'Pending',
          priority: 'Normal',
          source: 'System',
          route_to_role: 'Intake',
          assigned_to_id: ownerId,
          patient_id: patient?.id,
          referral_id: referral.id,
          description: `Authorization has been obtained for ${patientName}. Review the Auth tab / files if needed.`,
          created_at: now,
          updated_at: now,
        }).catch(() => {});
      }

      // 3) Audit trail
      createNoteOptimistic({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        patient_id: patient?.id,
        author_id: appUserId,
        content: `✅ Authorization obtained${ownerId ? ' — intake owner notified' : ''}`,
        created_at: now,
        updated_at: now,
        referral_id: referral.id,
      }).catch(() => {});

      await recordActivity({
        actorUserId: appUserId,
        action: 'Authorization Obtained',
        patientId: patient?.id,
        referralId: referral?.id,
        detail: ownerId
          ? `Authorization obtained — notification sent to intake owner ${ownerId}.`
          : 'Authorization obtained — no intake owner assigned to notify.',
      });

      // Legacy Authorization Pending stage → return to Eligibility Verification.
      if (referral.current_stage === 'Authorization Pending') {
        onInitiateTransition?.(referral, 'Eligibility Verification');
      }

      onSelectedReferralLeftModule?.();
      triggerDataRefresh();
    } catch (err) {
      console.error('[Authorization] Authorization Obtained failed', err);
      setObtainError(err?.message || 'Failed to mark authorization obtained');
    } finally {
      setObtaining(false);
    }
  }

  if (!referral) {
    return <p style={{ padding: 16, fontSize: t.fontBase, color: '#888' }}>No referral selected.</p>;
  }

  return (
    <div data-testid="authorization-workspace" data-variant={variant} style={{ padding: variant === 'panel' ? '14px 12px' : '18px 20px 40px' }}>
      <p style={sectionHeading(t)}>Authorizations</p>

      {alreadyObtained && (
        <p style={{
          marginBottom: t.gap, fontSize: t.fontMuted,
          color: palette.accentGreen.hex, fontWeight: 600,
        }}>
          Authorization obtained {fmtRequestStamp(referral.auth_obtained_at)
            ? `on ${fmtRequestStamp(referral.auth_obtained_at)}`
            : ''}
          {referral.auth_obtained_by_id
            ? ` by ${userDisplayName(storeUsers, referral.auth_obtained_by_id)}`
            : ''}
        </p>
      )}

      {loading && insurances.length === 0 && (
        <p style={{ fontSize: t.fontMuted, color: '#888' }}>Loading…</p>
      )}
      {!loading && insurances.length === 0 && (
        <p style={{ fontSize: t.fontMuted, color: '#888' }}>
          No insurance on file. Add it in Demographics first.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: t.gap }}>
        {insurances.map((ins) => (
          <InsuranceAuthCard
            key={ins._id}
            t={t}
            division={division}
            authServices={AUTH_SERVICES}
            insurance={ins}
            response={responseByInsurance.get(ins._id) || null}
            readOnly={!canEdit}
            canDeleteResponse={canDeleteResponse}
            patient={patient}
            referral={referral}
            patientRecordId={patientRecordId}
            verifierRecordId={verifierRecordId}
            appUserId={appUserId}
            findSupervisorUserId={findSupervisorUserId}
            storeUsers={storeUsers}
          />
        ))}
      </div>

      {/* Pending auth rows created via Get Auth before an insurance was linked */}
      {authorizations.filter((a) => {
        const insId = Array.isArray(a.payer_insurance_id) ? a.payer_insurance_id[0] : a.payer_insurance_id;
        return !insId;
      }).map((orphan) => (
        <PendingAuthBanner
          key={orphan._id}
          t={t}
          response={orphan}
          storeUsers={storeUsers}
          canDeleteResponse={canDeleteResponse}
          patient={patient}
          referral={referral}
          appUserId={appUserId}
        />
      ))}

      {authorizations.length > 0 && canEdit && !alreadyObtained && (
        <div style={{ marginTop: t.sectionGap }}>
          <p style={{ fontSize: t.fontMuted, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8, lineHeight: 1.45 }}>
            Mark obtained when the response is in and any required files are uploaded. This notifies the intake owner.
          </p>
          {obtainError && (
            <p style={{ fontSize: t.fontMuted, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{obtainError}</p>
          )}
          <button
            type="button"
            data-testid="auth-obtained"
            disabled={obtaining}
            onClick={handleAuthorizationObtained}
            style={{
              width: '100%', padding: `${t.btnPadY}px ${t.inputPadX + 4}px`, borderRadius: t.radius - 1,
              border: 'none', background: obtaining ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex,
              color: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 700,
              cursor: obtaining ? 'wait' : 'pointer',
            }}
          >
            {obtaining ? 'Saving…' : 'Authorization obtained'}
          </button>
        </div>
      )}
    </div>
  );
}

function PendingAuthBanner({ t, response, storeUsers, canDeleteResponse, patient, referral, appUserId }) {
  const [deleting, setDeleting] = useState(false);
  const status = (response?.auth_status || response?.status || 'pending').toString().toLowerCase();
  const isPending = status === 'pending' || status === 'follow_up_needed' || status === '';
  if (!isPending) return null;
  const when = fmtRequestStamp(response?.request_initial_date || response?.created_at);
  const who = userDisplayName(storeUsers, response?.requested_by_user_id);

  async function handleDelete() {
    if (!canDeleteResponse || !response?._id || deleting) return;
    if (!window.confirm('Delete this pending authorization request? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteAuthorization(response._id);
      removeEntity('authorizations', response._id);
      await recordActivity({
        actorUserId: appUserId,
        action: 'Authorization Response Deleted',
        patientId: patient?.id,
        referralId: referral?.id,
        detail: 'Deleted orphan pending authorization request.',
        metadata: { authorizationRecId: response._id },
      }).catch(() => {});
      triggerDataRefresh();
    } catch (err) {
      console.error('[Authorization] delete pending failed', err);
      window.alert(err?.message || 'Failed to delete authorization');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ marginTop: t.gap }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <p style={{ fontSize: t.fontMuted, fontWeight: 700, color: '#92400E', marginBottom: 2 }}>
            Pending
          </p>
          <p style={{ fontSize: t.fontMuted, color: '#555' }}>
            {[when ? `Requested ${when}` : null, who ? `by ${who}` : null].filter(Boolean).join(' · ') || 'Waiting on the payer'}
          </p>
        </div>
        {canDeleteResponse && (
          <button
            type="button"
            data-testid="delete-auth-response"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              flexShrink: 0, padding: '4px 8px', border: 'none', background: 'transparent',
              color: palette.primaryMagenta.hex, fontSize: t.fontMuted - 0.5,
              fontWeight: 650, cursor: deleting ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Per-insurance card ───────────────────────────────────────────────────────

function InsuranceAuthCard({
  t, division, authServices, insurance, response, readOnly, canDeleteResponse,
  patient, referral, patientRecordId, verifierRecordId, appUserId, findSupervisorUserId,
  storeUsers,
}) {
  const [mode, setMode] = useState(null); // 'request' | 'response'
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const noAuthRequired = isNoAuthRequired(insurance);

  const initial = useMemo(() => ({
    coverage_status: defaultCoverageStatus(response),
    payer_type: response?.payer_type || insurance.insurance_category || INSURANCE_CATEGORY.MEDICAID,
    payer_order: response?.payer_order || insurance.order_rank || ORDER_RANK.PRIMARY,
    sources: safeParse(response?.sources_checked, []),
    request_initial_date: response?.request_initial_date
      ? String(response.request_initial_date).split('T')[0]
      : (response ? '' : todayCalendarDate()),
    request_requested_from: response?.request_requested_from || '',
    request_docs_sent: response?.request_docs_sent === true || response?.request_docs_sent === 'true',
    lines: safeParse(response?.service_lines, []),
    note: '',
  }), [response, insurance]);

  const rollupStatus = (response?.auth_status || response?.status || '').toString().toLowerCase();
  const storedLinesPreview = safeParse(response?.service_lines, []);
  const storedCoverage = response ? defaultCoverageStatus(response) : null;
  const loggedRequest = requestIsLogged(response);
  const recordedResponse = responseHasDecisions(response);
  const isAwaitingResponse = loggedRequest && !recordedResponse;
  const requestedWhen = fmt(response?.request_initial_date) || fmtRequestStamp(response?.created_at);
  const requestedWho = userDisplayName(storeUsers, response?.requested_by_user_id);
  const decidedWho = userDisplayName(storeUsers, response?.decided_by_user_id);
  const recordedWhen = fmtRequestStamp(response?.updated_at);

  const [form, setForm] = useState(initial);
  const [followUps, setFollowUps] = useState(() => safeParse(response?.follow_ups, []));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const requestOnly = mode === 'request';
  const editing = !!mode;
  const hasLoggedRequest = loggedRequest;

  function startRequest() {
    setForm({
      ...initial,
      coverage_status: AUTH_COVERAGE_STATUS.PENDING,
      request_initial_date: initial.request_initial_date || todayCalendarDate(),
    });
    setFollowUps(safeParse(response?.follow_ups, []));
    setError(null);
    setMode('request');
  }

  function startResponse() {
    setForm({
      ...initial,
      coverage_status: isPendingCoverage(initial.coverage_status)
        ? AUTH_COVERAGE_STATUS.ACTIVE
        : (initial.coverage_status || AUTH_COVERAGE_STATUS.ACTIVE),
      lines: initial.lines.map((l) => (l.decision ? l : { ...l, decision: AUTH_DECISION.APPROVED })),
    });
    setFollowUps(safeParse(response?.follow_ups, []));
    setError(null);
    setMode('response');
  }

  function addLine(service) {
    if (!service) return;
    setForm((f) => ({ ...f, lines: [...f.lines, newServiceLine(service, { requestOnly: mode === 'request' })] }));
  }

  function setCoverageStatus(value) {
    setForm((f) => ({ ...f, coverage_status: value }));
  }
  function updateLine(idx, patch) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  }
  function removeLine(idx) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }
  function toggleSource(value) {
    setForm((f) => ({ ...f, sources: f.sources.includes(value) ? f.sources.filter((s) => s !== value) : [...f.sources, value] }));
  }

  function validate() {
    if (requestOnly) {
      if (!form.request_initial_date) return 'Enter the date the authorization was requested.';
      if (!String(form.request_requested_from || '').trim()) return 'Enter who the authorization was requested from.';
      if (!form.lines.length) return 'Add at least one requested service.';
      return null;
    }
    for (const l of form.lines) {
      if (division === DIVISION.ALF && l.decision === AUTH_DECISION.FOLLOW_UP_NEEDED && !l.follow_up_outcome) {
        return `Choose a follow-up outcome (Denied or Single Case Agreement) for ${l.service}.`;
      }
      if (l.decision === AUTH_DECISION.PARTIAL && !String(l.note || '').trim()) {
        return `A note is required for the Partial Approval on ${l.service}.`;
      }
      if (UNIT_DECISIONS.has(l.decision) && !l.approval_received_date) {
        return `Enter the date approval was received for ${l.service}.`;
      }
    }
    return null;
  }

  async function handleDeleteResponse() {
    if (!canDeleteResponse || !response?._id || deleting) return;
    const payerName = insurance.payer_display_name || 'this payer';
    const kind = isAwaitingResponse ? 'authorization request' : 'authorization response';
    if (!window.confirm(`Delete the ${kind} for ${payerName}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAuthorization(response._id);
      removeEntity('authorizations', response._id);
      await recordActivity({
        actorUserId: appUserId,
        action: 'Authorization Response Deleted',
        patientId: patient?.id,
        referralId: referral?.id,
        detail: `Deleted auth response for ${payerName}.`,
        metadata: { authorizationRecId: response._id, payerInsuranceId: insurance._id },
      }).catch(() => {});
      setMode(null);
      triggerDataRefresh();
    } catch (err) {
      setError(err?.message || 'Failed to delete authorization');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (noAuthRequired || isNoAuthRequired(form.payer_type)) {
      setError('This payer does not require authorization. Responses cannot be recorded for it.');
      return;
    }
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true); setError(null);

    const rollup = rollupAuthStatus(form.lines, form.coverage_status);
    const payerName = insurance.payer_display_name || '';
    const cleanLines = form.lines.map((l) => {
      if (requestOnly) return { service: l.service };
      return {
        service: l.service,
        decision: l.decision,
        ...(l.follow_up_outcome ? { follow_up_outcome: l.follow_up_outcome } : {}),
        ...(l.visit_limit !== '' && l.visit_limit != null ? { visit_limit: Number(l.visit_limit) } : {}),
        unit_type: l.unit_type,
        ...(l.approval_received_date ? { approval_received_date: l.approval_received_date } : {}),
        ...(String(l.note || '').trim() ? { note: l.note.trim() } : {}),
      };
    });

    const prevReq = response?.request_initial_date
      ? String(response.request_initial_date).split('T')[0]
      : '';
    const nextReq = form.request_initial_date || '';
    const fields = {
      referral_id: referral.id,
      patient_id: patientRecordId || undefined,
      payer_insurance_id: insurance._id,
      plan_name: payerName,
      coverage_status: requestOnly ? AUTH_COVERAGE_STATUS.PENDING : form.coverage_status,
      payer_type: form.payer_type,
      payer_order: form.payer_order,
      sources_checked: JSON.stringify(form.sources || []),
      request_initial_date: form.request_initial_date || undefined,
      request_requested_from: form.request_requested_from.trim() || undefined,
      request_docs_sent: form.request_docs_sent ? true : null,
      service_lines: JSON.stringify(cleanLines),
      follow_ups: JSON.stringify(followUps || []),
      auth_status: rollup,
      status: legacyStatusFromRollup(rollup),
      ...(String(form.note || '').trim() ? { notes: form.note.trim() } : {}),
      decided_by_user_id: requestOnly ? undefined : (verifierRecordId || undefined),
      // Stamp requester on first save, or when the request date changes.
      ...(!response?._id || (nextReq && nextReq !== prevReq)
        ? { requested_by_user_id: appUserId || undefined }
        : (response?.requested_by_user_id
          ? { requested_by_user_id: response.requested_by_user_id }
          : {})),
      updated_at: new Date().toISOString(),
    };

    try {
      let recId = response?._id || null;
      if (recId) {
        await updateAuthorization(recId, fields);
        mergeEntities('authorizations', { [recId]: { ...response, ...fields, payer_insurance_id: [insurance._id] } });
      } else {
        const created = await createAuthorization({
          id: `auth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          created_at: new Date().toISOString(),
          ...fields,
        });
        recId = created.id;
        mergeEntities('authorizations', { [created.id]: { _id: created.id, ...created.fields } });
      }

      // Free-text note → also write to the Notes table so it shows in
      // Notes/Timeline (categories were removed per spec).
      if (String(form.note || '').trim() && patient?.id) {
        createNoteOptimistic({
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          patient_id: patient.id,
          author_id: appUserId,
          content: `[Authorization · ${payerName}] ${form.note.trim()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(referral?.id ? { referral_id: referral.id } : {}),
        }).catch(() => {});
      }

      // ALF "Denied" side effects: raise a Conflict flag + a supervisor task.
      // No stage change — conflict routing lives in the Conflict module.
      const deniedAlf = !requestOnly && division === DIVISION.ALF && form.lines.filter(
        (l) => l.decision === AUTH_DECISION.FOLLOW_UP_NEEDED && l.follow_up_outcome === AUTH_DECISION.DENIED,
      );
      if (deniedAlf && deniedAlf.length) {
        const deniedServices = deniedAlf.map((l) => l.service).join(', ');
        await flagConflict({
          referral,
          referralCustomId: referral.id,
          actorUserId: appUserId,
          patientCustomId: patient?.id,
          sourceModule: CONFLICT_SOURCE_MODULE.AUTHORIZATION,
          category: CONFLICT_REASON.AUTH_DENIED,
          severity: 'High',
          description: `Auth denied (ALF) for ${payerName}: ${deniedServices}.`,
        }).catch(() => {});
        const supId = findSupervisorUserId();
        createTaskOptimistic({
          title: `Auth denied — supervisor review (${payerName})`,
          type: 'Auth Needed',
          status: 'Pending',
          priority: 'High',
          source: 'System',
          route_to_role: 'Admin',
          ...(supId ? { assigned_to_id: supId } : {}),
          patient_id: patient?.id,
          ...(referral?.id ? { referral_id: referral.id } : {}),
          description: `ALF authorization denied for ${deniedServices} (${payerName}). Supervisor notified for review.`,
        });
      }

      const requestedFrom = form.request_requested_from.trim();
      await recordActivity({
        actorUserId: appUserId,
        action: requestOnly ? AUDIT_ACTION.AUTH_REQUESTED
          : rollup === 'denied' ? AUDIT_ACTION.AUTH_DENIED
          : rollup === 'approved' ? AUDIT_ACTION.AUTH_APPROVED
          : AUDIT_ACTION.AUTH_FOLLOW_UP_SCHEDULED,
        patientId: patient?.id,
        referralId: referral?.id,
        detail: requestOnly
          ? `Auth requested for ${payerName}${requestedFrom ? ` from ${requestedFrom}` : ''} (${cleanLines.map((l) => l.service).join(', ') || 'no services'}).`
          : `Auth response recorded for ${payerName} (${rollup}).`,
        metadata: {
          payerInsuranceId: insurance._id,
          rollup,
          coverageStatus: form.coverage_status,
          requestedFrom: requestedFrom || null,
          services: cleanLines.map((l) => l.decision ? `${l.service}:${l.decision}` : l.service),
        },
      }).catch(() => {});

      setMode(null);
      setSaving(false);
      triggerDataRefresh();
    } catch (err) {
      setError(err.message || 'Save failed');
      setSaving(false);
    }
  }

  function logFollowUp(entry) {
    setFollowUps((prev) => [...prev, entry]);
  }

  const usedServices = new Set(form.lines.map((l) => l.service));
  const remainingServices = authServices.filter((s) => !usedServices.has(s));
  const storedLines = safeParse(response?.service_lines, []);
  const storedFollowUps = safeParse(response?.follow_ups, []);

  const requestMeta = [
    { label: 'Logged by', value: requestedWho },
    { label: 'When', value: requestedWhen },
    { label: 'From', value: response?.request_requested_from || null },
    {
      label: 'Docs',
      value: loggedRequest
        ? (response?.request_docs_sent === true || response?.request_docs_sent === 'true' ? 'Sent' : 'Not sent')
        : null,
    },
    {
      label: 'Services',
      value: storedLinesPreview.length && !recordedResponse
        ? storedLinesPreview.map((l) => l.service).filter(Boolean).join(', ')
        : null,
    },
  ];
  const responseMeta = recordedResponse ? [
    { label: 'Recorded by', value: decidedWho },
    { label: 'Recorded', value: recordedWhen && recordedWhen !== requestedWhen ? recordedWhen : null },
  ] : [];

  return (
    <div data-testid="auth-insurance-card" style={cardStyle(t)}>
      {/* Header */}
      <div style={{ padding: `${t.cardPadY}px ${t.cardPadX}px 0` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: t.fontBase + 0.5, fontWeight: 650, color: palette.backgroundDark.hex }}>
              {insurance.payer_display_name || 'Unnamed payer'}
            </p>
            <p style={{ fontSize: t.fontMuted, color: '#666' }}>
              {[insurance.insurance_category, insurance.order_rank, insurance.member_id && `Member ${insurance.member_id}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          {noAuthRequired ? (
            <span style={{ fontSize: t.fontMuted - 0.5, fontWeight: 650, padding: '2px 8px', borderRadius: 4, background: '#DBEAFE', color: '#1D4ED8', flexShrink: 0 }}>
              No auth required
            </span>
          ) : isAwaitingResponse ? (
            <span style={{ fontSize: t.fontMuted - 0.5, fontWeight: 650, padding: '2px 8px', borderRadius: 4, background: '#FEF3C7', color: '#92400E', flexShrink: 0 }}>
              Pending
            </span>
          ) : recordedResponse ? (
            <span style={{ fontSize: t.fontMuted - 0.5, fontWeight: 650, padding: '2px 8px', borderRadius: 4, background: storedCoverage === AUTH_COVERAGE_STATUS.INACTIVE ? '#E5E5E5' : '#DCFCE7', color: storedCoverage === AUTH_COVERAGE_STATUS.INACTIVE ? '#666' : '#15803d', flexShrink: 0 }}>
              {storedCoverage === AUTH_COVERAGE_STATUS.INACTIVE ? 'Inactive' : (rollupStatus === 'approved' || rollupStatus === 'nar' ? 'Responded' : 'Active')}
            </span>
          ) : null}
        </div>
      </div>

      {/* Collapsed summary */}
      {!editing && (
        <div style={{ padding: `8px ${t.cardPadX}px ${t.cardPadY}px`, fontSize: t.fontMuted }}>
          {noAuthRequired && (
            <p style={{ color: '#555', marginBottom: 8, lineHeight: 1.4 }}>
              {noAuthRequiredCopy(insurance)}
            </p>
          )}
          {!noAuthRequired && (loggedRequest || recordedResponse) && (
            <MetaRows t={t} rows={[...requestMeta, ...responseMeta]} />
          )}
          {storedLines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: storedFollowUps.length ? 10 : 0 }}>
              {storedLines.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: palette.backgroundDark.hex, fontWeight: 600 }}>{l.service}</span>
                  <span style={{ color: '#666' }}>
                    {decisionLabel(l)}
                    {l.visit_limit ? ` · ${l.visit_limit} ${l.unit_type || 'visit'}` : ''}
                    {l.approval_received_date ? ` · recd ${fmt(l.approval_received_date)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(isAwaitingResponse || storedFollowUps.length > 0) && (
            <div style={{ marginTop: storedLines.length ? 2 : 0, marginBottom: 4 }}>
              <p style={{ fontSize: t.fontLabel, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                Follow-ups
              </p>
              {storedFollowUps.length === 0 ? (
                <p style={{ color: '#888' }}>None yet. Use Update request to add one.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {storedFollowUps.map((f, i) => (
                    <p key={i} style={{ color: '#555', lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 650 }}>{fmt(f.date)}</span>
                      {`  ${followUpTypeLabel(f.type)}`}
                      {f.actions_taken ? `  ${f.actions_taken}` : ''}
                      {f.notes ? `  ${f.notes}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {error && (
            <p style={{ color: palette.primaryMagenta.hex, marginTop: 6, fontSize: t.fontMuted - 0.5 }}>{error}</p>
          )}
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {!readOnly && !noAuthRequired && !recordedResponse && (
              <button
                type="button"
                onClick={startRequest}
                data-testid="log-auth-request"
                style={{
                  padding: `${Math.max(4, t.inputPadY - 1)}px ${t.inputPadX + 2}px`, borderRadius: 5,
                  border: 'none', background: palette.accentOrange.hex,
                  color: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 650,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {loggedRequest ? 'Update request' : 'Log a request'}
              </button>
            )}
            {!readOnly && !noAuthRequired && (
              <button
                type="button"
                onClick={startResponse}
                data-testid="record-auth-response"
                style={{
                  padding: `${Math.max(4, t.inputPadY - 1)}px ${t.inputPadX + 2}px`, borderRadius: 5,
                  border: 'none', background: palette.accentGreen.hex,
                  color: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 650,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {recordedResponse ? 'Update response' : 'Record a response'}
              </button>
            )}
            {canDeleteResponse && response?._id && (loggedRequest || recordedResponse) && (
              <button
                type="button"
                data-testid="delete-auth-response"
                onClick={handleDeleteResponse}
                disabled={deleting}
                style={{
                  padding: `${Math.max(4, t.inputPadY - 1)}px ${t.inputPadX + 2}px`, borderRadius: 5, border: 'none',
                  background: 'transparent',
                  color: palette.primaryMagenta.hex, fontSize: t.fontMuted, fontWeight: 650,
                  cursor: deleting ? 'wait' : 'pointer', fontFamily: 'inherit',
                }}
              >
                {deleting ? 'Deleting…' : isAwaitingResponse ? 'Delete request' : 'Delete response'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div style={{ padding: `8px ${t.cardPadX}px ${t.cardPadY}px` }}>
          <p style={{ fontSize: t.fontMuted, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 10 }}>
            {requestOnly
              ? (loggedRequest ? 'Update request' : 'Log request')
              : (recordedResponse ? 'Update response' : 'Record response')}
          </p>

          {requestOnly ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Date requested">
                  <input type="date" value={form.request_initial_date} onChange={(e) => set({ request_initial_date: e.target.value })} style={inputStyle(t)} />
                </Field>
                <Field t={t} label="Requested from">
                  <input type="text" value={form.request_requested_from} onChange={(e) => set({ request_requested_from: e.target.value })} style={inputStyle(t)} placeholder="Payer / portal / contact" />
                </Field>
              </div>
              <label style={{ fontSize: t.fontBase - 0.5, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', margin: '2px 0 10px' }}>
                <input type="checkbox" checked={form.request_docs_sent} onChange={(e) => set({ request_docs_sent: e.target.checked })} />
                <span>Sent requested documentation</span>
              </label>
            </>
          ) : (
            <>
              {hasLoggedRequest && (
                <MetaRows t={t} rows={requestMeta} />
              )}
              <Field t={t} label="Coverage status">
                <select data-testid="auth-coverage-status" value={form.coverage_status} onChange={(e) => setCoverageStatus(e.target.value)} style={inputStyle(t)}>
                  {AUTH_COVERAGE_STATUS_OPTIONS
                    .filter((o) => o.value !== AUTH_COVERAGE_STATUS.PENDING)
                    .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field t={t} label="Payer Type (staff-confirmed)">
                <select value={form.payer_type} onChange={(e) => set({ payer_type: e.target.value })} style={inputStyle(t)}>
                  {PAYER_TYPE_STAFF_OPTIONS
                    .filter((o) => o.value !== INSURANCE_CATEGORY.MEDICARE)
                    .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field t={t} label="Payer Order">
                <select value={form.payer_order} onChange={(e) => set({ payer_order: e.target.value })} style={inputStyle(t)}>
                  {ORDER_RANK_OPTIONS.filter((o) => o.value !== ORDER_RANK.UNKNOWN).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field t={t} label="Source(s) checked">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {VERIFICATION_SOURCE_OPTIONS.map((s) => (
                    <label key={s.value} style={{ fontSize: t.fontBase - 0.5, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.sources.includes(s.value)} onChange={() => toggleSource(s.value)} />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}

          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: t.fontLabel, fontWeight: 700, color: '#555', marginBottom: 6 }}>
              {requestOnly ? 'Services requested' : 'Service decisions'}
            </p>
            {form.lines.map((line, idx) => (
              <ServiceLineRow
                key={idx}
                t={t}
                division={division}
                line={line}
                requestOnly={requestOnly}
                onChange={(patch) => updateLine(idx, patch)}
                onRemove={() => removeLine(idx)}
              />
            ))}
            {remainingServices.length > 0 && (
              <select
                value=""
                data-testid="add-service-line"
                onChange={(e) => { addLine(e.target.value); e.target.value = ''; }}
                style={{ ...inputStyle(t), marginTop: 4 }}
              >
                <option value="">{requestOnly ? '+ Add a requested service…' : '+ Add a service…'}</option>
                {remainingServices.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>

          <FollowUpLog t={t} followUps={followUps} onLog={logFollowUp} />

          <Field t={t} label="Note (also added to Notes)">
            <textarea rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} style={{ ...inputStyle(t), resize: 'vertical' }} placeholder={requestOnly ? 'Note about this request…' : 'Note about this response…'} />
          </Field>

          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <button onClick={() => setMode(null)} style={secondaryBtn(t)}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              data-testid={requestOnly ? 'save-auth-request' : 'save-auth-response'}
              style={primaryBtn(t, { disabled: saving, color: requestOnly ? palette.accentOrange.hex : palette.accentGreen.hex })}
            >
              {saving ? 'Saving…' : requestOnly ? 'Save request' : 'Save response'}
            </button>
            {canDeleteResponse && response?._id && (
              <button
                type="button"
                data-testid="delete-auth-response-edit"
                onClick={handleDeleteResponse}
                disabled={deleting}
                style={{
                  ...secondaryBtn(t),
                  color: palette.primaryMagenta.hex,
                  background: hexToRgba(palette.primaryMagenta.hex, 0.08),
                }}
              >
                {deleting ? 'Deleting…' : requestOnly ? 'Delete request' : 'Delete response'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceLineRow({ t, division, line, onChange, onRemove, requestOnly = false }) {
  const decisionOptions = authDecisionOptionsForDivision(division);
  const showUnits = UNIT_DECISIONS.has(line.decision);
  const isAlfFollowUp = division === DIVISION.ALF && line.decision === AUTH_DECISION.FOLLOW_UP_NEEDED;
  return (
    <div data-testid="service-line" style={{ background: '#F4F4F5', borderRadius: 6, padding: `${t.inputPadY}px ${t.inputPadX}px`, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: requestOnly ? 0 : 6 }}>
        <span style={{ fontSize: t.fontBase, fontWeight: 700, color: palette.backgroundDark.hex }}>
          {line.service}
        </span>
        <button onClick={onRemove} title="Remove service" style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      {requestOnly ? null : (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field t={t} label="Decision">
          <select value={line.decision} onChange={(e) => onChange({ decision: e.target.value, follow_up_outcome: '' })} style={inputStyle(t)}>
            {decisionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {isAlfFollowUp && (
          <Field t={t} label="Follow-up outcome">
            <select value={line.follow_up_outcome} onChange={(e) => onChange({ follow_up_outcome: e.target.value })} style={inputStyle(t)}>
              <option value="">Select…</option>
              {AUTH_FOLLOW_UP_OUTCOME_OPTIONS_ALF.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      {showUnits && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field t={t} label="Visit / Unit limit">
              <input type="number" min="0" value={line.visit_limit} onChange={(e) => onChange({ visit_limit: e.target.value })} style={inputStyle(t)} placeholder="e.g. 30" />
            </Field>
            <Field t={t} label="Unit type">
              <select value={line.unit_type} onChange={(e) => onChange({ unit_type: e.target.value })} style={inputStyle(t)}>
                {AUTH_UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <Field t={t} label="Date approval received">
            <input type="date" value={line.approval_received_date} max={todayCalendarDate()} onChange={(e) => onChange({ approval_received_date: e.target.value })} style={inputStyle(t)} />
          </Field>
        </>
      )}
      {(line.decision === AUTH_DECISION.PARTIAL || line.decision === AUTH_DECISION.DENIED) && (
        <Field t={t} label={line.decision === AUTH_DECISION.PARTIAL ? 'Note (required for Partial)' : 'Note'}>
          <textarea rows={2} value={line.note} onChange={(e) => onChange({ note: e.target.value })} style={{ ...inputStyle(t), resize: 'vertical' }} />
        </Field>
      )}
      </>
      )}
    </div>
  );
}

function FollowUpLog({ t, followUps, onLog }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [actions, setActions] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState('phone');

  function add() {
    if (!date) return;
    onLog({ date, actions_taken: actions.trim(), notes: notes.trim(), type });
    setDate(''); setActions(''); setNotes(''); setType('phone'); setOpen(false);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: t.fontLabel, fontWeight: 700, color: palette.backgroundDark.hex }}>Follow-up log</p>
        {!open && (
          <button onClick={() => setOpen(true)} style={{ background: palette.accentOrange.hex, border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: t.fontMuted, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer', fontFamily: 'inherit' }}>
            Add follow-up
          </button>
        )}
      </div>
      {followUps.length === 0 && !open && (
        <p style={{ fontSize: t.fontMuted, color: '#888', marginTop: 6 }}>No follow-ups yet.</p>
      )}
      {followUps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
          {followUps.map((f, i) => (
            <p key={i} style={{ fontSize: t.fontMuted, color: '#555', lineHeight: 1.4 }}>
              <span style={{ fontWeight: 650 }}>{fmt(f.date)}</span>
              {`  ${followUpTypeLabel(f.type)}`}
              {f.actions_taken ? `  ${f.actions_taken}` : ''}
              {f.notes ? `  ${f.notes}` : ''}
            </p>
          ))}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field t={t} label="Date of follow up">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle(t)} />
            </Field>
            <Field t={t} label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle(t)}>
                {AUTH_FOLLOW_UP_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <Field t={t} label="Actions taken">
            <input type="text" value={actions} onChange={(e) => setActions(e.target.value)} style={inputStyle(t)} />
          </Field>
          <Field t={t} label="Notes">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(false)} style={secondaryBtn(t)}>Cancel</button>
            <button onClick={add} disabled={!date} style={primaryBtn(t, { disabled: !date, color: palette.accentOrange.hex })}>Add follow-up</button>
          </div>
        </div>
      )}
    </div>
  );
}

function decisionLabel(line) {
  if (!line.decision) return 'Pending';
  switch (line.decision) {
    case AUTH_DECISION.NAR: return 'NAR';
    case AUTH_DECISION.APPROVED: return 'Approved';
    case AUTH_DECISION.PARTIAL: return 'Partial';
    case AUTH_DECISION.DENIED: return 'Denied';
    case AUTH_DECISION.BALANCE_BILL_MEDICAID: return 'Balance bill Medicaid';
    case AUTH_DECISION.FOLLOW_UP_NEEDED:
      return line.follow_up_outcome === AUTH_DECISION.DENIED ? 'Follow-up · Denied'
        : line.follow_up_outcome === AUTH_DECISION.SINGLE_CASE_AGREEMENT ? 'Follow-up · SCA'
        : 'Follow-up needed';
    default: return line.decision;
  }
}

function fmt(d) {
  return fmtCalendarDate(d, '');
}

function Field({ t, label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function ErrBanner({ t, children }) {
  return (
    <p style={{ fontSize: t.fontMuted, color: '#B91C1C', marginBottom: 8, padding: `${t.inputPadY}px ${t.inputPadX}px`, borderRadius: 6, background: '#FEE2E2' }}>
      {children}
    </p>
  );
}

// Keep import tree compatibility for any module importing this re-export.
export { INSURANCE_CATEGORY };
