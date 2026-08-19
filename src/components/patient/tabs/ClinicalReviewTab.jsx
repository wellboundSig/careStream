import { useState } from 'react';
import { useLookups } from '../../../hooks/useLookups.js';
import { useClinicalReview } from '../../../hooks/useClinicalReview.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { PERMISSION_KEYS, canPerformClinicalRnReview } from '../../../data/permissionKeys.js';
import { completeClinicalReview, resolveClinicalConfirmDecision } from '../../../utils/completeClinicalReview.js';
import ClinicalChecklistUI from '../../clinical/ClinicalChecklistUI.jsx';
import { unlockClinicalReview } from '../../../utils/clinicalReviewUnlock.js';
import palette, { hexToRgba } from '../../../utils/colors.js';
import DocumentationCompleteAction from '../../common/DocumentationCompleteAction.jsx';

const DECISION_LABELS = {
  accept: 'Accepted',
  conditional: 'Conditionally Accepted',
  decline: 'Declined',
};

const DECISION_COLORS = {
  accept: palette.accentGreen.hex,
  conditional: palette.highlightYellow.hex,
  decline: palette.primaryMagenta.hex,
};

const PRE_CLINICAL_STAGES = new Set([
  'Lead Entry', 'Discarded Leads', 'Intake', 'Eligibility Verification',
  'Disenrollment Required', 'F2F/MD Orders Pending', 'OPWDD Enrollment',
]);

