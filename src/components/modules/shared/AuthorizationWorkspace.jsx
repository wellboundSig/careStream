/**
 * AuthorizationWorkspace — the ONE authorization UI.
 *
 * Rendered by:
 *   - AuthorizationsTab.jsx (patient drawer — variant="drawer")
 *   - StagePanel.jsx        (module-page right panel — variant="panel")
 *
 * Both surfaces share `useAuthorizationData`; writes call
 * `triggerDataRefresh()` so the two views stay synchronized.
 *
 * Safety posture:
 * - Denial NEVER routes to NTUC. Allowed next-actions are driven by
 *   `determineAllowedAuthorizationPaths`.
 * - Approved requires auth number OR documented exception; policy-validated.
 * - Follow-up requires date + owner; policy-validated.
 * - ABA never appears. HHA is blocked for ALF.
 * - NAR is a first-class status; staff must confirm (never auto-finalised),
 *   but the workspace surfaces a suggestion banner when the policy says so.
 */

import { useMemo, useState } from 'react';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { createAuthorization } from '../../../api/authorizations.js';
import { createConflict } from '../../../api/conflicts.js';
import { recordActivity } from '../../../api/activityLog.js';
import { ensureRealInsurance } from '../../../api/_insuranceMaterialize.js';
import palette from '../../../utils/colors.js';
import {
  AUTH_STATUS,
  AUTH_STATUS_OPTIONS,
  AUTH_UNIT_TYPE,
  AUTH_UNIT_TYPE_OPTIONS,
  DIVISION,
  ROUTING_ACTION,
  INSURANCE_CATEGORY,
  CONFLICT_REASON,
  CONFLICT_SOURCE_MODULE,
  AUDIT_ACTION,
} from '../../../data/eligibilityEnums.js';
import {
  validateAuthorizationRecord,
  determineAllowedAuthorizationPaths,
  suggestNar,
  validateFollowUp,
} from '../../../data/policies/authorizationPolicies.js';
import { determineAllowedServicesByDivision } from '../../../data/policies/serviceAvailabilityPolicies.js';
import { buildConflictRecord } from '../../../data/policies/conflictBuilder.js';
import { useAuthorizationData } from './useAuthorizationData.js';
import { tokens, inputStyle, primaryBtn, secondaryBtn, chipBtn, sectionHeading, cardStyle } from './workspaceStyles.js';

const STATUS_DISPLAY = {
  [AUTH_STATUS.NAR]:              'NAR',
  [AUTH_STATUS.PENDING]:          'Pending',
  [AUTH_STATUS.APPROVED]:         'Approved',
  [AUTH_STATUS.DENIED]:           'Denied',
  [AUTH_STATUS.FOLLOW_UP_NEEDED]: 'Follow-Up',
};

const STATUS_COLORS = {
  Pending:     { bg: '#FEF3C7', text: '#92400E' },
  Approved:    { bg: '#DCFCE7', text: '#15803d' },
  Denied:      { bg: '#FEE2E2', text: '#B91C1C' },
  NAR:         { bg: '#DBEAFE', text: '#1E40AF' },
  'Follow-Up': { bg: '#FFEDD5', text: '#9A3412' },
};

/**
 * @param {object} props
 * @param {object} props.patient
 * @param {object} [props.referral]
 * @param {boolean} [props.readOnly]
 * @param {'panel'|'drawer'} [props.variant]
 * @param {function} [props.onInitiateTransition]
 */
