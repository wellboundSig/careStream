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
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

  const reviewerName = reviewedBy ? resolveUser(reviewedBy) : null;
  const reviewDate = reviewedAt
    ? new Date(reviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const decisionLabel = DECISION_LABELS[decision] || decision;
  const decisionColor = DECISION_COLORS[decision] || hexToRgba(palette.backgroundDark.hex, 0.5);

  // Persisted checklist state — saves to the ClinicalReview table on every
  // toggle (debounced inside the hook). The same hook backs the Clinical RN
  // module panel, so the drawer tab and panel stay in lockstep.
  const {
    checked,
    decision: workingDecision,
    toggle: toggleItem,
    setDecision: setLocalDecision,
  } = useClinicalReview(referral?._id);

  // Finalized stamp on the referral locks edits until an authorized unlock.
  const isFinalized = !!hasReview;
  const editingLocked = readOnly || isFinalized
    || workingDecision === 'accept'
    || workingDecision === 'conditional';

  async function handleUnlock() {
    if (!canUnlock || !referral || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockClinicalReview({
        referral,
        appUserId,
        reason: unlockReason,
        clearWorkingDecision: () => setLocalDecision(null),
        onReferralLocal: (fields) => updateReferralLocal?.(fields),
      });
      setShowUnlock(false);
      setUnlockReason('');
    } catch (err) {
      setUnlockError(err.message || 'Failed to unlock clinical review');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>

      {/* Status banner */}
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

          {canUnlock && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${hexToRgba(decisionColor, 0.18)}` }}>
              {!showUnlock ? (
                <button
                  data-testid="unlock-clinical-review-btn"
                  type="button"
                  onClick={() => { setShowUnlock(true); setUnlockError(null); }}
                  style={{
                    padding: '7px 12px', borderRadius: 7, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.45)}`,
                    background: hexToRgba(palette.accentOrange.hex, 0.08), color: palette.accentOrange.hex,
                    fontSize: 12, fontWeight: 650, cursor: 'pointer',
                  }}
                >
                  Unlock review to correct
                </button>
              ) : (
                <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`, background: hexToRgba(palette.accentOrange.hex, 0.04), padding: '10px 11px' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                    Unlock this clinical review?
                  </p>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.45, marginBottom: 8 }}>
                    Clears the Accept stamp so checklist and decision can be updated, then Accept → Confirm can be hit again.
                    {currentStage && currentStage !== 'Clinical Intake RN Review'
                      ? ` Patient will return to Clinical Intake RN Review from ${currentStage}.`
                      : ''}
                  </p>
                  <textarea
                    data-testid="unlock-clinical-review-reason"
                    value={unlockReason}
                    onChange={(e) => setUnlockReason(e.target.value)}
                    placeholder="Reason for unlock (recommended)…"
                    rows={2}
                    style={{
                      width: '100%', padding: '7px 9px', borderRadius: 7,
                      border: `1px solid ${unlockReason.trim() ? palette.accentOrange.hex : 'var(--color-border)'}`,
                      fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                      background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex,
                      boxSizing: 'border-box', marginBottom: 8,
                    }}
                  />
                  {unlockError && (
                    <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8, fontWeight: 600 }}>{unlockError}</p>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      data-testid="unlock-clinical-review-confirm"
                      type="button"
                      onClick={handleUnlock}
                      disabled={unlocking}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                        background: unlocking ? hexToRgba(palette.accentOrange.hex, 0.5) : palette.accentOrange.hex,
                        color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650,
                        cursor: unlocking ? 'wait' : 'pointer',
                      }}
                    >
                      {unlocking ? 'Unlocking…' : 'Unlock review'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowUnlock(false); setUnlockReason(''); setUnlockError(null); }}
                      disabled={unlocking}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                        background: hexToRgba(palette.backgroundDark.hex, 0.07),
                        color: hexToRgba(palette.backgroundDark.hex, 0.55),
                        fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
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

      {/* Checklist (session-only, for active review reference) */}
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
          ? 'Locked — clinical review is finalized. Unlock required to make corrections.'
          : undefined}
      />
    </div>
  );
}