export default function ClinicalReviewTab({ patient, referral, readOnly = false }) {
  const { resolveUser } = useLookups();
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { updateReferralLocal, setActiveTab } = usePatientDrawer();

  const decision = referral?.clinical_review_decision;
  const reviewedBy = referral?.clinical_review_by;
  const reviewedAt = referral?.clinical_review_at;
  const hasReview = !!decision;
  const currentStage = referral?.current_stage;
  const isAwaitingReview = currentStage === 'Clinical Intake RN Review';
  const isPreClinical = PRE_CLINICAL_STAGES.has(currentStage);

  const canUnlock = canPerm(PERMISSION_KEYS.CLINICAL_RN_UNLOCK);
  const canConfirmReview = canPerformClinicalRnReview(canPerm);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const reviewerName = reviewedBy ? resolveUser(reviewedBy) : null;
  const reviewDate = reviewedAt
    ? new Date(reviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const decisionLabel = DECISION_LABELS[decision] || decision;
  const decisionColor = DECISION_COLORS[decision] || hexToRgba(palette.backgroundDark.hex, 0.5);

  const {
    checked,
    decision: workingDecision,
    toggle: toggleItem,
    setDecision: setLocalDecision,
    clearDecisionLocal,
    startedBy,
    startedAt,
  } = useClinicalReview(referral?._id);
  const startedByName = startedBy ? resolveUser(startedBy) : null;
  const startedAtLabel = startedAt
    ? new Date(startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const isFinalized = !!hasReview;
  const decisionLocked = isFinalized
    || workingDecision === 'accept'
    || workingDecision === 'conditional';
  const editingLocked = readOnly || decisionLocked;
  const confirmDecision = resolveClinicalConfirmDecision(workingDecision, referral);
  const stillInClinical = !referral?.clinical_review_completed_at
    || referral?.in_clinical_review === true
    || referral?.in_clinical_review === 'true'
    || referral?.current_stage === 'Clinical Intake RN Review';

  async function handleConfirm() {
    if (!referral || confirming || readOnly) return;
    if (!confirmDecision) {
      setConfirmError('Choose Accept or Conditional, then confirm.');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await completeClinicalReview({
        referral,
        decision: confirmDecision,
        appUserId,
        onLeftModule: () => updateReferralLocal?.({
          clinical_review_decision: confirmDecision,
          in_clinical_review: false,
        }),
      });
    } catch (err) {
      setConfirmError(err.message || 'Confirm failed. Try again.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleUnlock() {
    if (!canUnlock || !referral || unlocking || readOnly) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockClinicalReview({
        referral,
        appUserId,
        clearWorkingDecision: clearDecisionLocal,
        onReferralLocal: (fields) => updateReferralLocal?.(fields),
      });
    } catch (err) {
      setUnlockError(err.message || 'Failed to unlock clinical review');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <DocumentationCompleteAction
        referral={referral}
        source="clinical_review_tab"
        onOpenF2F={() => setActiveTab?.('f2f')}
      />

      {canConfirmReview && stillInClinical && !readOnly && (
        <div style={{ marginBottom: 20 }}>
          <button
            type="button"
            data-testid="confirm-patient-btn"
            onClick={handleConfirm}
            disabled={confirming}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 8, border: 'none',
              background: confirmDecision ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
              color: confirmDecision ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
              fontSize: 14, fontWeight: 700, cursor: confirming ? 'wait' : 'pointer',
              textAlign: 'left',
            }}
          >
            {confirming ? 'Saving…' : confirmDecision ? 'Confirm → EMR Onboarding' : 'Select Accept or Conditional to confirm'}
          </button>
          {confirmError && (
            <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 600, margin: '8px 0 0' }}>{confirmError}</p>
          )}
        </div>
      )}

      {hasReview && (
        <div data-testid="clinical-review-result" style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(decisionColor, 0.08), border: `1px solid ${hexToRgba(decisionColor, 0.2)}`, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: decisionColor }}>{decisionLabel}</span>
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Clinical Review Complete</span>
          </div>
          {startedByName && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 2 }}>
              Started by <strong style={{ fontWeight: 600, color: palette.backgroundDark.hex }}>{startedByName}</strong>
              {startedAtLabel && (
                <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4) }}> · {startedAtLabel}</span>
              )}
            </p>
          )}
          {reviewerName && reviewerName !== reviewedBy && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 2 }}>
              Confirmed by <strong style={{ fontWeight: 600, color: palette.backgroundDark.hex }}>{reviewerName}</strong>
            </p>
          )}
          {reviewDate && (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{reviewDate}</p>
          )}
        </div>
      )}

      {isAwaitingReview && (
        <div data-testid="clinical-review-pending" style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.accentOrange.hex, 0.07), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.18)}`, marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 650, color: palette.accentOrange.hex, marginBottom: 2 }}>Awaiting Clinical Review</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>This patient is currently in Clinical Intake RN Review.</p>
          {startedByName && (
            <p style={{ fontSize: 12.5, color: palette.backgroundDark.hex, marginTop: 8 }}>
              Started by <strong style={{ fontWeight: 650 }}>{startedByName}</strong>
              {startedAtLabel && (
                <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 500 }}> · {startedAtLabel}</span>
              )}
            </p>
          )}
        </div>
      )}

      {!isAwaitingReview && !hasReview && startedByName && (
        <div data-testid="clinical-review-started-by" style={{ padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.primaryMagenta.hex, 0.06), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.14)}`, marginBottom: 20 }}>
          <p style={{ fontSize: 12.5, color: palette.backgroundDark.hex, margin: 0 }}>
            Checklist started by <strong style={{ fontWeight: 650 }}>{startedByName}</strong>
            {startedAtLabel && (
              <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45) }}> · {startedAtLabel}</span>
            )}
          </p>
        </div>
      )}

      {isPreClinical && !hasReview && (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.04), marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Not yet reached clinical review</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>Patient is in {currentStage}. Clinical review happens after F2F/MD Orders.</p>
        </div>
      )}

      {unlockError && (
        <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 600, marginBottom: 12 }}>{unlockError}</p>
      )}

      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
        Review Checklist {hasReview ? '(Reference)' : ''}
      </p>
      <ClinicalChecklistUI
        checked={checked}
        onToggle={editingLocked ? () => {} : toggleItem}
        decision={workingDecision}
        onDecisionChange={editingLocked ? () => {} : setLocalDecision}
        locked={editingLocked}
        lockedMessage={isFinalized
          ? 'Locked: review finalized. Unlock so staff can continue editing.'
          : (decisionLocked
            ? `Locked: ${workingDecision === 'conditional' ? 'Conditional' : 'Accepted'} selected. Unlock so staff can continue editing.`
            : undefined)}
        canUnlock={canUnlock && decisionLocked && !readOnly}
        onUnlock={handleUnlock}
        unlocking={unlocking}
      />
    </div>
  );
}
