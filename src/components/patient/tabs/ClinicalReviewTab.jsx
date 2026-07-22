import { useState } from 'react';
import { useLookups } from '../../../hooks/useLookups.js';
import { useClinicalReview } from '../../../hooks/useClinicalReview.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import ClinicalChecklistUI from '../../clinical/ClinicalChecklistUI.jsx';
import { unlockClinicalReview } from '../../../utils/clinicalReviewUnlock.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

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
  const { updateReferralLocal } = usePatientDrawer();

  const decision = referral?.clinical_review_decision;
  const reviewedBy = referral?.clinical_review_by;
  const reviewedAt = referral?.clinical_review_at;
  const hasReview = !!decision;
  const currentStage = referral?.current_stage;
  const isAwaitingReview = currentStage === 'Clinical Intake RN Review';
  const isPreClinical = PRE_CLINICAL_STAGES.has(currentStage);

  const canUnlock = canPerm(PERMISSION_KEYS.CLINICAL_RN_UNLOCK);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

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
  } = useClinicalReview(referral?._id);

  const isFinalized = !!hasReview;
  const decisionLocked = isFinalized
    || workingDecision === 'accept'
    || workingDecision === 'conditional';
  const editingLocked = readOnly || decisionLocked;

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

      {hasReview && (
        <div data-testid="clinical-review-result" style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(decisionColor, 0.08), border: `1px solid ${hexToRgba(decisionColor, 0.2)}`, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: decisionColor }}>{decisionLabel}</span>
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Clinical Review Complete</span>
          </div>
          {reviewerName && reviewerName !== reviewedBy && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 2 }}>
              Reviewed by <strong style={{ fontWeight: 600, color: palette.backgroundDark.hex }}>{reviewerName}</strong>
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
