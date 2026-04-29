/**
 * EligibilityWorkspace — the ONE eligibility UI rendered by both the drawer
 * tab and the module-page right panel. Both subscribe to the shared
 * `useEligibilityData` hook; triggerDataRefresh() keeps them in sync.
 *
 * Data sources for the insurance list:
 *   1. Real rows in the PatientInsurances table (once created in Airtable)
 *   2. Virtual entries derived from Patients.insurance_plans JSON (legacy)
 * The workspace surfaces both so staff can verify coverage TODAY, before
 * the new tables are migrated.
 */

import { useMemo, useState } from 'react';
import { useCurrentAppUser }   from '../../../hooks/useCurrentAppUser.js';
import { useLookups }          from '../../../hooks/useLookups.js';
import { usePermissions }      from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS }     from '../../../data/permissionKeys.js';
import { triggerDataRefresh }  from '../../../hooks/useRefreshTrigger.js';
import { createEligibilityVerification } from '../../../api/eligibilityVerifications.js';
import { createConflict }      from '../../../api/conflicts.js';
import { recordActivity }      from '../../../api/activityLog.js';
import { createDisenrollmentFlag } from '../../../api/disenrollmentFlags.js';
import { openCaseForReferral }  from '../../../store/opwddOrchestration.js';
import { ensureRealInsurance } from '../../../api/_insuranceMaterialize.js';
import palette                 from '../../../utils/colors.js';

import {
  INSURANCE_CATEGORY,
  INSURANCE_CATEGORY_OPTIONS,
  ORDER_RANK,
  ORDER_RANK_OPTIONS,
  VERIFICATION_STATUS,
  VERIFICATION_STATUS_OPTIONS,
  VERIFICATION_SOURCE_OPTIONS,
  NOTE_CATEGORY_OPTIONS,
  CONFLICT_REASON_OPTIONS,
  CONFLICT_SOURCE_MODULE,
  DISENROLLMENT_FLAG_TYPE,
  DISENROLLMENT_FLAG_STATUS,
  AUDIT_ACTION,
  FACILITY_SETTING,
  DIVISION,
} from '../../../data/eligibilityEnums.js';
import {
  normalizeInsuranceCategory,
  suggestSourceForCategory,
  determineEligibilityWarnings,
  shouldRequireHumanReview,
} from '../../../data/policies/eligibilityPolicies.js';
import { suggestNar } from '../../../data/policies/authorizationPolicies.js';
import { buildConflictRecord } from '../../../data/policies/conflictBuilder.js';
import { shouldSuggestOPWDDRouting } from '../../../data/policies/routingPolicies.js';
import { useEligibilityData } from './useEligibilityData.js';
import { tokens, inputStyle, primaryBtn, secondaryBtn, smallActionBtn, sectionHeading, cardStyle, STATUS_PILL_MAP } from './workspaceStyles.js';

/**
 * @param {object} props
 * @param {object} props.patient      Required
 * @param {object} [props.referral]
 * @param {boolean} [props.readOnly]
 * @param {'panel'|'drawer'} [props.variant]
 * @param {function} [props.onInitiateTransition]
 * @param {function} [props.onAdvanceToAuthorization]
 */
