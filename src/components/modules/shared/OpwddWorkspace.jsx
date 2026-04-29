/**
 * OpwddWorkspace — OPWDD enrollment workspace for both the widened module
 * panel (variant="drawer", 440px) and the patient drawer tab.
 *
 * Layout goals:
 *   1. Orient the user with a horizontal phase stepper at the top — always
 *      shows what step they're on and what's ahead.
 *   2. Progressive disclosure: every major section collapses to a dense
 *      one-line summary when it's not the active phase, and expands when
 *      it IS the active phase. Users can toggle manually.
 *   3. Grouped checklist: the 15 requirement rows cluster into 4 meaningful
 *      sub-sections (Core Docs, Identity & Insurance, Evaluations, Notice)
 *      each with its own satisfied/total count.
 *   4. Audit + activity log write on every state change, matching
 *      EligibilityWorkspace conventions.
 */

import { useEffect, useMemo, useState } from 'react';
import { useCurrentAppUser }  from '../../../hooks/useCurrentAppUser.js';
import { useLookups }         from '../../../hooks/useLookups.js';
import { usePermissions }     from '../../../hooks/usePermissions.js';
import { useCareStore }       from '../../../store/careStore.js';
import { PERMISSION_KEYS }    from '../../../data/permissionKeys.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

import {
  OPWDD_CASE_STATUS,
  OPWDD_CASE_STATUS_OPTIONS,
  OPWDD_SUB_STATUS,
  OPWDD_SUB_STATUS_OPTIONS,
  OPWDD_CLOSED_REASON_OPTIONS,
  OPWDD_EVAL_STATUS,
  OPWDD_EVAL_STATUS_OPTIONS,
  OPWDD_EVAL_VALIDITY_YEARS,
  OPWDD_SUBMISSION_METHOD,
  OPWDD_SUBMISSION_METHOD_OPTIONS,
  OPWDD_ELIGIBILITY_DETERMINATION,
  OPWDD_ELIGIBILITY_DETERMINATION_OPTIONS,
  OPWDD_NOTICE_METHOD,
  OPWDD_NOTICE_METHOD_OPTIONS,
  OPWDD_INTERESTED_SERVICE_OPTIONS,
  OPWDD_CHECKLIST_BY_KEY,
  OPWDD_CHECKLIST_GROUPS,
  OPWDD_CHECKLIST_STATUS,
  OPWDD_CHECKLIST_STATUS_OPTIONS,
  OPWDD_SATISFIED_STATUSES,
  OPWDD_REQUIREMENT_KEY,
  OPWDD_PHASES,
  OPWDD_AUDIT_ACTION,
  getOpwddPhaseForStatus,
} from '../../../data/opwddEnums.js';

import { useOpwddData } from './useOpwddData.js';
import { updateOpwddCase } from '../../../api/opwddCases.js';
import { updateChecklistItem } from '../../../api/opwddChecklistItems.js';
import { recordActivity } from '../../../api/activityLog.js';
import {
  openCaseForReferral,
  markChecklistItemReceived,
  markChecklistItemAccepted,
  recordPacketSubmitted,
  recordNoticeReceived,
  recordCode95Received,
  convertCaseToIntake,
  closeCase,
} from '../../../store/opwddOrchestration.js';

import {
  tokens, inputStyle, primaryBtn, secondaryBtn, cardStyle,
} from './workspaceStyles.js';

