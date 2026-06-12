/**
 * Effect interpreter — turns side-effect DESCRIPTORS (plain data) produced by
 * the transition engine into real API calls. Keeping effects as data is what
 * lets us unit-test "this transition should resolve open conflicts" without
 * touching the network, and what stops each UI door from hand-rolling its own
 * side effects (the source of several drift bugs).
 *
 * Descriptor shapes:
 *   { type: 'resolveOpenConflicts', note }
 *   { type: 'createEpisode', patientId, referralRecordId, socDate }
 *   { type: 'recordActivity', ...activityArgs }
 *
 * All effects are best-effort: a failure is logged and swallowed so it can
 * never roll back a stage move that already succeeded. (The stage write itself
 * is the only non-best-effort operation; it lives in the engine.)
 */

import { useCareStore } from '../store/careStore.js';
import { resolveConflict } from '../utils/conflictFlagging.js';
import { createEpisode } from '../api/episodes.js';
import { recordActivity } from '../api/activityLog.js';

const OPEN_CONFLICT_STATUSES = new Set(['Open', 'Unaddressed', 'In Progress']);

function linkMatches(value, id) {
  if (value == null) return false;
  return Array.isArray(value) ? value.includes(id) : value === id;
}

async function resolveOpenConflicts({ referral, note, actorUserId }) {
  const conflicts = useCareStore.getState().conflicts || {};
  const open = Object.values(conflicts).filter((c) =>
    linkMatches(c.referral_id, referral.id) && OPEN_CONFLICT_STATUSES.has(c.status));
  for (const conflict of open) {
    await resolveConflict({ conflict, note, actorUserId }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[effects.resolveOpenConflicts] failed for', conflict._id, err?.message || err);
    });
  }
}

/**
 * Run a single effect descriptor.
 * @param {object} effect  The descriptor (must have a `type`).
 * @param {object} ctx     { referral, actorUserId }
 */
export async function runEffect(effect, ctx = {}) {
  if (!effect || !effect.type) return;
  const { referral, actorUserId } = ctx;
  try {
    switch (effect.type) {
      case 'resolveOpenConflicts':
        await resolveOpenConflicts({ referral, note: effect.note, actorUserId });
        break;
      case 'createEpisode':
        await createEpisode({
          patient_id: effect.patientId,
          referral_id: effect.referralRecordId,
          soc_date: effect.socDate,
          episode_start: effect.socDate,
        });
        break;
      case 'recordActivity':
        await recordActivity({ actorUserId, ...effect.args });
        break;
      default:
        // eslint-disable-next-line no-console
        console.warn('[effects] unknown effect type:', effect.type);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[effects] effect "${effect.type}" failed (non-fatal):`, err?.message || err);
  }
}

export async function runEffects(effects = [], ctx = {}) {
  for (const effect of effects) {
    // Sequential so audit ordering is deterministic.
    // eslint-disable-next-line no-await-in-loop
    await runEffect(effect, ctx);
  }
}
