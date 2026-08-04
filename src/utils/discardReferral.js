/**
 * Move a referral to Discarded Leads with reason + explanation.
 * Uses system:true so it works from any stage (permission-gated in UI).
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';

/**
 * @param {object} args
 * @param {object} args.referral
 * @param {string} args.reason
 * @param {string} args.explanation
 * @param {string} [args.actorUserId]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function discardReferral({ referral, reason, explanation, actorUserId } = {}) {
  if (!referral?._id) return { ok: false, reason: 'No referral selected.' };
  if (referral.current_stage === 'Discarded Leads') {
    return { ok: false, reason: 'Already discarded.' };
  }
  const note = `[Discarded] ${reason}\n${explanation}`;
  const result = attemptTransition({
    referral,
    toStage: 'Discarded Leads',
    context: {
      system: true,
      note,
      actorUserId,
      extraFields: {
        discard_reason: reason,
        discard_explanation: explanation,
        updated_at: new Date().toISOString(),
      },
    },
  });
  if (!result.allowed) return { ok: false, reason: result.reason || 'Discard not allowed.' };
  await applyTransition({ referral, result, context: { actorUserId } });
  return { ok: true };
}