// ── Status pill colors ──────────────────────────────────────────────────────
const CASE_STATUS_PILL = {
  [OPWDD_CASE_STATUS.NOT_STARTED]:            { bg: '#EEE',    fg: '#666',    label: 'Not Started' },
  [OPWDD_CASE_STATUS.OUTREACH_IN_PROGRESS]:   { bg: '#E0F2FE', fg: '#0369A1', label: 'Outreach' },
  [OPWDD_CASE_STATUS.AWAITING_INITIAL_DOCS]:  { bg: '#FEF3C7', fg: '#92400E', label: 'Awaiting Docs' },
  [OPWDD_CASE_STATUS.EVALUATIONS_PENDING]:    { bg: '#FEF3C7', fg: '#92400E', label: 'Evals Pending' },
  [OPWDD_CASE_STATUS.PACKET_READY]:           { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Packet Ready' },
  [OPWDD_CASE_STATUS.SUBMITTED_TO_CCO]:       { bg: '#E0E7FF', fg: '#3730A3', label: 'Submitted' },
  [OPWDD_CASE_STATUS.ELIGIBILITY_DETERMINED]: { bg: '#DCFCE7', fg: '#15803d', label: 'Determined' },
  [OPWDD_CASE_STATUS.MONITORING_CODE_95]:     { bg: '#FFEDD5', fg: '#9A3412', label: 'Monitoring C95' },
  [OPWDD_CASE_STATUS.CODE_95_RECEIVED]:       { bg: '#DCFCE7', fg: '#15803d', label: 'Code 95 ✓' },
  [OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE]:    { bg: '#E5E5E5', fg: '#666',    label: 'Handed Off' },
  [OPWDD_CASE_STATUS.CLOSED]:                 { bg: '#E5E5E5', fg: '#666',    label: 'Closed' },
  [OPWDD_CASE_STATUS.CANCELLED]:              { bg: '#FEE2E2', fg: '#B91C1C', label: 'Cancelled' },
};

const CHECKLIST_STATUS_PILL = {
  [OPWDD_CHECKLIST_STATUS.MISSING]:      { bg: '#EEE',    fg: '#666',    label: 'Missing' },
  [OPWDD_CHECKLIST_STATUS.REQUESTED]:    { bg: '#E0F2FE', fg: '#0369A1', label: 'Requested' },
  [OPWDD_CHECKLIST_STATUS.RECEIVED]:     { bg: '#FEF3C7', fg: '#92400E', label: 'Received' },
  [OPWDD_CHECKLIST_STATUS.UNDER_REVIEW]: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Review' },
  [OPWDD_CHECKLIST_STATUS.ACCEPTED]:     { bg: '#DCFCE7', fg: '#15803d', label: 'Accepted' },
  [OPWDD_CHECKLIST_STATUS.REJECTED]:     { bg: '#FEE2E2', fg: '#B91C1C', label: 'Rejected' },
  [OPWDD_CHECKLIST_STATUS.EXPIRED]:      { bg: '#FFEDD5', fg: '#9A3412', label: 'Expired' },
  [OPWDD_CHECKLIST_STATUS.WAIVED]:       { bg: '#E5E5E5', fg: '#666',    label: 'Waived' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate     = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtShort    = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const daysSince   = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0;
const daysUntil   = (iso) => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : 0;

function parseArrayField(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function getInterestedServices(opwddCase) {
  return parseArrayField(opwddCase?.interested_services);
}

function computeChecklistProgress(items) {
  const required = items.filter((i) => i.is_required);
  const satisfied = items.filter((i) => OPWDD_SATISFIED_STATUSES.includes(i.status));

  const identityItems = items.filter((i) => {
    const tmpl = OPWDD_CHECKLIST_BY_KEY[i.requirement_key];
    return tmpl?.identityGroup;
  });
  const identitySatisfied = identityItems.some((i) => OPWDD_SATISFIED_STATUSES.includes(i.status));

  return {
    required: required.length,
    satisfied: satisfied.length,
    total: items.length,
    identityItems,
    identitySatisfied,
    percent: items.length > 0 ? Math.round((satisfied.length / items.length) * 100) : 0,
  };
}

function computeGroupProgress(items, group) {
  const rows = items.filter((i) => group.requirementKeys.includes(i.requirement_key));
  const satisfied = rows.filter((i) => OPWDD_SATISFIED_STATUSES.includes(i.status));
  return { rows, satisfied: satisfied.length, total: rows.length };
}

// ── Main component ──────────────────────────────────────────────────────────
export default function OpwddWorkspace({
  patient,
  referral,
  readOnly = false,
  variant = 'drawer',
  onInitiateTransition,
  onOpenFiles,
}) {
  const t = tokens(variant);
  const { appUser, appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const { can } = usePermissions();
  const users = useCareStore((s) => s.users);

  const canView      = can(PERMISSION_KEYS.OPWDD_CASE_VIEW);
  const canEdit      = !readOnly && can(PERMISSION_KEYS.OPWDD_CASE_EDIT);
  const canAssign    = !readOnly && can(PERMISSION_KEYS.OPWDD_CASE_ASSIGN);
  const canEditList  = !readOnly && can(PERMISSION_KEYS.OPWDD_CHECKLIST_EDIT);
  const canSubmit    = !readOnly && can(PERMISSION_KEYS.OPWDD_SUBMIT_PACKET);
  const canRecNotice = !readOnly && can(PERMISSION_KEYS.OPWDD_RECORD_NOTICE);
  const canMarkC95   = !readOnly && can(PERMISSION_KEYS.OPWDD_MARK_CODE95_RECEIVED);
  const canConvert   = !readOnly && can(PERMISSION_KEYS.OPWDD_CONVERT_TO_INTAKE);
  const canClose     = !readOnly && can(PERMISSION_KEYS.OPWDD_CLOSE_CASE);
  const canCreate    = !readOnly && can(PERMISSION_KEYS.OPWDD_CASE_CREATE);

  const { loading, activeCase, checklistItems, reload } = useOpwddData({
    patientId: patient?.id,
    referralId: referral?.id,
  });

  const [submissionModal, setSubmissionModal] = useState(null);
  const [noticeModal,     setNoticeModal]     = useState(null);
  const [closeModal,      setCloseModal]      = useState(null);
  const [convertModal,    setConvertModal]    = useState(null);
  const [itemReviewModal, setItemReviewModal] = useState(null);
  const [opening, setOpening] = useState(false);

  // Collapsible section state — keyed by section id. By default each
  // section opens when it matches the current workflow phase.
  const [expanded, setExpanded] = useState({});

  const phase = useMemo(() => getOpwddPhaseForStatus(activeCase?.status), [activeCase?.status]);
  const progress = useMemo(() => computeChecklistProgress(checklistItems), [checklistItems]);

  // All derived-value memos MUST be declared at the top level of the
  // component BEFORE any conditional return, to satisfy the Rules of Hooks
  // (early returns below would otherwise cause hook-count mismatches).
  // Each memo is written to be safe when activeCase is null.
  const interested = useMemo(() => getInterestedServices(activeCase), [activeCase]);
  const abaOnlyDetected = activeCase
    ? activeCase.aba_only_referral === true || activeCase.aba_only_referral === 'true'
    : false;

  const outreachSummary = useMemo(() => {
    if (!activeCase) return '';
    const parts = [];
    if (activeCase.pcg_willing_to_apply) parts.push('willing ✓');
    if (activeCase.pcg_interested_in_wellbound_services) parts.push('interested ✓');
    if (interested.length > 0) parts.push(`${interested.length} svc${interested.length === 1 ? '' : 's'}`);
    if (abaOnlyDetected) parts.push('ABA-only ⚠');
    if (parts.length === 0) parts.push('Not started');
    return parts.join(' · ');
  }, [activeCase, interested, abaOnlyDetected]);

  const evalSummary = useMemo(() => {
    if (!activeCase) return '';
    const psyStatus = activeCase.psychological_eval_status || 'needed';
    const socStatus = activeCase.psychosocial_status || 'needed';
    return `Psych: ${psyStatus} · Psychosocial: ${socStatus}`;
  }, [activeCase]);

  const submissionSummary = useMemo(() => {
    if (!activeCase) return '';
    return activeCase.submission_sent_at
      ? `Submitted ${fmtShort(activeCase.submission_sent_at)}${activeCase.submission_method ? ` via ${activeCase.submission_method}` : ''}`
      : 'Not yet submitted';
  }, [activeCase]);

  const noticeSummary = useMemo(() => {
    if (!activeCase) return '';
    if (activeCase.code_95_received_at) return `Code 95 ✓ ${fmtShort(activeCase.code_95_received_at)}`;
    if (activeCase.notice_received_at) {
      const windowEnd = activeCase.expected_code_95_window_end;
      if (windowEnd) {
        const d = daysUntil(windowEnd);
        return `Monitoring · ${d >= 0 ? `${d}d left` : `${Math.abs(d)}d overdue`}`;
      }
      return `Notice received ${fmtShort(activeCase.notice_received_at)}`;
    }
    return 'Awaiting notice';
  }, [activeCase]);

  // Default-expand the section matching the current phase on initial load /
  // when the phase changes. Users can still manually toggle.
  useEffect(() => {
    if (!activeCase) return;
    setExpanded((prev) => ({ ...prev, [phase.id]: true }));
  }, [activeCase?.id, phase.id]);

  if (!canView) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: t.fontBase, color: '#888' }}>You do not have permission to view OPWDD cases.</p>
      </div>
    );
  }

  if (!patient || !referral) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: t.fontBase, color: '#888' }}>Select a referral to view its OPWDD case.</p>
      </div>
    );
  }

  // No case yet — offer to open one.
  if (!activeCase) {
    return (
      <div data-testid="opwdd-workspace" data-variant={variant} style={{ padding: variant === 'panel' ? '14px 12px' : '18px 18px 36px' }}>
        <div style={{ ...cardStyle(t), padding: `${t.cardPadY + 2}px ${t.cardPadX}px` }}>
          <p style={{ fontSize: t.fontBase + 1, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 6 }}>
            No OPWDD case open for this referral.
          </p>
          <p style={{ fontSize: t.fontMuted, color: '#666', lineHeight: 1.5, marginBottom: 10 }}>
            Open a case to begin PCG outreach, seed the 15-item document checklist, and start tracking toward Code 95.
          </p>
          {loading && <p style={{ fontSize: t.fontMuted, color: '#888' }}>Loading…</p>}
          {!loading && canCreate && (
            <button
              data-testid="opwdd-open-case"
              disabled={opening}
              onClick={async () => {
                setOpening(true);
                try {
                  await openCaseForReferral({
                    referral,
                    patientId: patient.id,
                    actorUserId: appUserId,
                    assignedSpecialistId: appUserId,
                  });
                  reload();
                  triggerDataRefresh();
                } catch (err) {
                  console.error('Open OPWDD case failed', err);
                } finally {
                  setOpening(false);
                }
              }}
              style={primaryBtn(t, { disabled: opening, color: palette.primaryDeepPlum.hex })}
            >
              {opening ? 'Opening…' : 'Open OPWDD Case'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const pill = CASE_STATUS_PILL[activeCase.status] || CASE_STATUS_PILL[OPWDD_CASE_STATUS.NOT_STARTED];
  const specialistName = activeCase.assigned_enrollment_specialist_id
    ? resolveUser(activeCase.assigned_enrollment_specialist_id)
    : null;

  // --- Inline field saver (used by every inline edit control) ---
  async function patchCase(partial, audit) {
    if (!canEdit) return;
    try {
      await updateOpwddCase(activeCase._id, partial);
      if (audit) {
        await recordActivity({
          actorUserId: appUserId,
          patientId:  patient.id,
          referralId: referral.id,
          action:     audit.action,
          detail:     audit.detail,
          metadata:   { caseId: activeCase.id, ...(audit.metadata || {}) },
        }).catch(() => {});
      }
      reload();
      triggerDataRefresh();
    } catch (err) {
      console.error('OPWDD case update failed', err);
    }
  }

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div data-testid="opwdd-workspace" data-variant={variant} style={{ padding: variant === 'panel' ? '14px 12px' : '16px 18px 40px' }}>

      {/* ── Compact header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <p style={{ fontSize: t.fontBase + 2, fontWeight: 700, color: palette.backgroundDark.hex, letterSpacing: '-0.01em' }}>
            {activeCase.id}
          </p>
          <span style={{
            fontSize: t.fontMuted, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
            background: pill.bg, color: pill.fg, flexShrink: 0,
          }}>{pill.label}</span>
        </div>
        <p style={{ fontSize: t.fontMuted, color: '#888', marginTop: 2 }}>
          {activeCase.opened_at ? `Day ${daysSince(activeCase.opened_at) + 1} · opened ${fmtShort(activeCase.opened_at)}` : 'Newly opened'}
          {specialistName && ` · ${specialistName}`}
        </p>
      </div>

      {/* ── Phase stepper ────────────────────────────────────────── */}
      <PhaseStepper t={t} currentPhase={phase} checklistSatisfied={progress.satisfied} checklistTotal={progress.total} />

      {/* ── ABA-only hard stop ────────────────────────────────────── */}
      {abaOnlyDetected && (
        <div data-testid="opwdd-aba-warning" style={{
          marginTop: 10, padding: `${t.cardPadY - 2}px ${t.cardPadX}px`,
          borderRadius: t.radius, border: '1px solid #FEE2E2', background: '#FEF2F2',
        }}>
          <p style={{ fontSize: t.fontBase, fontWeight: 700, color: '#B91C1C', marginBottom: 2 }}>
            ABA-only referral
          </p>
          <p style={{ fontSize: t.fontMuted, color: '#7F1D1D', lineHeight: 1.4 }}>
            ABA-only referrals do not proceed through OPWDD enrollment. Consider closing with reason "ABA-only".
          </p>
        </div>
      )}

      {/* ── Status + blocker + assignee (always-visible compact row) ── */}
      {canEdit && (
        <div style={{ ...cardStyle(t), padding: `${t.cardPadY - 2}px ${t.cardPadX}px`, marginTop: 10, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <SelectField t={t} label="Status" value={activeCase.status}
              options={OPWDD_CASE_STATUS_OPTIONS}
              onChange={(v) => patchCase({ status: v })}
              testId="opwdd-status-select" />
            <SelectField t={t} label="Blocker" value={activeCase.sub_status || activeCase.latest_blocker || OPWDD_SUB_STATUS.NONE}
              options={OPWDD_SUB_STATUS_OPTIONS}
              onChange={(v) => patchCase({ sub_status: v, latest_blocker: v })}
              testId="opwdd-substatus-select" />
          </div>
          {canAssign && Object.keys(users || {}).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#777', marginBottom: 2 }}>Assigned Specialist</p>
              <select
                value={activeCase.assigned_enrollment_specialist_id || ''}
                onChange={(e) => patchCase({ assigned_enrollment_specialist_id: e.target.value })}
                style={inputStyle(t)} data-testid="opwdd-assignee-select"
              >
                <option value="">Unassigned</option>
                {Object.values(users).map((u) => (
                  <option key={u.id} value={u.id}>
                    {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || u.id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── PCG Outreach (collapsible) ───────────────────────────── */}
      <CollapsibleSection
        t={t}
        id="outreach"
        title="PCG Outreach"
        summary={outreachSummary}
        isActive={phase.id === 'outreach'}
        expanded={expanded.outreach}
        onToggle={() => toggle('outreach')}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <InlineField t={t} label="Contact Name" value={activeCase.pcg_contact_name}
            onSave={(v) => patchCase({ pcg_contact_name: v }, { action: OPWDD_AUDIT_ACTION.OUTREACH_COMPLETED, detail: 'PCG contact name updated.' })}
            readOnly={!canEdit} />
          <InlineField t={t} label="Relationship" value={activeCase.pcg_relationship_to_patient}
            placeholder="parent / guardian / caregiver"
            onSave={(v) => patchCase({ pcg_relationship_to_patient: v })} readOnly={!canEdit} />
          <InlineField t={t} label="Phone" value={activeCase.pcg_contact_phone} type="tel"
            onSave={(v) => patchCase({ pcg_contact_phone: v })} readOnly={!canEdit} />
          <InlineField t={t} label="Email" value={activeCase.pcg_contact_email} type="email"
            onSave={(v) => patchCase({ pcg_contact_email: v })} readOnly={!canEdit} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
          <CheckRow t={t} label="Willing to apply for OPWDD"
            checked={activeCase.pcg_willing_to_apply}
            readOnly={!canEdit}
            onChange={(v) => patchCase({ pcg_willing_to_apply: v }, {
              action: OPWDD_AUDIT_ACTION.PCG_INTEREST_CONFIRMED,
              detail: `PCG willing to apply = ${v ? 'yes' : 'no'}.`,
            })} />
          <CheckRow t={t} label="Interested in Wellbound Special Needs services"
            checked={activeCase.pcg_interested_in_wellbound_services}
            readOnly={!canEdit}
            onChange={(v) => patchCase({ pcg_interested_in_wellbound_services: v }, {
              action: OPWDD_AUDIT_ACTION.PCG_INTEREST_CONFIRMED,
              detail: `PCG interested = ${v ? 'yes' : 'no'}.`,
            })} />
          <CheckRow t={t} label="ABA-only referral (hard stop)"
            checked={abaOnlyDetected}
            readOnly={!canEdit}
            onChange={(v) => patchCase({ aba_only_referral: v })} />
        </div>

        <div>
          <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#777', marginBottom: 4 }}>Interested Services</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {OPWDD_INTERESTED_SERVICE_OPTIONS.map((svc) => {
              const active = interested.includes(svc.value);
              return (
                <button
                  key={svc.value} disabled={!canEdit}
                  onClick={() => {
                    const next = active ? interested.filter((s) => s !== svc.value) : [...interested, svc.value];
                    patchCase({ interested_services: next }, {
                      action: OPWDD_AUDIT_ACTION.SERVICE_INTEREST_UPDATED,
                      detail: `Interested services: ${next.join(', ') || 'none'}.`,
                      metadata: { services: next },
                    });
                  }}
                  style={{
                    padding: '3px 9px', borderRadius: 5, fontSize: t.fontMuted, fontWeight: 600,
                    border: `1px solid ${active ? palette.accentGreen.hex : 'var(--color-border)'}`,
                    background: active ? palette.accentGreen.hex : palette.backgroundLight.hex,
                    color: active ? palette.backgroundLight.hex : palette.backgroundDark.hex,
                    cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.7,
                  }}
                  data-testid={`opwdd-service-${svc.value}`}
                >
                  {svc.value}
                </button>
              );
            })}
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Evaluations (collapsible) ──────────────────────────────── */}
      <CollapsibleSection
        t={t}
        id="evals"
        title="Evaluations · Article 16"
        summary={evalSummary}
        isActive={phase.id === 'evals'}
        expanded={expanded.evals}
        onToggle={() => toggle('evals')}
      >
        <InlineField t={t} label="Article 16 Clinic" value={activeCase.article16_clinic_name}
          placeholder="Clinic name" onSave={(v) => patchCase({ article16_clinic_name: v })} readOnly={!canEdit} />

        <EvaluationRow t={t} label="Psychological · <3y"
          fieldPrefix="psychological_eval"
          statusValue={activeCase.psychological_eval_status}
          scheduledFor={activeCase.psychological_eval_scheduled_for}
          receivedAt={activeCase.psychological_eval_received_at}
          validThrough={activeCase.psychological_eval_valid_through}
          validityYears={OPWDD_EVAL_VALIDITY_YEARS.psychological}
          readOnly={!canEdit}
          onChangeStatus={(v) => patchCase({ psychological_eval_status: v })}
          onReceived={(iso) => patchCase({
            psychological_eval_status: OPWDD_EVAL_STATUS.RECEIVED,
            psychological_eval_received_at: iso,
            psychological_eval_valid_through: addYears(iso, OPWDD_EVAL_VALIDITY_YEARS.psychological),
          }, { action: OPWDD_AUDIT_ACTION.EVAL_RECEIVED, detail: 'Psychological evaluation received.' })}
          onScheduled={(iso) => patchCase({
            psychological_eval_status: OPWDD_EVAL_STATUS.SCHEDULED,
            psychological_eval_scheduled_for: iso,
          }, { action: OPWDD_AUDIT_ACTION.EVAL_SCHEDULED, detail: 'Psychological evaluation scheduled.' })}
        />

        <EvaluationRow t={t} label="Psychosocial · <1y"
          fieldPrefix="psychosocial"
          statusValue={activeCase.psychosocial_status}
          scheduledFor={activeCase.psychosocial_scheduled_for}
          receivedAt={activeCase.psychosocial_received_at}
          validThrough={activeCase.psychosocial_valid_through}
          validityYears={OPWDD_EVAL_VALIDITY_YEARS.psychosocial}
          readOnly={!canEdit}
          onChangeStatus={(v) => patchCase({ psychosocial_status: v })}
          onReceived={(iso) => patchCase({
            psychosocial_status: OPWDD_EVAL_STATUS.RECEIVED,
            psychosocial_received_at: iso,
            psychosocial_valid_through: addYears(iso, OPWDD_EVAL_VALIDITY_YEARS.psychosocial),
          }, { action: OPWDD_AUDIT_ACTION.EVAL_RECEIVED, detail: 'Psychosocial evaluation received.' })}
          onScheduled={(iso) => patchCase({
            psychosocial_status: OPWDD_EVAL_STATUS.SCHEDULED,
            psychosocial_scheduled_for: iso,
          }, { action: OPWDD_AUDIT_ACTION.EVAL_SCHEDULED, detail: 'Psychosocial evaluation scheduled.' })}
        />
      </CollapsibleSection>

      {/* ── Document Checklist (grouped, collapsible) ─────────────── */}
      <CollapsibleSection
        t={t}
        id="checklist"
        title="Document Checklist"
        summary={`${progress.satisfied}/${progress.total} satisfied · ${progress.percent}%`}
        isActive={phase.id === 'docs' || phase.id === 'evals'}
        expanded={expanded.checklist}
        onToggle={() => toggle('checklist')}
      >
        {checklistItems.length === 0 && (
          <p style={{ fontSize: t.fontMuted, color: '#888' }}>No checklist items — the case may have been opened before the checklist was seeded.</p>
        )}
        {OPWDD_CHECKLIST_GROUPS.map((group) => {
          const { rows, satisfied, total } = computeGroupProgress(checklistItems, group);
          if (total === 0) return null;
          const groupId = `group_${group.id}`;
          const isExpanded = expanded[groupId] !== undefined ? expanded[groupId] : (satisfied < total);
          return (
            <div key={group.id} style={{ marginBottom: 6 }}>
              <button
                onClick={() => toggle(groupId)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: `${t.inputPadY - 1}px ${t.inputPadX}px`, background: hexToRgba(palette.backgroundDark.hex, 0.03),
                  border: `1px solid var(--color-border)`, borderRadius: 6,
                  fontSize: t.fontMuted, fontWeight: 650, color: palette.backgroundDark.hex, cursor: 'pointer',
                }}
              >
                <span>{isExpanded ? '▾' : '▸'} {group.label}</span>
                <span style={{ color: satisfied === total ? '#15803d' : '#666' }}>
                  {satisfied}/{total}
                </span>
              </button>
              {isExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4, marginLeft: 4 }}>
                  {rows.map((item) => (
                    <ChecklistRow
                      key={item._id}
                      t={t}
                      item={item}
                      readOnly={!canEditList}
                      onOpenReview={() => setItemReviewModal(item)}
                      onOpenFiles={onOpenFiles ? () => onOpenFiles(patient) : null}
                      resolveUser={resolveUser}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {progress.identityItems.length > 0 && !progress.identitySatisfied && (
          <p style={{ fontSize: t.fontMuted, color: '#92400E', marginTop: 6, lineHeight: 1.4 }}>
            Identity requirement: at least one of Birth Certificate, Passport, or State ID must be accepted.
          </p>
        )}
      </CollapsibleSection>

      {/* ── Submission (collapsible) ──────────────────────────────── */}
      <CollapsibleSection
        t={t}
        id="submit"
        title="Submission to CCO"
        summary={submissionSummary}
        isActive={phase.id === 'submit'}
        expanded={expanded.submit}
        onToggle={() => toggle('submit')}
      >
        <InlineField t={t} label="CCO Name" value={activeCase.cco_name_snapshot}
          placeholder="Care Design NY / Advance Care Alliance NY"
          onSave={(v) => patchCase({ cco_name_snapshot: v })} readOnly={!canEdit} />

        {activeCase.submission_sent_at ? (
          <div style={{ fontSize: t.fontMuted, color: '#555', lineHeight: 1.5, marginTop: 6 }}>
            <p>Submitted {fmtDateTime(activeCase.submission_sent_at)}
              {activeCase.submission_sent_by_id && ` by ${resolveUser(activeCase.submission_sent_by_id)}`}
              {activeCase.submission_method && ` via ${activeCase.submission_method}`}.
            </p>
            {activeCase.submission_confirmation_number && <p>Confirmation: {activeCase.submission_confirmation_number}</p>}
          </div>
        ) : (
          <p style={{ fontSize: t.fontMuted, color: '#888', marginTop: 6 }}>Packet not yet submitted.</p>
        )}

        {canSubmit && !activeCase.submission_sent_at && (
          <button
            data-testid="opwdd-submit-btn"
            onClick={() => setSubmissionModal({
              method: OPWDD_SUBMISSION_METHOD.EMAIL,
              ccoName: activeCase.cco_name_snapshot || '',
              confirmationNumber: '',
            })}
            style={{ ...primaryBtn(t, { color: palette.primaryDeepPlum.hex }), marginTop: 8 }}
          >
            Record Packet Submission
          </button>
        )}
      </CollapsibleSection>

      {/* ── Notice + Code 95 (collapsible) ────────────────────────── */}
      <CollapsibleSection
        t={t}
        id="monitor"
        title="Notice & Code 95 Monitoring"
        summary={noticeSummary}
        isActive={phase.id === 'monitor' || phase.id === 'code95'}
        expanded={expanded.monitor}
        onToggle={() => toggle('monitor')}
      >
        <div style={{ fontSize: t.fontMuted, color: '#555', lineHeight: 1.55 }}>
          {activeCase.notice_received_at ? (
            <>
              <p><b>Notice received:</b> {fmtDate(activeCase.notice_received_at)} via {activeCase.notice_received_method || 'unknown'}.</p>
              <p><b>Determination:</b> {activeCase.eligibility_determination || 'pending'}.</p>
              {activeCase.expected_code_95_window_start && (
                <div style={{ marginTop: 6 }}>
                  <Code95Window
                    t={t}
                    windowStart={activeCase.expected_code_95_window_start}
                    windowEnd={activeCase.expected_code_95_window_end}
                    received={activeCase.code_95_received_at}
                  />
                </div>
              )}
            </>
          ) : (
            <p style={{ color: '#888' }}>Awaiting notice letter from OPWDD.</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {canRecNotice && !activeCase.notice_received_at && activeCase.submission_sent_at && (
            <button
              data-testid="opwdd-record-notice"
              onClick={() => setNoticeModal({
                noticeDate: new Date().toISOString().slice(0, 10),
                method: OPWDD_NOTICE_METHOD.MAIL,
                determination: OPWDD_ELIGIBILITY_DETERMINATION.ELIGIBLE,
              })}
              style={primaryBtn(t, { color: palette.accentGreen.hex })}
            >
              Record Notice Received
            </button>
          )}
          {canMarkC95 && activeCase.notice_received_at && !activeCase.code_95_received_at && (
            <button
              data-testid="opwdd-mark-code95"
              onClick={async () => {
                try {
                  await recordCode95Received({ opwddCase: activeCase, referral, actorUserId: appUserId });
                  reload(); triggerDataRefresh();
                } catch (err) { console.error('Code 95 mark failed', err); }
              }}
              style={primaryBtn(t, { color: palette.accentGreen.hex })}
            >
              Mark Code 95 Received
            </button>
          )}
        </div>
      </CollapsibleSection>

      {/* ── Latest Blocker Note (small always-open card) ──────────── */}
      <div style={{ ...cardStyle(t), padding: `${t.cardPadY - 2}px ${t.cardPadX}px`, marginTop: 10 }}>
        <p style={{ fontSize: t.fontLabel, fontWeight: 700, color: '#777', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
          Latest Blocker Note
        </p>
        <textarea
          value={activeCase.latest_blocker_note || ''}
          disabled={!canEdit}
          onChange={(e) => patchCase({ latest_blocker_note: e.target.value })}
          rows={2}
          placeholder="Short note surfaced in reports and dashboards."
          style={{ ...inputStyle(t), resize: 'vertical' }}
          data-testid="opwdd-blocker-note"
        />
      </div>

      {/* ── Next steps / close footer ─────────────────────────────── */}
      {(canConvert || canClose) && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {canConvert && activeCase.code_95_received_at && activeCase.status !== OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE && (
            <button
              data-testid="opwdd-convert-intake"
              onClick={() => setConvertModal({ handoffNote: '' })}
              style={primaryBtn(t, { color: palette.accentGreen.hex })}
            >
              Convert to Intake →
            </button>
          )}
          {canClose && activeCase.status !== OPWDD_CASE_STATUS.CLOSED && activeCase.status !== OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE && (
            <button
              data-testid="opwdd-close-case"
              onClick={() => setCloseModal({ reason: 'pcg_declined', note: '' })}
              style={secondaryBtn(t)}
            >
              Close Case…
            </button>
          )}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────── */}
      {submissionModal && (
        <Modal title="Record Packet Submission" onClose={() => setSubmissionModal(null)}>
          <Field t={t} label="CCO Name">
            <input type="text" value={submissionModal.ccoName}
              onChange={(e) => setSubmissionModal({ ...submissionModal, ccoName: e.target.value })}
              style={inputStyle(t)} placeholder="Care Design NY / Advance Care Alliance NY" />
          </Field>
          <Field t={t} label="Method">
            <select value={submissionModal.method}
              onChange={(e) => setSubmissionModal({ ...submissionModal, method: e.target.value })} style={inputStyle(t)}>
              {OPWDD_SUBMISSION_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field t={t} label="Confirmation # (optional)">
            <input type="text" value={submissionModal.confirmationNumber}
              onChange={(e) => setSubmissionModal({ ...submissionModal, confirmationNumber: e.target.value })}
              style={inputStyle(t)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setSubmissionModal(null)} style={secondaryBtn(t)}>Cancel</button>
            <button
              data-testid="opwdd-submit-confirm"
              onClick={async () => {
                try {
                  await recordPacketSubmitted({
                    opwddCase: activeCase, actorUserId: appUserId,
                    method: submissionModal.method,
                    confirmationNumber: submissionModal.confirmationNumber || null,
                    ccoName: submissionModal.ccoName || null,
                  });
                  setSubmissionModal(null);
                  reload(); triggerDataRefresh();
                } catch (err) { console.error('Submission record failed', err); }
              }}
              style={primaryBtn(t, { color: palette.primaryDeepPlum.hex })}
            >
              Record Submission
            </button>
          </div>
        </Modal>
      )}

      {noticeModal && (
        <Modal title="Record Notice Received" onClose={() => setNoticeModal(null)}>
          <Field t={t} label="Notice Date">
            <input type="date" value={noticeModal.noticeDate}
              onChange={(e) => setNoticeModal({ ...noticeModal, noticeDate: e.target.value })} style={inputStyle(t)} />
          </Field>
          <Field t={t} label="Method">
            <select value={noticeModal.method} onChange={(e) => setNoticeModal({ ...noticeModal, method: e.target.value })} style={inputStyle(t)}>
              {OPWDD_NOTICE_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field t={t} label="Determination">
            <select value={noticeModal.determination} onChange={(e) => setNoticeModal({ ...noticeModal, determination: e.target.value })} style={inputStyle(t)}>
              {OPWDD_ELIGIBILITY_DETERMINATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setNoticeModal(null)} style={secondaryBtn(t)}>Cancel</button>
            <button
              data-testid="opwdd-notice-confirm"
              onClick={async () => {
                try {
                  await recordNoticeReceived({
                    opwddCase: activeCase, actorUserId: appUserId,
                    noticeDate: noticeModal.noticeDate,
                    method: noticeModal.method,
                    determination: noticeModal.determination,
                  });
                  setNoticeModal(null);
                  reload(); triggerDataRefresh();
                } catch (err) { console.error('Notice record failed', err); }
              }}
              style={primaryBtn(t, { color: palette.accentGreen.hex })}
            >
              Save & Start Monitoring
            </button>
          </div>
        </Modal>
      )}

      {convertModal && (
        <Modal title="Convert to Intake" onClose={() => setConvertModal(null)}>
          <p style={{ fontSize: t.fontMuted, color: '#555', marginBottom: 10 }}>
            Code 95 received on {fmtDate(activeCase.code_95_received_at)}. This will close the OPWDD case and push the referral into the standard CHHA intake flow.
          </p>
          <Field t={t} label="Handoff Note (optional)">
            <textarea value={convertModal.handoffNote} rows={3} style={{ ...inputStyle(t), resize: 'vertical' }}
              onChange={(e) => setConvertModal({ ...convertModal, handoffNote: e.target.value })}
              placeholder="Anything intake should know about this family going in." />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setConvertModal(null)} style={secondaryBtn(t)}>Cancel</button>
            <button
              data-testid="opwdd-convert-confirm"
              onClick={async () => {
                try {
                  await convertCaseToIntake({ opwddCase: activeCase, referral, actorUserId: appUserId, handoffNote: convertModal.handoffNote || null });
                  setConvertModal(null);
                  reload(); triggerDataRefresh();
                  onInitiateTransition?.(referral, 'Intake');
                } catch (err) { console.error('Convert failed', err); }
              }}
              style={primaryBtn(t, { color: palette.accentGreen.hex })}
            >
              Convert & Hand Off
            </button>
          </div>
        </Modal>
      )}

      {closeModal && (
        <Modal title="Close OPWDD Case" onClose={() => setCloseModal(null)}>
          <Field t={t} label="Reason">
            <select value={closeModal.reason} onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })} style={inputStyle(t)}>
              {OPWDD_CLOSED_REASON_OPTIONS.filter((o) => o.value !== 'converted_to_intake').map((o) =>
                <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field t={t} label="Note">
            <textarea value={closeModal.note} rows={3} style={{ ...inputStyle(t), resize: 'vertical' }}
              onChange={(e) => setCloseModal({ ...closeModal, note: e.target.value })}
              placeholder="Why is this case being closed?" />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => setCloseModal(null)} style={secondaryBtn(t)}>Cancel</button>
            <button
              data-testid="opwdd-close-confirm"
              onClick={async () => {
                try {
                  await closeCase({ opwddCase: activeCase, actorUserId: appUserId, reason: closeModal.reason, note: closeModal.note });
                  setCloseModal(null);
                  reload(); triggerDataRefresh();
                } catch (err) { console.error('Close failed', err); }
              }}
              style={primaryBtn(t, { color: palette.primaryMagenta.hex })}
            >
              Close Case
            </button>
          </div>
        </Modal>
      )}

      {itemReviewModal && (
        <ChecklistItemReviewModal
          t={t}
          item={itemReviewModal}
          appUserId={appUserId}
          onClose={() => setItemReviewModal(null)}
          onUpdated={() => { setItemReviewModal(null); reload(); triggerDataRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Phase stepper ───────────────────────────────────────────────────────────
function PhaseStepper({ t, currentPhase, checklistSatisfied, checklistTotal }) {
  const current = currentPhase?.order ?? 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${OPWDD_PHASES.length}, 1fr)`, gap: 2,
      padding: `${t.inputPadY}px ${t.inputPadX - 2}px`,
      background: hexToRgba(palette.primaryDeepPlum.hex, 0.04),
      borderRadius: t.radius,
      border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.12)}`,
    }}>
      {OPWDD_PHASES.map((p) => {
        const isCurrent = p.order === current;
        const isDone = p.order < current;
        const isFuture = p.order > current;
        const showCount = p.id === 'docs' && checklistTotal > 0;
        return (
          <div
            key={p.id}
            title={p.label}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '4px 2px', borderRadius: 4,
              background: isCurrent ? palette.primaryDeepPlum.hex : 'transparent',
              color: isCurrent ? palette.backgroundLight.hex
                : isDone ? palette.accentGreen.hex
                : isFuture ? hexToRgba(palette.backgroundDark.hex, 0.3)
                : hexToRgba(palette.backgroundDark.hex, 0.5),
              fontSize: t.fontMuted - 0.5, fontWeight: isCurrent ? 700 : 600,
              lineHeight: 1.2,
            }}
          >
            <span style={{ fontSize: t.fontMuted - 1.5, opacity: 0.65 }}>
              {isDone ? '✓' : p.order + 1}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{p.shortLabel}</span>
            {showCount && <span style={{ fontSize: t.fontMuted - 2, opacity: 0.8 }}>{checklistSatisfied}/{checklistTotal}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Collapsible section ─────────────────────────────────────────────────────
function CollapsibleSection({ t, id, title, summary, expanded, onToggle, isActive, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: `${t.cardPadY - 2}px ${t.cardPadX}px`,
          background: isActive
            ? hexToRgba(palette.primaryDeepPlum.hex, 0.06)
            : palette.backgroundLight.hex,
          border: `1px solid ${isActive ? hexToRgba(palette.primaryDeepPlum.hex, 0.25) : 'var(--color-border)'}`,
          borderRadius: t.radius,
          borderBottomLeftRadius:  expanded ? 0 : t.radius,
          borderBottomRightRadius: expanded ? 0 : t.radius,
          borderBottom: expanded ? 'none' : undefined,
          cursor: 'pointer', textAlign: 'left', gap: 8,
        }}
        data-testid={`opwdd-section-${id}`}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: t.fontBase, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: expanded ? 0 : 1 }}>
            {isActive && <span style={{ color: palette.primaryDeepPlum.hex, marginRight: 4 }}>●</span>}
            {title}
          </p>
          {!expanded && summary && (
            <p style={{ fontSize: t.fontMuted, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summary}
            </p>
          )}
        </div>
        <span style={{ fontSize: t.fontBase, color: '#999', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{
          padding: `${t.cardPadY}px ${t.cardPadX}px`,
          border: `1px solid ${isActive ? hexToRgba(palette.primaryDeepPlum.hex, 0.25) : 'var(--color-border)'}`,
          borderTop: 'none',
          borderBottomLeftRadius: t.radius, borderBottomRightRadius: t.radius,
          background: palette.backgroundLight.hex,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Code 95 monitoring window indicator ─────────────────────────────────────
function Code95Window({ t, windowStart, windowEnd, received }) {
  if (received) {
    return (
      <p style={{ fontSize: t.fontMuted, color: '#15803d', fontWeight: 650 }}>
        Code 95 received {fmtDate(received)} ✓
      </p>
    );
  }
  const daysLeft = daysUntil(windowEnd);
  const overdue = daysLeft < 0;
  return (
    <div>
      <p style={{ fontSize: t.fontMuted, color: '#555', marginBottom: 3 }}>
        Expected window: {fmtDate(windowStart)} → {fmtDate(windowEnd)}
      </p>
      <div style={{
        display: 'inline-block', padding: '3px 10px', borderRadius: 20,
        fontSize: t.fontMuted, fontWeight: 700,
        background: overdue ? '#FEE2E2' : '#FFEDD5',
        color: overdue ? '#B91C1C' : '#9A3412',
      }}>
        {overdue ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Field({ t, label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#555', marginBottom: 3 }}>{label}</p>
      {children}
    </div>
  );
}

function SelectField({ t, label, value, options, onChange, testId }) {
  return (
    <div>
      <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#777', marginBottom: 2 }}>{label}</p>
      <select
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        style={inputStyle(t)}
        data-testid={testId}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function InlineField({ t, label, value, onSave, readOnly, placeholder, type = 'text' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);

  return (
    <div>
      <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#777', marginBottom: 2 }}>{label}</p>
      {editing ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <input type={type} value={draft} onChange={(e) => setDraft(e.target.value)}
            style={{ ...inputStyle(t), flex: 1 }} placeholder={placeholder || ''} />
          <button
            onClick={() => { onSave?.(draft.trim() || null); setEditing(false); }}
            style={{ padding: `${t.inputPadY}px ${t.inputPadX}px`, border: 'none', borderRadius: 6, background: palette.accentGreen.hex, color: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 650, cursor: 'pointer' }}
          >Save</button>
        </div>
      ) : (
        <button
          onClick={() => !readOnly && setEditing(true)}
          disabled={readOnly}
          style={{ ...inputStyle(t), textAlign: 'left', cursor: readOnly ? 'default' : 'text', minHeight: t.inputPadY * 2 + 16 }}
        >
          {value || <span style={{ color: '#AAA' }}>{placeholder || '—'}</span>}
        </button>
      )}
    </div>
  );
}

function CheckRow({ t, label, checked, onChange, readOnly }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: t.fontBase, color: palette.backgroundDark.hex, cursor: readOnly ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={!!checked} disabled={readOnly}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0 }} />
      <span>{label}</span>
    </label>
  );
}

function EvaluationRow({ t, label, statusValue, scheduledFor, receivedAt, validThrough, validityYears, onReceived, onScheduled, onChangeStatus, readOnly }) {
  const statusPill = statusValue === OPWDD_EVAL_STATUS.ACCEPTED || statusValue === OPWDD_EVAL_STATUS.RECEIVED
    ? { bg: '#DCFCE7', fg: '#15803d' }
    : statusValue === OPWDD_EVAL_STATUS.EXPIRED
    ? { bg: '#FEE2E2', fg: '#B91C1C' }
    : { bg: '#FEF3C7', fg: '#92400E' };

  const expiryState = useMemo(() => {
    if (!validThrough) return null;
    return new Date(validThrough).getTime() < Date.now() ? 'expired' : 'current';
  }, [validThrough]);

  return (
    <div style={{ ...cardStyle(t), padding: `${t.cardPadY - 2}px ${t.cardPadX}px`, marginTop: 6, marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <p style={{ fontSize: t.fontBase, fontWeight: 650, color: palette.backgroundDark.hex }}>{label}</p>
        <span style={{ fontSize: t.fontMuted, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: statusPill.bg, color: statusPill.fg }}>
          {statusValue || 'needed'}
        </span>
      </div>
      <div style={{ fontSize: t.fontMuted, color: '#666', marginTop: 3 }}>
        {scheduledFor && <>Scheduled {fmtDate(scheduledFor)}. </>}
        {receivedAt && <>Received {fmtDate(receivedAt)}. </>}
        {validThrough && (
          <span style={{ color: expiryState === 'expired' ? '#B91C1C' : '#15803d' }}>
            Valid through {fmtDate(validThrough)}{expiryState === 'expired' ? ' (EXPIRED)' : ''}
          </span>
        )}
        {!scheduledFor && !receivedAt && <>Not yet scheduled.</>}
      </div>

      {!readOnly && (
        <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={statusValue || OPWDD_EVAL_STATUS.NEEDED}
            onChange={(e) => onChangeStatus(e.target.value)}
            style={{ ...inputStyle(t), width: 'auto', flex: '0 1 auto' }}
          >
            {OPWDD_EVAL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <DatePickButton t={t} label="Schedule" onPick={(iso) => onScheduled(iso)} />
          <DatePickButton t={t} label="Received" onPick={(iso) => onReceived(iso)} color={palette.accentGreen.hex} />
          {validityYears > 0 && (
            <span style={{ fontSize: t.fontMuted - 0.5, color: '#999' }}>valid {validityYears}y</span>
          )}
        </div>
      )}
    </div>
  );
}

function DatePickButton({ t, label, onPick, color }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(new Date().toISOString().slice(0, 10));
  if (open) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input type="date" value={val} onChange={(e) => setVal(e.target.value)} style={{ ...inputStyle(t), width: 'auto' }} />
        <button
          onClick={() => { onPick?.(new Date(val).toISOString()); setOpen(false); }}
          style={{ padding: `${t.inputPadY}px ${t.inputPadX}px`, border: 'none', borderRadius: 6, background: color || palette.primaryDeepPlum.hex, color: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 650, cursor: 'pointer' }}
        >Save</button>
        <button onClick={() => setOpen(false)} style={{ padding: `${t.inputPadY}px ${t.inputPadX}px`, background: 'none', border: `1px solid var(--color-border)`, borderRadius: 6, fontSize: t.fontMuted, cursor: 'pointer' }}>×</button>
      </span>
    );
  }
  return (
    <button
      onClick={() => setOpen(true)}
      style={{ padding: `${t.inputPadY}px ${t.inputPadX}px`, border: `1px solid var(--color-border)`, borderRadius: 6, background: palette.backgroundLight.hex, fontSize: t.fontMuted, fontWeight: 650, cursor: 'pointer', color: color || palette.backgroundDark.hex }}
    >
      {label}
    </button>
  );
}

function ChecklistRow({ t, item, readOnly, onOpenReview, onOpenFiles, resolveUser }) {
  const pill = CHECKLIST_STATUS_PILL[item.status] || CHECKLIST_STATUS_PILL[OPWDD_CHECKLIST_STATUS.MISSING];
  const expired = useMemo(
    () => !!(item.expires_at && new Date(item.expires_at).getTime() < Date.now()),
    [item.expires_at],
  );

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: `${t.cardPadY - 4}px ${t.cardPadX - 2}px`,
        border: `1px solid var(--color-border)`, borderRadius: 6,
        background: palette.backgroundLight.hex,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: t.fontBase - 0.5, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.requirement_label || item.requirement_key}
          {item.is_required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
        </p>
        {(item.received_at || item.expires_at) && (
          <p style={{ fontSize: t.fontMuted - 1, color: '#888', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.received_at && `Rcvd ${fmtShort(item.received_at)}`}
            {item.received_by_id && ` · ${resolveUser(item.received_by_id)}`}
            {item.expires_at && (
              <span style={{ color: expired ? '#B91C1C' : '#15803d', marginLeft: 3 }}>
                · {expired ? 'EXPIRED ' : 'til '}{fmtShort(item.expires_at)}
              </span>
            )}
          </p>
        )}
      </div>
      <span style={{ fontSize: t.fontMuted - 0.5, fontWeight: 650, padding: '1px 6px', borderRadius: 12, background: expired ? '#FEE2E2' : pill.bg, color: expired ? '#B91C1C' : pill.fg, flexShrink: 0 }}>
        {expired ? 'Expired' : pill.label}
      </span>
      {!readOnly && (
        <>
          <button onClick={onOpenReview}
            title="Update status"
            style={{ padding: `${t.inputPadY - 2}px ${t.inputPadX - 2}px`, border: `1px solid var(--color-border)`, borderRadius: 5, background: palette.backgroundLight.hex, fontSize: t.fontMuted - 0.5, fontWeight: 650, cursor: 'pointer', flexShrink: 0 }}
          >
            Edit
          </button>
          {onOpenFiles && (
            <button onClick={onOpenFiles}
              title="Open Files tab to upload or link"
              style={{ padding: `${t.inputPadY - 2}px ${t.inputPadX - 2}px`, border: `1px solid var(--color-border)`, borderRadius: 5, background: palette.backgroundLight.hex, fontSize: t.fontMuted - 0.5, fontWeight: 650, cursor: 'pointer', color: palette.accentBlue.hex, flexShrink: 0 }}
            >
              Files
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ChecklistItemReviewModal({ t, item, appUserId, onClose, onUpdated }) {
  const [status, setStatus] = useState(item.status || OPWDD_CHECKLIST_STATUS.MISSING);
  const [isRequired, setIsRequired] = useState(!!item.is_required);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const patch = { status, is_required: isRequired, notes };
      if (status === OPWDD_CHECKLIST_STATUS.REQUESTED && !item.requested_at) {
        patch.requested_at = now;
        patch.requested_by_id = appUserId;
      }
      if (status === OPWDD_CHECKLIST_STATUS.RECEIVED && !item.received_at) {
        await markChecklistItemReceived({ item, receivedByUserId: appUserId, actorUserId: appUserId });
      } else if (status === OPWDD_CHECKLIST_STATUS.ACCEPTED) {
        await markChecklistItemAccepted({ item, reviewedByUserId: appUserId, actorUserId: appUserId });
      } else {
        if (status === OPWDD_CHECKLIST_STATUS.REJECTED) {
          patch.reviewed_at = now;
          patch.reviewed_by_id = appUserId;
          await recordActivity({
            actorUserId: appUserId,
            action: OPWDD_AUDIT_ACTION.CHECKLIST_ITEM_REJECTED,
            patientId: item.patient_id, referralId: item.referral_id,
            detail: `Rejected: ${item.requirement_label || item.requirement_key}.`,
            metadata: { caseId: item.opwdd_case_id, requirementKey: item.requirement_key, notes },
          }).catch(() => {});
        }
        if (status === OPWDD_CHECKLIST_STATUS.REQUESTED && !item.requested_at) {
          await recordActivity({
            actorUserId: appUserId,
            action: OPWDD_AUDIT_ACTION.CHECKLIST_ITEM_REQUESTED,
            patientId: item.patient_id, referralId: item.referral_id,
            detail: `Requested: ${item.requirement_label || item.requirement_key}.`,
            metadata: { caseId: item.opwdd_case_id, requirementKey: item.requirement_key },
          }).catch(() => {});
        }
        await updateChecklistItem(item._id, patch);
      }
      onUpdated();
    } catch (err) {
      console.error('Checklist item update failed', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={item.requirement_label || item.requirement_key} onClose={onClose}>
      <Field t={t} label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle(t)}>
          {OPWDD_CHECKLIST_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field t={t} label="Required?">
        <label style={{ fontSize: t.fontBase, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
          <span>Required for this case</span>
        </label>
      </Field>
      <Field t={t} label="Notes">
        <textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} />
      </Field>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={onClose} style={secondaryBtn(t)} disabled={saving}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn(t, { disabled: saving, color: palette.primaryDeepPlum.hex })} data-testid="opwdd-checklist-save">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div role="dialog" onClick={(e) => e.target === e.currentTarget && onClose?.()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
    }}>
      <div style={{ width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', borderRadius: 8, background: palette.backgroundLight.hex, padding: 20, border: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 14 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function addYears(iso, years) {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}
