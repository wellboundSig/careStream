/**
 * Transition engine — the single source of truth for "can this referral move,
 * and what happens when it does."
 *
 * Two functions, cleanly split:
 *
 *   attemptTransition({ referral, toStage, context })  -- PURE. Validates the
 *     edge + guards, resolves NTUC interception, and computes the field updates
 *     and side-effect descriptors. No I/O. Trivially unit-testable.
 *
 *   applyTransition({ referral, result, context })     -- the ONLY writer.
 *     Performs the optimistic store write, the audit (recordTransition), and
 *     the side effects, then runs a dev-only invariant check. Every "door"
 *     (ModulePage, PipelineBoard, PatientList, every StagePanel panel,
 *     EligibilityWorkspace, TriageTab, opwddOrchestration) goes through here.
 *
 * Migration policy: this preserves existing behavior verbatim. Edge validation
 * is exactly `canMoveFromTo`; no new blocking guards are wired in StageRules
 * yet (see guards.js). UI-sourced data (SOC date, intake owner, clinical
 * decision, etc.) flows in via `context.extraFields`; transition-specific side
 * effects (createEpisode, etc.) via `context.extraSideEffects`.
 */

import StageRules from '../data/StageRules.json';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../utils/stageTransitions.js';
import { applyStageEntryEffects } from '../utils/stageEntryEffects.js';
import { runGuards } from './guards.js';
import { runEffects } from './effects.js';
import { updateReferralOptimistic } from '../store/mutations.js';
import { recordTransition } from '../utils/recordTransition.js';
import { assertReferralInvariants } from './invariants.js';
import { useCareStore } from '../store/careStore.js';

/**
 * @param {object} args
 * @param {object} args.referral                The referral being moved (store-shaped).
 * @param {string} args.toStage                 Requested destination stage.
 * @param {object} [args.context]
 * @param {string} [args.context.note]              Free-text note (drives Hold/NTUC fields + audit).
 * @param {string} [args.context.actorUserId]       Acting user's business id.
 * @param {boolean}[args.context.canDirectNtuc]     True if the user may go straight to NTUC.
 * @param {boolean}[args.context.system]            True for sanctioned internal/sub-state moves
 *   (e.g. Pre-SOC -> SOC Scheduled, Clinical Confirm -> EMR Onboarding, Push to Clinical RN).
 *   These bypass the `canMoveTo` ALLOWLIST (the panel's own action is the authorization) but
 *   still flow through the unified write path: NTUC/Hold handling, stage-entry effects, audit,
 *   side effects, and the invariant check. User-driven graph moves leave this false so the
 *   declarative edge list is still enforced.
 * @param {object} [args.context.extraFields]       UI-sourced fields to merge into the write.
 * @param {Array}  [args.context.extraSideEffects]  Extra effect descriptors (e.g. createEpisode).
 * @param {function}[args.context.resolveUserName]  Optional name resolver for audit notes.
 * @returns {{ allowed, reason, fromStage, effectiveStage, requiresNote, requiresModal,
 *             requiresPermission, wasIntercepted, fieldUpdates, sideEffects, auditNote }}
 */