export default function AuthorizationWorkspace({
  patient, referral, readOnly = false, variant = 'drawer', onInitiateTransition,
}) {
  const t = tokens(variant);
  const { can } = usePermissions();
  const { appUser, appUserId } = useCurrentAppUser();
  const patientRecordId = patient?._id || null;
  const verifierRecordId = appUser?._id || null;

  const division = referral?.division === DIVISION.ALF ? DIVISION.ALF : DIVISION.SPECIAL_NEEDS;
  const { allowed: AUTH_SERVICES, blocked: BLOCKED_SERVICES } = determineAllowedServicesByDivision({ division });

  const {
    loading,
    authorizations,
    insurances,
    activeInsurances,
    latestAuth,
  } = useAuthorizationData({ patient, patientId: patient?.id, referralId: referral?.id });

  // NAR suggestion based on confirmed-active insurances
  const narSuggestion = useMemo(() => suggestNar(
    activeInsurances.map((ins) => ({ insuranceCategory: ins.insurance_category })),
  ), [activeInsurances]);

  const canDecide = !readOnly && can(PERMISSION_KEYS.AUTH_DECIDE);
  const canSCA    = !readOnly && can(PERMISSION_KEYS.AUTH_REQUEST_SCA);

  const [mode, setMode] = useState(null); // null | 'pick' | 'approval' | 'denial' | 'nar' | 'pending' | 'follow_up'
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  // Shared form state
  const [payerInsuranceId, setPayerInsuranceId] = useState('');
  const [authNumber,  setAuthNumber]  = useState('');
  const [documentedException, setDocumentedException] = useState('');
  const [approvedDate, setApprovedDate] = useState('');
  const [windowStart, setWindowStart]   = useState('');
  const [windowEnd, setWindowEnd]       = useState('');
  const [visitLimit, setVisitLimit]     = useState('');
  const [unitType, setUnitType]         = useState(AUTH_UNIT_TYPE.VISIT);
  const [servicesAuth, setServicesAuth] = useState([]);
  const [denialReason, setDenialReason] = useState('');
  const [denialNextAction, setDenialNextAction] = useState(ROUTING_ACTION.SEND_TO_CONFLICT);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpOwnerId, setFollowUpOwnerId] = useState('');
  const [narNote, setNarNote] = useState('');
  const [notes, setNotes] = useState('');

  function reset() {
    setMode(null); setError(null); setSaving(false);
    setPayerInsuranceId(''); setAuthNumber(''); setDocumentedException('');
    setApprovedDate(''); setWindowStart(''); setWindowEnd(''); setVisitLimit('');
    setUnitType(AUTH_UNIT_TYPE.VISIT); setServicesAuth([]);
    setDenialReason(''); setDenialNextAction(ROUTING_ACTION.SEND_TO_CONFLICT);
    setFollowUpDate(''); setFollowUpOwnerId(''); setNarNote(''); setNotes('');
  }

  function openPicker() { reset(); setMode('pick'); }
  function toggleService(s) {
    if (!AUTH_SERVICES.includes(s)) return;
    setServicesAuth((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function saveAuth(payload) {
    if (!patientRecordId) { setError('Patient Airtable record id missing.'); return null; }

    const selectedId = payload.payer_insurance_id || payerInsuranceId || null;
    // If the user picked a virtual insurance entry, materialize it before
    // we can write payer_insurance_id (a multipleRecordLinks field).
    const selectedIns = insurances.find((ins) => ins._id === selectedId);
    let realPayerInsuranceId = null;
    if (selectedIns) {
      try {
        realPayerInsuranceId = await ensureRealInsurance(selectedIns, { patientRecordId });
      } catch (err) {
        setError(`Could not resolve insurance link: ${err.message}`);
        return null;
      }
    }

    const check = validateAuthorizationRecord({
      patientId: patientRecordId,
      payerInsuranceId: realPayerInsuranceId || 'unknown',
      authStatus: payload.auth_status,
      authNumber: payload.auth_number,
      authStartDate: payload.effective_start,
      authEndDate: payload.effective_end,
      authVisitLimit: payload.auth_visit_limit,
      denialReason: payload.denial_reason,
      followUpDate: payload.follow_up_date,
      followUpOwnerUserId: payload.follow_up_owner_user_id,
      documentedException: payload.documented_exception,
    });
    if (!check.valid) {
      setError(check.errors.map((e) => e.message).join(' '));
      return null;
    }
    setSaving(true); setError(null);
    try {
      const payerName = selectedIns?.payer_display_name || referral?.patient?.insurance_plan || '';
      const created = await createAuthorization({
        referral_id: referral.id,
        patient_id: patientRecordId,
        plan_name: payerName,
        payer_insurance_id: realPayerInsuranceId || undefined,
        status: STATUS_DISPLAY[payload.auth_status] || 'Pending',
        ...payload,
        // Force-override the scalar ids payload may have passed:
        ...(realPayerInsuranceId ? { payer_insurance_id: realPayerInsuranceId } : {}),
        decided_by_user_id: verifierRecordId || undefined,
      });
      await recordActivity({
        actorUserId: appUserId,
        action: auditActionFor(payload.auth_status),
        patientId: patient?.id,
        referralId: referral?.id,
        detail: `Authorization ${payload.auth_status} recorded for ${payerName || 'insurance'}.`,
        metadata: { authStatus: payload.auth_status, payerInsuranceId: realPayerInsuranceId || null },
      });
      reset();
      triggerDataRefresh();
      return created;
    } catch (err) {
      setError(err.message || 'Save failed');
      setSaving(false);
      return null;
    }
  }

  async function handleApproval() {
    await saveAuth({
      auth_status: AUTH_STATUS.APPROVED,
      payer_insurance_id: payerInsuranceId || null,
      approved_date: approvedDate,
      ...(authNumber.trim()       && { auth_number: authNumber.trim() }),
      ...(documentedException.trim() && { documented_exception: documentedException.trim() }),
      ...(windowStart && { effective_start: windowStart, auth_start_date: windowStart }),
      ...(windowEnd   && { effective_end:   windowEnd,   auth_end_date:   windowEnd }),
      ...(visitLimit  && { auth_visit_limit: Number(visitLimit), auth_unit_type: unitType }),
      ...(servicesAuth.length && { services_authorized: servicesAuth }),
      ...(notes.trim() && { notes: notes.trim() }),
    });
  }

  async function handleDenial() {
    const allowed = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED, division });
    if (!allowed.includes(denialNextAction)) {
      setError('Next action not allowed for this denial.'); return;
    }
    if (denialNextAction === ROUTING_ACTION.SEND_TO_FOLLOW_UP) {
      const v = validateFollowUp({ followUpDate, followUpOwnerUserId: followUpOwnerId });
      if (!v.valid) { setError(v.errors.map((e) => e.message).join(' ')); return; }
    }
    if (denialNextAction === ROUTING_ACTION.REQUEST_SCA && !canSCA) {
      setError('You do not have permission to request SCA.'); return;
    }
    const saved = await saveAuth({
      auth_status: AUTH_STATUS.DENIED,
      payer_insurance_id: payerInsuranceId || null,
      denial_reason: denialReason.trim(),
      ...(followUpDate     && { follow_up_date: followUpDate }),
      ...(followUpOwnerId  && { follow_up_owner_user_id: followUpOwnerId }),
      ...(denialNextAction === ROUTING_ACTION.REQUEST_SCA && { sca_requested: true, sca_status: 'requested' }),
      next_action: denialNextAction,
    });
    if (!saved) return;

    // Denial NEVER routes to NTUC. It routes to Conflict, Follow-up, or SCA.
    if (denialNextAction === ROUTING_ACTION.SEND_TO_CONFLICT || denialNextAction === ROUTING_ACTION.REQUEST_SCA) {
      try {
        const { record, audit } = buildConflictRecord({
          patientId: patientRecordId,        // link field — rec id
          referralId: referral?.id,
          sourceModule: CONFLICT_SOURCE_MODULE.AUTHORIZATION,
          reasons: [CONFLICT_REASON.AUTH_DENIED],
          createdByUserId: verifierRecordId, // link field — rec id
          details: `Auth denied. Reason: ${denialReason.trim()}${denialNextAction === ROUTING_ACTION.REQUEST_SCA ? '. SCA requested.' : ''}`,
        });
        await createConflict(record);
        await recordActivity({ ...audit, actorUserId: appUserId, patientId: patient?.id });
      } catch (err) {
        console.error('Conflict create after denial failed:', err);
      }
      onInitiateTransition?.(referral, 'Conflict');
    }
    if (denialNextAction === ROUTING_ACTION.REQUEST_SCA) {
      await recordActivity({
        actorUserId: appUserId,
        action: AUDIT_ACTION.SCA_REQUESTED,
        patientId: patient?.id,
        referralId: referral?.id,
        detail: 'SCA requested after denial.',
        metadata: { payerInsuranceId: payerInsuranceId || null },
      });
    }
    triggerDataRefresh();
  }

  async function handleNAR() {
    await saveAuth({
      auth_status: AUTH_STATUS.NAR,
      payer_insurance_id: payerInsuranceId || null,
      ...(narNote.trim() && { notes: narNote.trim() }),
    });
    await recordActivity({
      actorUserId: appUserId,
      action: AUDIT_ACTION.NAR_SUGGESTION_CONFIRMED,
      patientId: patient?.id,
      referralId: referral?.id,
      detail: 'Staff confirmed NAR.',
      metadata: { narNote, payerInsuranceId: payerInsuranceId || null },
    });
  }

  async function handlePending() {
    await saveAuth({
      auth_status: AUTH_STATUS.PENDING,
      payer_insurance_id: payerInsuranceId || null,
      submitted_date: new Date().toISOString(),
      ...(followUpDate    && { follow_up_date: followUpDate }),
      ...(followUpOwnerId && { follow_up_owner_user_id: followUpOwnerId }),
      ...(notes.trim()    && { notes: notes.trim() }),
    });
  }

  async function handleFollowUp() {
    const v = validateFollowUp({ followUpDate, followUpOwnerUserId: followUpOwnerId });
    if (!v.valid) { setError(v.errors.map((e) => e.message).join(' ')); return; }
    await saveAuth({
      auth_status: AUTH_STATUS.FOLLOW_UP_NEEDED,
      payer_insurance_id: payerInsuranceId || null,
      follow_up_date: followUpDate,
      follow_up_owner_user_id: followUpOwnerId,
      ...(notes.trim() && { notes: notes.trim() }),
    });
  }

  if (!referral) {
    return <p style={{ padding: 16, fontSize: t.fontBase, color: '#888' }}>No referral selected.</p>;
  }

  const allowedDenialActions = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED, division })
    .filter((a) => a !== ROUTING_ACTION.REQUEST_SCA || canSCA);

  return (
    <div data-testid="authorization-workspace" data-variant={variant} style={{ padding: variant === 'panel' ? '14px 12px' : '18px 20px 40px' }}>
      {/* NAR suggestion */}
      {narSuggestion.suggestNar && mode == null && (
        <p data-testid="auth-nar-suggestion" style={{ fontSize: t.fontMuted, color: '#1E40AF', lineHeight: 1.4, marginBottom: t.sectionGap - 4 }}>
          Suggest NAR: straight Medicare + Medicaid only.
        </p>
      )}

      {/* Latest auth summary + add */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: t.gap }}>
        <p style={sectionHeading(t)}>Authorizations ({authorizations.length})</p>
        {canDecide && mode === null && (
          <button
            onClick={openPicker}
            data-testid="auth-add-btn"
            style={{
              padding: `${t.btnPadY - 2}px ${t.inputPadX + 4}px`, borderRadius: t.radius - 1, border: 'none',
              background: palette.accentGreen.hex, color: palette.backgroundLight.hex,
              fontSize: t.fontMuted, fontWeight: 700, cursor: 'pointer',
            }}
          >+ Record Auth</button>
        )}
      </div>

      {/* Mode picker */}
      {mode === 'pick' && (
        <div style={{ marginBottom: t.sectionGap, borderRadius: t.radius + 1, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
          <div style={{ padding: `${t.inputPadY + 2}px ${t.cardPadX}px`, borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between' }}>
            <p style={{ fontSize: t.fontBase, fontWeight: 650, color: palette.backgroundDark.hex }}>Record Authorization</p>
            <button onClick={() => reset()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#888', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {AUTH_STATUS_OPTIONS.map((opt, idx, arr) => (
              <button
                key={opt.value}
                data-testid={`auth-mode-${opt.value}`}
                onClick={() => setMode(
                  opt.value === AUTH_STATUS.APPROVED ? 'approval' :
                  opt.value === AUTH_STATUS.DENIED   ? 'denial'   :
                  opt.value === AUTH_STATUS.NAR      ? 'nar'      :
                  opt.value === AUTH_STATUS.FOLLOW_UP_NEEDED ? 'follow_up' :
                  'pending',
                )}
                style={{
                  padding: `${t.cardPadY + 2}px ${t.cardPadX}px`,
                  background: palette.backgroundLight.hex,
                  border: 'none',
                  borderRight: idx % 2 === 0 ? `1px solid var(--color-border)` : 'none',
                  borderBottom: idx < arr.length - 2 ? `1px solid var(--color-border)` : 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <p style={{ fontSize: t.fontBase - 0.5, fontWeight: 700, color: palette.backgroundDark.hex }}>{opt.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Approval form */}
      {mode === 'approval' && (
        <FormBox t={t} title="Record Approval" accent={palette.accentGreen.hex} onCancel={reset}>
          <PayerInsuranceSelect t={t} insurances={insurances} value={payerInsuranceId} onChange={setPayerInsuranceId} />
          <Field t={t} label="Auth Number (required unless recording a documented exception)">
            <input type="text" placeholder="e.g. AUTH-12345" value={authNumber} onChange={(e) => setAuthNumber(e.target.value)} style={inputStyle(t)} />
          </Field>
          {!authNumber.trim() && (
            <Field t={t} label="Documented Exception">
              <textarea rows={2} value={documentedException} onChange={(e) => setDocumentedException(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} placeholder="Explain why auth number isn't available (required for approval without auth #)" />
            </Field>
          )}
          <Field t={t} label="Approval Date *">
            <input type="date" value={approvedDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setApprovedDate(e.target.value)} style={inputStyle(t)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field t={t} label="Window Start"><input type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={inputStyle(t)} /></Field>
            <Field t={t} label="Window End"><input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={inputStyle(t)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field t={t} label="Visit / Unit Limit"><input type="number" min="0" value={visitLimit} onChange={(e) => setVisitLimit(e.target.value)} style={inputStyle(t)} placeholder="e.g. 30" /></Field>
            <Field t={t} label="Unit Type">
              <select value={unitType} onChange={(e) => setUnitType(e.target.value)} style={inputStyle(t)}>
                {AUTH_UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <Field t={t} label="Services Authorized">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {AUTH_SERVICES.map((s) => (
                <button key={s} data-testid={`auth-service-${s}`} onClick={() => toggleService(s)} style={chipBtn(t, { active: servicesAuth.includes(s) })}>
                  {s}
                </button>
              ))}
            </div>
            {BLOCKED_SERVICES.length > 0 && (
              <div data-testid="blocked-services" style={{ marginTop: 6, padding: `${t.inputPadY}px ${t.inputPadX}px`, borderRadius: 6, background: '#F7F7F7' }}>
                {BLOCKED_SERVICES.map((b) => (
                  <p key={b.service} style={{ fontSize: t.fontMuted - 1, color: '#666', lineHeight: 1.35 }}>
                    <strong>{b.service}</strong> not available: {b.reason}
                  </p>
                ))}
              </div>
            )}
          </Field>
          <Field t={t} label="Notes">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} />
          </Field>
          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <Confirm t={t} onCancel={reset} onConfirm={handleApproval} disabled={!approvedDate || saving} confirmLabel={saving ? 'Saving…' : 'Confirm Approval'} accent={palette.accentGreen.hex} />
        </FormBox>
      )}

      {/* Denial form */}
      {mode === 'denial' && (
        <FormBox t={t} title="Record Denial" accent={palette.accentOrange.hex} onCancel={reset} testId="auth-denial-form">
          <PayerInsuranceSelect t={t} insurances={insurances} value={payerInsuranceId} onChange={setPayerInsuranceId} />
          <Field t={t} label="Denial Reason *">
            <textarea rows={3} value={denialReason} onChange={(e) => setDenialReason(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} placeholder="Describe the reason for denial…" />
          </Field>
          <Field t={t} label="Next Action *">
            <select data-testid="denial-next-action" value={denialNextAction} onChange={(e) => setDenialNextAction(e.target.value)} style={inputStyle(t)}>
              {allowedDenialActions.map((a) => (
                <option key={a} value={a}>
                  {a === ROUTING_ACTION.SEND_TO_CONFLICT  ? 'Send to Conflict' :
                   a === ROUTING_ACTION.SEND_TO_FOLLOW_UP ? 'Schedule Follow-Up' :
                   a === ROUTING_ACTION.REQUEST_SCA        ? 'Request Single Case Agreement (SCA)' : a}
                </option>
              ))}
            </select>
            <p style={{ fontSize: t.fontMuted - 1, color: '#888', marginTop: 3 }}>
              Denial never routes to NTUC.
            </p>
          </Field>
          {denialNextAction === ROUTING_ACTION.SEND_TO_FOLLOW_UP && (
            <FollowUpFields t={t} followUpDate={followUpDate} setFollowUpDate={setFollowUpDate} followUpOwnerId={followUpOwnerId} setFollowUpOwnerId={setFollowUpOwnerId} />
          )}
          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <Confirm
            t={t} onCancel={reset} onConfirm={handleDenial} disabled={saving || !denialReason.trim()}
            confirmLabel={saving ? 'Saving…' :
              denialNextAction === ROUTING_ACTION.REQUEST_SCA      ? 'Denial → Request SCA' :
              denialNextAction === ROUTING_ACTION.SEND_TO_FOLLOW_UP ? 'Denial → Follow-Up' :
              'Denial → Conflict'}
            accent={palette.accentOrange.hex}
          />
        </FormBox>
      )}

      {/* NAR form */}
      {mode === 'nar' && (
        <FormBox t={t} title="No Auth Required (NAR)" accent={palette.accentBlue.hex} onCancel={reset}>
          <p style={{ fontSize: t.fontMuted, color: '#666', marginBottom: t.inputPadY, lineHeight: 1.4 }}>
            Staff-confirmed: no prior authorization required for this payer.
          </p>
          <PayerInsuranceSelect t={t} insurances={insurances} value={payerInsuranceId} onChange={setPayerInsuranceId} />
          <Field t={t} label="Notes (optional)">
            <textarea rows={3} value={narNote} onChange={(e) => setNarNote(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} placeholder="Why this payer doesn't need auth…" />
          </Field>
          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <Confirm t={t} onCancel={reset} onConfirm={handleNAR} disabled={saving} confirmLabel={saving ? 'Saving…' : 'Confirm NAR'} accent={palette.accentBlue.hex} />
        </FormBox>
      )}

      {/* Pending form */}
      {mode === 'pending' && (
        <FormBox t={t} title="Record Pending Auth" accent={palette.highlightYellow.hex} onCancel={reset}>
          <PayerInsuranceSelect t={t} insurances={insurances} value={payerInsuranceId} onChange={setPayerInsuranceId} />
          <FollowUpFields t={t} followUpDate={followUpDate} setFollowUpDate={setFollowUpDate} followUpOwnerId={followUpOwnerId} setFollowUpOwnerId={setFollowUpOwnerId} />
          <Field t={t} label="Notes">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle(t), resize: 'vertical' }} />
          </Field>
          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <Confirm t={t} onCancel={reset} onConfirm={handlePending} disabled={saving} confirmLabel={saving ? 'Saving…' : 'Record Pending'} accent={palette.highlightYellow.hex} />
        </FormBox>
      )}

      {/* Follow-up form */}
      {mode === 'follow_up' && (
        <FormBox t={t} title="Schedule Follow-Up" accent={palette.accentOrange.hex} onCancel={reset}>
          <PayerInsuranceSelect t={t} insurances={insurances} value={payerInsuranceId} onChange={setPayerInsuranceId} />
          <FollowUpFields t={t} followUpDate={followUpDate} setFollowUpDate={setFollowUpDate} followUpOwnerId={followUpOwnerId} setFollowUpOwnerId={setFollowUpOwnerId} />
          {error && <ErrBanner t={t}>{error}</ErrBanner>}
          <Confirm t={t} onCancel={reset} onConfirm={handleFollowUp} disabled={saving || !followUpDate || !followUpOwnerId} confirmLabel={saving ? 'Saving…' : 'Save Follow-Up'} accent={palette.accentOrange.hex} />
        </FormBox>
      )}

      {/* List */}
      {loading && authorizations.length === 0 ? (
        <p style={{ fontSize: t.fontMuted, color: '#888' }}>Loading.</p>
      ) : authorizations.length === 0 ? (
        <p style={{ fontSize: t.fontMuted, color: '#888', textAlign: 'center', padding: '20px 0' }}>
          No authorization records yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.gap }}>
          {authorizations.map((a) => {
            const display = STATUS_DISPLAY[a.auth_status] || a.status || 'Pending';
            const sc = STATUS_COLORS[display] || STATUS_COLORS.Pending;
            return (
              <div key={a._id} data-testid="auth-card" style={{ ...cardStyle(t), padding: `${t.cardPadY}px ${t.cardPadX}px` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: t.fontBase + 0.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{a.plan_name || ''}</p>
                    {a.auth_number && <p style={{ fontSize: t.fontMuted, color: '#666' }}>Auth # {a.auth_number}</p>}
                  </div>
                  <span style={{ fontSize: t.fontMuted - 0.5, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: sc.bg, color: sc.text }}>{display}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: t.fontMuted }}>
                  {a.effective_start && <InfoCell label="Window" value={`${fmt(a.effective_start)} – ${fmt(a.effective_end)}`} />}
                  {a.auth_visit_limit && <InfoCell label="Limit" value={`${a.auth_visit_limit} ${a.auth_unit_type || 'visits'}`} />}
                  {a.follow_up_date && <InfoCell label="Follow-Up" value={fmt(a.follow_up_date)} />}
                  {a.services_authorized?.length > 0 && (
                    <InfoCell label="Services" value={(Array.isArray(a.services_authorized) ? a.services_authorized : [a.services_authorized]).join(', ')} />
                  )}
                </div>
                {a.denial_reason && (
                  <div style={{ marginTop: 6, padding: `${t.inputPadY}px ${t.inputPadX}px`, background: '#FFEDD5', borderRadius: 6, fontSize: t.fontMuted, color: '#9A3412' }}>
                    <strong>Denial:</strong> {a.denial_reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Latest auth quick info */}
      {latestAuth && variant === 'panel' && (
        <div style={{ marginTop: t.sectionGap, fontSize: t.fontMuted, color: '#888' }}>
          Last auth: {STATUS_DISPLAY[latestAuth.auth_status] || latestAuth.status} · {fmt(latestAuth.approved_date || latestAuth.created_at)}
        </div>
      )}
    </div>
  );
}

function auditActionFor(authStatus) {
  switch (authStatus) {
    case AUTH_STATUS.APPROVED:         return AUDIT_ACTION.AUTH_APPROVED;
    case AUTH_STATUS.DENIED:           return AUDIT_ACTION.AUTH_DENIED;
    case AUTH_STATUS.NAR:              return AUDIT_ACTION.AUTH_NAR_RECORDED;
    case AUTH_STATUS.FOLLOW_UP_NEEDED: return AUDIT_ACTION.AUTH_FOLLOW_UP_SCHEDULED;
    default:                           return AUDIT_ACTION.AUTH_FOLLOW_UP_SCHEDULED;
  }
}

function fmt(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Field({ t, label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ fontSize: t.fontLabel, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
function FormBox({ t, title, accent, onCancel, children, testId }) {
  return (
    <div data-testid={testId} style={{ marginBottom: t.sectionGap, borderRadius: t.radius, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex }}>
      <div style={{ padding: `${t.inputPadY + 2}px ${t.cardPadX}px`, borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between' }}>
        <p style={{ fontSize: t.fontBase, fontWeight: 700, color: accent }}>{title}</p>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#888', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: `${t.cardPadY}px ${t.cardPadX}px` }}>{children}</div>
    </div>
  );
}
function Confirm({ t, onCancel, onConfirm, disabled, confirmLabel, accent }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <button onClick={onCancel} style={secondaryBtn(t)}>Cancel</button>
      <button onClick={onConfirm} disabled={disabled} style={primaryBtn(t, { disabled, color: accent })}>{confirmLabel}</button>
    </div>
  );
}
function FollowUpFields({ t, followUpDate, setFollowUpDate, followUpOwnerId, setFollowUpOwnerId }) {
  return (
    <>
      <Field t={t} label="Follow-Up Date *">
        <input data-testid="follow-up-date" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} style={inputStyle(t)} />
      </Field>
      <Field t={t} label="Follow-Up Owner (user id) *">
        <input data-testid="follow-up-owner" type="text" value={followUpOwnerId} onChange={(e) => setFollowUpOwnerId(e.target.value)} style={inputStyle(t)} placeholder="user id" />
      </Field>
    </>
  );
}
function PayerInsuranceSelect({ t, insurances, value, onChange }) {
  if (!insurances || insurances.length === 0) return null;
  return (
    <Field t={t} label="Payer / Insurance *">
      <select data-testid="payer-insurance-select" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle(t)}>
        <option value="">Select insurance</option>
        {insurances.map((ins) => (
          <option key={ins._id} value={ins._id}>
            {ins.payer_display_name || 'Unnamed'}
            {ins.insurance_category ? ` · ${ins.insurance_category}` : ''}
            {ins.order_rank ? ` · ${ins.order_rank}` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}
function ErrBanner({ t, children }) {
  return (
    <p style={{ fontSize: t.fontMuted, color: '#B91C1C', marginBottom: 8, padding: `${t.inputPadY}px ${t.inputPadX}px`, borderRadius: 6, background: '#FEE2E2' }}>
      {children}
    </p>
  );
}
function InfoCell({ label, value }) {
  return (
    <div>
      <span style={{ color: '#888' }}>{label}: </span>
      <span style={{ color: palette.backgroundDark.hex }}>{value}</span>
    </div>
  );
}

// Keep import tree clean
export { INSURANCE_CATEGORY };