export default function EligibilityWorkspace({
  patient,
  referral,
  readOnly = false,
  variant = 'drawer',
  onAdvanceToAuthorization,
  onInitiateTransition,
}) {
  const t = tokens(variant);
  const { appUser, appUserId, appUserName } = useCurrentAppUser();
  const verifierRecordId = appUser?._id || null; // Users link fields need Airtable rec id
  const { resolveUser } = useLookups();
  const { can } = usePermissions();

  const {
    loading,
    insurances,
    latestVerByInsurance,
    activeInsurances,
    legacyChecks,
    disenrollFlags,
  } = useEligibilityData({ patient, patientId: patient?.id, referralId: referral?.id });

  const [conflictModal,  setConflictModal]  = useState(null);
  const [disenrollModal, setDisenrollModal] = useState(null);
  const [editingInsuranceId, setEditingInsuranceId] = useState(null);

  const canEdit = !readOnly && can(PERMISSION_KEYS.CLINICAL_ELIGIBILITY);

  // ── Policy helpers (pure) ────────────────────────────────────────────────
  const warnings = useMemo(() => determineEligibilityWarnings(
    insurances.map((ins) => ({
      insuranceId: ins._id,
      verificationStatus: latestVerByInsurance.get(ins._id)?.verification_status || VERIFICATION_STATUS.UNREVIEWED,
      staffConfirmedOrderRank: latestVerByInsurance.get(ins._id)?.staff_confirmed_order_rank,
      verificationSources: latestVerByInsurance.get(ins._id)?.verification_sources,
    })),
  ), [insurances, latestVerByInsurance]);

  const narSuggestion = useMemo(() => {
    const confirmed = activeInsurances.map((ins) => ({
      insuranceCategory: latestVerByInsurance.get(ins._id)?.staff_confirmed_payer_type || ins.insurance_category,
    }));
    return suggestNar(confirmed);
  }, [activeInsurances, latestVerByInsurance]);

  const opwddSuggestion = useMemo(() => shouldSuggestOPWDDRouting({
    code95: referral?.code_95,
    clinicalCategory: referral?.clinical_category,
    snAgeGroup: referral?.sn_age_group,
  }), [referral?.code_95, referral?.clinical_category, referral?.sn_age_group]);

  const isALF = referral?.division === DIVISION.ALF ||
                patient?.facility_setting === FACILITY_SETTING.ALF;

  const openDisenrollFlags = disenrollFlags.filter((f) =>
    f.status !== DISENROLLMENT_FLAG_STATUS.COMPLETED &&
    f.status !== DISENROLLMENT_FLAG_STATUS.CANCELLED);

  if (!patient) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: t.fontBase, color: '#888' }}>Select a patient to verify insurance coverage.</p>
      </div>
    );
  }

  return (
    <div data-testid="eligibility-workspace" data-variant={variant} style={{ padding: variant === 'panel' ? '14px 12px' : '18px 20px 40px' }}>

      {/* ALF badge — terse */}
      {isALF && <InlineTag t={t} color="#005B84" label="ALF: bill primary only" />}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div data-testid="eligibility-warnings" style={{ marginBottom: t.sectionGap - 6 }}>
          {warnings.map((w) => (
            <p key={`${w.code}-${w.insuranceId || ''}`} style={{ fontSize: t.fontMuted, color: '#92400E', lineHeight: 1.4, marginBottom: 2 }}>
              {w.message}
            </p>
          ))}
        </div>
      )}

      {/* NAR suggestion */}
      {narSuggestion.suggestNar && (
        <p data-testid="nar-suggestion" style={{ fontSize: t.fontMuted, color: '#15803d', lineHeight: 1.4, marginBottom: t.sectionGap - 6 }}>
          Suggest NAR: straight Medicare + Medicaid only. Confirm in Authorization.
        </p>
      )}

      {/* Insurances */}
      <div style={{ marginBottom: t.sectionGap }}>
        <p style={sectionHeading(t)}>Insurances ({insurances.length})</p>
        {loading && insurances.length === 0 && (
          <p style={{ fontSize: t.fontMuted, color: '#888' }}>Loading.</p>
        )}
        {!loading && insurances.length === 0 && (
          <p style={{ fontSize: t.fontMuted, color: '#888' }}>
            No insurance on Demographics. Add it there first.
          </p>
        )}
        {insurances.map((ins) => (
          <InsuranceCard
            key={ins._id}
            t={t}
            insurance={ins}
            verification={latestVerByInsurance.get(ins._id)}
            isEditing={editingInsuranceId === ins._id}
            readOnly={!canEdit}
            resolveUser={resolveUser}
            onEdit={() => setEditingInsuranceId(ins._id)}
            onCancel={() => setEditingInsuranceId(null)}
            onSaved={() => { setEditingInsuranceId(null); triggerDataRefresh(); }}
            onSendToConflict={() => setConflictModal({
              insurance: ins,
              selectedReasons: [],
              details: '',
              denialStatus: VERIFICATION_STATUS.DENIED_NOT_FOUND,
            })}
            appUserId={appUserId}
            appUserName={appUserName}
            patientRecordId={patient._id}
            patientBusinessId={patient.id}
            verifierRecordId={appUserId}
            referralId={referral?.id}
          />
        ))}
      </div>

      {/* Actions */}
      {canEdit && insurances.length > 0 && (
        <div style={{ marginBottom: t.sectionGap }}>
          <p style={sectionHeading(t)}>Actions</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Forward — main CTA when at least one insurance is active */}
            {activeInsurances.length > 0 ? (
              <WsBtn variant="forward" label="Continue to Authorization Pending →"
                onClick={() => {
                  onAdvanceToAuthorization?.();
                  onInitiateTransition?.(referral, 'Authorization Pending');
                }}
                testId="action-advance-auth" />
            ) : (
              <WsBtn variant="forward" label="Continue to Clinical Intake RN Review →"
                onClick={() => onInitiateTransition?.(referral, 'Clinical Intake RN Review')}
                testId="action-clinical-review" />
            )}

            {/* Secondary forwards */}
            <WsBtn variant="success" label="Back to Intake"
              onClick={() => onInitiateTransition?.(referral, 'Intake')}
              testId="action-back-intake" />

            {opwddSuggestion.suggest && can(PERMISSION_KEYS.ROUTING_OPWDD) && (
              <WsBtn variant="success" label="Route to OPWDD Enrollment"
                onClick={async () => {
                  await recordActivity({
                    actorUserId: appUserId,
                    action: AUDIT_ACTION.OPWDD_ROUTE_TRIGGERED,
                    patientId: patient.id,
                    referralId: referral?.id,
                    detail: 'Eligibility routed case to OPWDD flow.',
                    metadata: { reasons: opwddSuggestion.reasons, priorStage: referral?.current_stage || null },
                  });
                  // Auto-open the OPWDD eligibility case so the enrollment
                  // specialist inherits a fully-seeded checklist. This is
                  // idempotent — `openCaseForReferral` returns the existing
                  // case if one is already open for this referral.
                  if (patient?.id && referral?.id) {
                    openCaseForReferral({
                      referral: { id: referral.id, _id: referral._id },
                      patientId: patient.id,
                      actorUserId: appUserId,
                      assignedSpecialistId: appUserId,
                    }).catch((err) => console.warn('Auto-open OPWDD case from eligibility failed:', err));
                  }
                  onInitiateTransition?.(referral, 'OPWDD Enrollment');
                  triggerDataRefresh();
                }}
                testId="action-opwdd-route" />
            )}

            <WsBtn variant="warning" label="Flag Disenrollment Assist"
              onClick={() => setDisenrollModal({ note: '', followUpDate: '', followUpOwnerUserId: '' })}
              testId="action-disenrollment-assist" />

            <WsBtn variant="danger" label="Send to Conflict"
              onClick={() => setConflictModal({ insurance: null, selectedReasons: [], details: '', denialStatus: null })}
              testId="action-send-to-conflict" />
          </div>
        </div>
      )}

      {/* Open disenrollment flags */}
      {openDisenrollFlags.length > 0 && (
        <div style={{ marginBottom: t.sectionGap }}>
          <p style={sectionHeading(t)}>Disenrollment Assistance</p>
          {openDisenrollFlags.map((f) => (
            <div key={f._id} data-testid="disenroll-flag" style={{ ...cardStyle(t), padding: `${t.cardPadY - 2}px ${t.cardPadX}px` }}>
              <p style={{ fontSize: t.fontBase, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                Expert Medicaid Assist
              </p>
              <p style={{ fontSize: t.fontMuted, color: '#555', lineHeight: 1.35 }}>
                {f.note}
              </p>
              <p style={{ fontSize: t.fontMuted, color: '#888', marginTop: 2 }}>
                Follow-up {f.follow_up_date ? new Date(f.follow_up_date).toLocaleDateString() : 'TBD'}
                {f.follow_up_owner_user_id ? ` · ${resolveUser(f.follow_up_owner_user_id)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Legacy fallback */}
      {insurances.length === 0 && legacyChecks.length > 0 && (
        <div style={{ ...cardStyle(t), padding: `${t.cardPadY}px ${t.cardPadX}px` }}>
          <p style={{ ...sectionHeading(t), marginBottom: 4 }}>Legacy Check</p>
          <p style={{ fontSize: t.fontMuted, color: '#555', lineHeight: 1.4 }}>
            {legacyChecks[0]?.result_summary || 'Legacy check on record.'}
          </p>
        </div>
      )}

      {conflictModal && (
        <ConflictModal
          t={t}
          state={conflictModal}
          onChange={setConflictModal}
          onCancel={() => setConflictModal(null)}
          onConfirm={async ({ reasons, details, denialStatus }) => {
            const patientRecordId = patient._id;
            const { record, audit } = buildConflictRecord({
              patientId: patientRecordId,          // link field — Airtable rec id
              referralId: referral?.id,
              sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
              reasons,
              createdByUserId: verifierRecordId,   // link field — Airtable rec id
              details,
            });
            try {
              await createConflict(record);
              await recordActivity({ ...audit, actorUserId: appUserId, patientId: patient.id });
              if (conflictModal.insurance) {
                const realInsId = await ensureRealInsurance(conflictModal.insurance, { patientRecordId });
                await createEligibilityVerification({
                  patient_id: patientRecordId,
                  insurance_id: realInsId,
                  verification_status: denialStatus || VERIFICATION_STATUS.DENIED_NOT_FOUND,
                  verified_by_user_id: verifierRecordId || undefined,
                  verification_date_time: new Date().toISOString(),
                });
              }
              await recordActivity({
                actorUserId: appUserId,
                action: AUDIT_ACTION.ELIGIBILITY_SENT_TO_CONFLICT,
                patientId: patient.id,
                referralId: referral?.id,
                detail: `Eligibility to Conflict: ${reasons.join(', ')}`,
                metadata: { reasons, details: details || null },
              });
              setConflictModal(null);
              onInitiateTransition?.(referral, 'Conflict');
              triggerDataRefresh();
            } catch (err) {
              console.error('Conflict save failed', err);
            }
          }}
        />
      )}

      {disenrollModal && (
        <DisenrollmentAssistModal
          t={t}
          state={disenrollModal}
          onChange={setDisenrollModal}
          onCancel={() => setDisenrollModal(null)}
          onConfirm={async ({ note, followUpDate, followUpOwnerUserId }) => {
            try {
              await createDisenrollmentFlag({
                patient_id: patient._id,
                // referral_id is a multipleRecordLinks field — pass the Airtable rec id
                referral_id: referral?._id || undefined,
                flag_type: DISENROLLMENT_FLAG_TYPE.EXPERT_MEDICAID_ASSIST,
                note,
                follow_up_date: followUpDate,
                // owner & creator are Users link fields — expect Airtable rec ids.
                // If the caller typed a business id we pass it through and rely on
                // Airtable's forgiving behaviour (fails validation if missing).
                follow_up_owner_user_id: followUpOwnerUserId,
                status: DISENROLLMENT_FLAG_STATUS.OPEN,
                created_by_user_id: verifierRecordId || undefined,
              });
              await recordActivity({
                actorUserId: appUserId,
                action: AUDIT_ACTION.DISENROLLMENT_ASSIST_FLAGGED,
                patientId: patient.id,
                referralId: referral?.id,
                detail: 'Flagged for expert Medicaid disenrollment assistance.',
                metadata: { note, followUpDate, followUpOwnerUserId },
              });
              setDisenrollModal(null);
              triggerDataRefresh();
            } catch (err) {
              console.error('Disenrollment flag save failed', err);
            }
          }}
        />
      )}
    </div>
  );
}

// ── InlineTag ──────────────────────────────────────────────────────────────
function InlineTag({ t, label, color }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: t.fontMuted,
      color: '#fff',
      background: color,
      padding: '3px 9px',
      borderRadius: 4,
      marginBottom: t.sectionGap - 6,
      fontWeight: 600,
    }}>{label}</span>
  );
}

// Matches the module-page ActionBtn styling in StagePanel.jsx so routing
// buttons look identical across module panels + drawer.
function WsBtn({ variant = 'default', label, onClick, disabled, testId }) {
  const styles = {
    forward: { bg: palette.accentGreen.hex,      color: palette.backgroundLight.hex,    pad: '11px 14px', size: 13.5, weight: 700 },
    success: { bg: palette.backgroundLight.hex,  color: '#15803d',                       pad: '8px 12px',  size: 12.5, weight: 650, border: '1px solid #15803d' },
    warning: { bg: palette.highlightYellow.hex,  color: palette.backgroundDark.hex,     pad: '8px 12px',  size: 12.5, weight: 650 },
    danger:  { bg: palette.accentOrange.hex,     color: palette.backgroundLight.hex,    pad: '8px 12px',  size: 12.5, weight: 650 },
    default: { bg: '#F0F0F0',                    color: '#555',                         pad: '7px 12px',  size: 12,   weight: 600 },
  };
  const s = styles[variant] || styles.default;
  return (
    <button
      data-testid={testId}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: s.pad,
        borderRadius: 8,
        fontSize: s.size,
        fontWeight: s.weight,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: s.bg,
        color: s.color,
        border: s.border || 'none',
        textAlign: 'left',
        opacity: disabled ? 0.45 : 1,
        letterSpacing: variant === 'forward' ? '-0.01em' : 'normal',
        transition: 'filter 0.12s',
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = 'brightness(1.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {label}
    </button>
  );
}

// ── InsuranceCard with verify form ─────────────────────────────────────────
function InsuranceCard({
  t, insurance, verification, isEditing, readOnly, resolveUser,
  onEdit, onCancel, onSaved, onSendToConflict,
  appUserId, appUserName, patientRecordId, patientBusinessId, verifierRecordId, referralId,
}) {
  const suggestion = normalizeInsuranceCategory({ rawLabel: insurance.payer_display_name });

  const [status, setStatus]     = useState(verification?.verification_status || VERIFICATION_STATUS.UNREVIEWED);
  const [sources, setSources]   = useState(verification?.verification_sources || []);
  const [order, setOrder]       = useState(verification?.staff_confirmed_order_rank || insurance.order_rank || ORDER_RANK.UNKNOWN);
  const [payerType, setPayerType] = useState(verification?.staff_confirmed_payer_type || insurance.insurance_category || INSURANCE_CATEGORY.UNKNOWN);
  const [noteCat, setNoteCat]   = useState(verification?.note_category || 'general');
  const [noteText, setNoteText] = useState(verification?.note_text || '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  function openWithDefaultSources() {
    if (sources.length === 0) {
      const defaults = suggestSourceForCategory(payerType);
      if (defaults.length > 0) setSources(defaults);
    }
    onEdit?.();
  }

  function toggleSource(s) {
    setSources((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function save() {
    if (readOnly) return;
    if (!patientRecordId) {
      setError('Patient Airtable record id missing; cannot persist link.');
      return;
    }
    setSaving(true); setError(null);
    try {
      // Virtual insurance rows (demo:pat:plan) must be promoted to real
      // PatientInsurances records before we can write a link-field value.
      const realInsuranceId = await ensureRealInsurance(insurance, { patientRecordId });

      await createEligibilityVerification({
        patient_id: patientRecordId,
        insurance_id: realInsuranceId,
        verification_status: status,
        staff_confirmed_payer_type: payerType,
        staff_confirmed_order_rank: order,
        verification_sources: sources,
        verification_date_time: new Date().toISOString(),
        verified_by_user_id: verifierRecordId || undefined,
        note_category: noteCat,
        note_text: noteText,
        suggested_payer_type: suggestion.category,
        requires_human_review: shouldRequireHumanReview({
          verificationStatus: status,
          verificationSources: sources,
          staffConfirmedOrderRank: order,
          suggestedPayerType: suggestion.category,
          staffConfirmedPayerType: payerType,
        }).required,
      });
      await recordActivity({
        actorUserId: appUserId,
        action: AUDIT_ACTION.ELIGIBILITY_CHECKED,
        patientId: patientBusinessId,
        referralId,
        detail: `Eligibility ${status} for ${insurance.payer_display_name}`,
        metadata: { insuranceId: realInsuranceId, sources, order, payerType },
      });
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const pill = STATUS_PILL_MAP[verification?.verification_status || VERIFICATION_STATUS.UNREVIEWED];

  return (
    <div data-testid="insurance-card" style={cardStyle(t)}>
      {/* Header */}
      <div style={{ padding: `${t.cardPadY}px ${t.cardPadX}px`, borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: t.fontBase + 0.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {insurance.payer_display_name || 'Unnamed payer'}
            </p>
            <p style={{ fontSize: t.fontMuted, color: '#666' }}>
              {meta([
                catLabel(insurance.insurance_category),
                insurance.order_rank ? orderLabel(insurance.order_rank) : null,
                insurance.member_id ? `Member ${insurance.member_id}` : null,
                insurance._virtual ? 'from Demographics' : null,
              ])}
            </p>
          </div>
          <span style={{
            fontSize: t.fontMuted - 0.5, fontWeight: 650,
            padding: '2px 9px', borderRadius: 20,
            background: pill.bg, color: pill.fg, flexShrink: 0,
          }}>{pill.label}</span>
        </div>
      </div>

      {/* Collapsed body */}
      {!isEditing && (
        <div style={{ padding: `${t.cardPadY - 2}px ${t.cardPadX}px`, fontSize: t.fontMuted }}>
          {verification?.verification_date_time && (
            <p style={{ color: '#666', marginBottom: 4 }}>
              {new Date(verification.verification_date_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} by {resolveUser(verification.verified_by_user_id)}
            </p>
          )}
          {Array.isArray(verification?.verification_sources) && verification.verification_sources.length > 0 && (
            <p style={{ color: '#666', marginBottom: 4 }}>Sources: {verification.verification_sources.join(', ')}</p>
          )}
          {verification?.note_text && (
            <p style={{ marginTop: 4, padding: `${t.inputPadY}px ${t.inputPadX}px`, borderRadius: 6, background: '#F7F7F7', color: '#555', lineHeight: 1.4 }}>
              <b>{verification.note_category || 'note'}:</b> {verification.note_text}
            </p>
          )}
          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={openWithDefaultSources} data-testid="verify-btn"
                style={smallActionBtn(t, { color: palette.accentGreen.hex, filled: !verification })}>
                {verification ? 'Update Check' : 'Log Check'}
              </button>
              <button onClick={onSendToConflict} data-testid="send-conflict-btn"
                style={smallActionBtn(t, { color: palette.primaryMagenta.hex })}>
                Send to Conflict
              </button>
            </div>
          )}
        </div>
      )}

      {/* Editing body */}
      {isEditing && (
        <div style={{ padding: `${t.cardPadY - 2}px ${t.cardPadX}px ${t.cardPadY}px` }}>
          <Field t={t} label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle(t)} data-testid="status-select">
              {VERIFICATION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field t={t} label="Payer Type (staff-confirmed)">
            <select value={payerType} onChange={(e) => setPayerType(e.target.value)} style={inputStyle(t)} data-testid="payer-type-select">
              {INSURANCE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {suggestion.category !== INSURANCE_CATEGORY.UNKNOWN && suggestion.category !== payerType && (
              <p style={{ fontSize: t.fontMuted - 0.5, color: '#888', marginTop: 3 }}>
                Suggested: {catLabel(suggestion.category)}
              </p>
            )}
          </Field>

          <Field t={t} label="Payer Order">
            <select value={order} onChange={(e) => setOrder(e.target.value)} style={inputStyle(t)} data-testid="order-select">
              {ORDER_RANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field t={t} label="Source(s) checked">
            <div data-testid="source-checkboxes" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {VERIFICATION_SOURCE_OPTIONS.map((s) => (
                <label key={s.value} style={{ fontSize: t.fontBase - 0.5, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sources.includes(s.value)} onChange={() => toggleSource(s.value)} data-testid={`source-${s.value}`} />
                  <span>{s.label}</span>
                  {s.hint && <span style={{ color: '#999', fontSize: t.fontMuted - 0.5 }}>{s.hint}</span>}
                </label>
              ))}
            </div>
          </Field>

          <Field t={t} label="Note Category">
            <select value={noteCat} onChange={(e) => setNoteCat(e.target.value)} style={inputStyle(t)}>
              {NOTE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field t={t} label="Note">
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
              style={{ ...inputStyle(t), resize: 'vertical' }}
              placeholder="Findings, observations, portal reference." />
            {appUserName && (
              <p style={{ fontSize: t.fontMuted - 1, color: '#999', marginTop: 3 }}>
                Logged by {appUserName}
              </p>
            )}
          </Field>

          {error && <p style={{ fontSize: t.fontMuted, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onCancel} disabled={saving} style={secondaryBtn(t)}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn(t, { disabled: saving })} data-testid="save-verification">
              {saving ? 'Saving' : 'Save Check'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conflict modal ─────────────────────────────────────────────────────────
function ConflictModal({ t, state, onChange, onCancel, onConfirm }) {
  const { selectedReasons, details, denialStatus, insurance } = state;
  const insuranceId = insurance?._id || null;
  function toggle(r) {
    onChange({ ...state, selectedReasons: selectedReasons.includes(r) ? selectedReasons.filter((x) => x !== r) : [...selectedReasons, r] });
  }
  const disabled = selectedReasons.length === 0;
  return (
    <div role="dialog" data-testid="conflict-modal" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
    }}>
      <div style={{ width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', borderRadius: 8, background: palette.backgroundLight.hex, padding: 20, border: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>Send to Conflict</h3>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          Select at least one reason.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
          {CONFLICT_REASON_OPTIONS.map((r) => (
            <label key={r.value} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedReasons.includes(r.value)} onChange={() => toggle(r.value)} data-testid={`conflict-reason-${r.value}`} />
              {r.label}
            </label>
          ))}
        </div>
        {insuranceId && (
          <Field t={t} label="Insurance Status to Record">
            <select value={denialStatus || ''} onChange={(e) => onChange({ ...state, denialStatus: e.target.value })} style={inputStyle(t)} data-testid="denial-status">
              <option value={VERIFICATION_STATUS.DENIED_NOT_FOUND}>Denied / Not Found</option>
              <option value={VERIFICATION_STATUS.CONFIRMED_INACTIVE}>Confirmed Inactive</option>
              <option value={VERIFICATION_STATUS.UNABLE_TO_VERIFY}>Unable to Verify</option>
            </select>
          </Field>
        )}
        <Field t={t} label="Details (optional)">
          <textarea value={details} onChange={(e) => onChange({ ...state, details: e.target.value })} rows={3} style={{ ...inputStyle(t), resize: 'vertical' }} placeholder="Context for the team working this conflict." />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={onCancel} style={secondaryBtn(t)}>Cancel</button>
          <button
            data-testid="conflict-confirm"
            onClick={() => onConfirm({ reasons: selectedReasons, details, denialStatus })}
            disabled={disabled}
            style={primaryBtn(t, { disabled, color: palette.primaryMagenta.hex })}
          >
            Send to Conflict
          </button>
        </div>
      </div>
    </div>
  );
}

function DisenrollmentAssistModal({ t, state, onChange, onCancel, onConfirm }) {
  const { note, followUpDate, followUpOwnerUserId } = state;
  const disabled = !(note && note.trim() && followUpDate && followUpOwnerUserId);
  return (
    <div role="dialog" data-testid="disenroll-modal" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
    }}>
      <div style={{ width: 440, maxWidth: '92vw', borderRadius: 8, background: palette.backgroundLight.hex, padding: 20, border: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>Flag Expert Disenrollment Assist</h3>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>Note + follow-up date + owner required.</p>
        <Field t={t} label="Note *">
          <textarea value={note} onChange={(e) => onChange({ ...state, note: e.target.value })} rows={3}
            style={{ ...inputStyle(t), resize: 'vertical' }}
            placeholder="Context for the expert Medicaid partner."
            data-testid="disenroll-note" />
        </Field>
        <Field t={t} label="Follow-up Date *">
          <input type="date" value={followUpDate} onChange={(e) => onChange({ ...state, followUpDate: e.target.value })} style={inputStyle(t)} data-testid="disenroll-follow-up-date" />
        </Field>
        <Field t={t} label="Follow-up Owner (user id) *">
          <input type="text" value={followUpOwnerUserId} onChange={(e) => onChange({ ...state, followUpOwnerUserId: e.target.value })} style={inputStyle(t)} placeholder="user id" data-testid="disenroll-owner" />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={onCancel} style={secondaryBtn(t)}>Cancel</button>
          <button
            data-testid="disenroll-confirm"
            onClick={() => onConfirm({ note, followUpDate, followUpOwnerUserId })}
            disabled={disabled}
            style={primaryBtn(t, { disabled, color: palette.accentOrange.hex })}
          >
            Create Flag
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ t, label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#555', marginBottom: 3 }}>{label}</p>
      {children}
    </div>
  );
}

function meta(parts) {
  return parts.filter(Boolean).join(' · ');
}
function catLabel(v) {
  if (!v) return '';
  const m = INSURANCE_CATEGORY_OPTIONS.find((o) => o.value === v);
  return m ? m.label : v;
}
function orderLabel(v) {
  if (!v) return '';
  const m = ORDER_RANK_OPTIONS.find((o) => o.value === v);
  return m ? m.label : v;
}