export function attemptTransition({ referral, toStage, context = {} }) {
  const fromStage = referral?.current_stage;

  if (!referral?._id) {
    return { allowed: false, reason: 'No referral selected.' };
  }
  // System moves are sanctioned by the calling panel's own action and bypass
  // the user-facing edge allowlist; everything else must be a declared edge.
  if (!context.system && !canMoveFromTo(fromStage, toStage)) {
    return { allowed: false, reason: `Cannot move from ${fromStage} to ${toStage}.` };
  }

  // Entry guards (declarative, by name). None are wired as blocking yet, but
  // the machinery is here so the sign-off pass can tighten rules in one place.
  const entryGuards = StageRules.stages[toStage]?.entryGuards || [];
  const guard = runGuards(entryGuards, referral, { world: context.world });
  if (!guard.ok) {
    return { allowed: false, reason: guard.reason, failedGuard: guard.failed };
  }

  // NTUC interception (non-direct users go to Admin Confirmation instead).
  const { effectiveStage, ntucMetadata, wasIntercepted } = resolveNtucDestination({
    requestedStage: toStage,
    fromStage,
    canDirect: () => context.canDirectNtuc === true,
    userId: context.actorUserId,
  });

  const note = typeof context.note === 'string' ? context.note : '';

  // Base field updates owned by the engine.
  const fieldUpdates = { current_stage: effectiveStage, ...ntucMetadata };
  if (effectiveStage === 'Hold') {
    if (note) fieldUpdates.hold_reason = note;
    fieldUpdates.hold_return_stage = fromStage;
  }
  if (effectiveStage === 'NTUC' && note) fieldUpdates.ntuc_reason = note;
  if (wasIntercepted && note) fieldUpdates.ntuc_reason = note;

  // Stage-entry side effects (e.g. Eligibility re-check clearing).
  Object.assign(fieldUpdates, applyStageEntryEffects({
    referral,
    fromStage,
    toStage: effectiveStage,
    actorUserId: context.actorUserId,
    resolveUserName: context.resolveUserName,
  }));

  // UI-sourced fields last so callers can express transition-specific data.
  Object.assign(fieldUpdates, context.extraFields || {});

  // Side-effect descriptors.
  const sideEffects = [];
  if (fromStage === 'Conflict' && note) {
    sideEffects.push({ type: 'resolveOpenConflicts', note });
  }
  for (const e of (context.extraSideEffects || [])) sideEffects.push(e);

  const fromRule = StageRules.stages[fromStage] || {};
  return {
    allowed: true,
    reason: null,
    fromStage,
    effectiveStage,
    requiresNote: !!fromRule.requiresNote || effectiveStage === 'Hold' || effectiveStage === 'NTUC',
    requiresModal: needsModal(fromStage, toStage),
    requiresPermission: StageRules.stages[toStage]?.requiresPermission || null,
    wasIntercepted,
    fieldUpdates,
    sideEffects,
    auditNote: note,
  };
}

/**
 * Execute a validated transition. The ONE place a referral's current_stage is
 * written. Returns { ok, reason }.
 *
 * @param {object} args
 * @param {object} args.referral
 * @param {object} args.result      The object returned by attemptTransition.
 * @param {object} [args.context]
 * @param {string} [args.context.actorUserId]
 * @param {object} [args.context.conflictPayload]  If present, a Conflict is created
 *        (blocking, pre-write) via flagConflict; failure aborts the move.
 * @param {function}[args.context.flagConflict]     Injected flagConflict fn (kept
 *        injectable so the pure-ish engine doesn't hard-depend on the conflict API).
 */
export async function applyTransition({ referral, result, context = {} }) {
  if (!result?.allowed) return { ok: false, reason: result?.reason || 'Transition not allowed.' };

  const actorUserId = context.actorUserId;

  // Pre-write, blocking: create the Conflict record before moving, so a failed
  // create aborts the move (mirrors the original executeTransition behavior).
  if (context.conflictPayload && typeof context.flagConflict === 'function') {
    await context.flagConflict(context.conflictPayload);
  }

  // The single authoritative write.
  await updateReferralOptimistic(referral._id, result.fieldUpdates);

  // Audit (StageHistory + optional timeline Note) — always.
  recordTransition({
    referral,
    fromStage: result.fromStage,
    toStage: result.effectiveStage,
    note: result.auditNote,
    authorId: actorUserId,
  });

  // Data side effects (best-effort).
  await runEffects(result.sideEffects, { referral, actorUserId });

  // Dev-only post-write invariant check — never blocks the user.
  try {
    if (import.meta?.env?.DEV) {
      const world = useCareStore.getState();
      const updated = world.referrals?.[referral._id] || { ...referral, ...result.fieldUpdates };
      const violations = assertReferralInvariants(updated, world);
      if (violations.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[transitionEngine] post-write invariant violations:', violations);
      }
    }
  } catch { /* invariant check must never throw into the UI */ }

  return { ok: true };
}
