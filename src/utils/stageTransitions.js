import StageRules from '../data/StageRules.json';

export function canMoveFromTo(fromStage, toStage) {
  if (fromStage === toStage) return false;
  const fromRule = StageRules.stages[fromStage];
  if (!fromRule || fromRule.terminal) return false;
  if (toStage === 'Hold' && StageRules.globalRules.anyActiveStageCanMoveToHold) return true;
  return fromRule.canMoveTo?.includes(toStage) ?? false;
}

export function needsModal(fromStage, toStage) {
  const fromRule = StageRules.stages[fromStage];
  const toRule = StageRules.stages[toStage];
  return !!(
    fromRule?.requiresNote ||
    fromRule?.protectedExit ||
    toStage === 'Hold' ||
    toStage === 'NTUC' ||
    toRule?.destinationPrompt
  );
}

/**
 * Resolves the effective destination when a user requests NTUC.
 *
 * If the user has REFERRAL_NTUC_DIRECT permission, returns 'NTUC' (direct).
 * Otherwise, returns 'Admin Confirmation' so the request goes through review.
 *
 * Also returns metadata fields to write on the referral for tracking.
 *
 * @param {object} params
 * @param {string} params.requestedStage - the stage the user clicked (should be 'NTUC')
 * @param {string} params.fromStage - current stage of the referral
 * @param {function} params.canDirect - () => boolean, checks REFERRAL_NTUC_DIRECT
 * @param {string} params.userId - the requesting user's ID
 * @returns {{ effectiveStage: string, ntucMetadata: object, wasIntercepted: boolean }}
 */
export function resolveNtucDestination({ requestedStage, fromStage, canDirect, userId }) {
  if (requestedStage !== 'NTUC') {
    return { effectiveStage: requestedStage, ntucMetadata: {}, wasIntercepted: false };
  }

  if (canDirect()) {
    return { effectiveStage: 'NTUC', ntucMetadata: {}, wasIntercepted: false };
  }

  return {
    effectiveStage: 'Admin Confirmation',
    ntucMetadata: {
      ntuc_request_origin_stage: fromStage,
      ntuc_requested_by: userId || 'unknown',
      ntuc_requested_at: new Date().toISOString(),
    },
    wasIntercepted: true,
  };
}
