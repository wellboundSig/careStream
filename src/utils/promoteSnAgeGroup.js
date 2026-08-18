/**
 * SPN Pediatric → Adult when the patient turns 18.
 *
 * Age group is stored on the referral (`sn_age_group`). Cases can sit in the
 * pipeline past a birthday, so we sweep after hydrate / silent rehydrate and
 * flip any open Special Needs referral whose DOB now implies Adult.
 *
 * Side effects (best-effort after the referral write):
 *  - timeline note
 *  - activity log
 *  - one notification to the intake owner (deterministic id — no duplicates)
 */

import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { useCareStore } from '../store/careStore.js';
import { recordActivity } from '../api/activityLog.js';
import { createNotification } from '../api/notifications.js';
import { inferAgeGroupFromDob } from './validation.js';

export const SN_AGE_PROMOTE_ACTION = 'sn_age_group_auto_adult';
export const SN_AGE_PROMOTE_MESSAGE = 'Patient has turned 18, switched from peds to adult.';
export const SN_AGE_PROMOTE_SKIP_STAGES = new Set(['NTUC', 'Discarded Leads']);

const SYSTEM_ACTOR = 'system';
const inFlight = new Set();
let sweepRunning = false;

function patientLabel(patient) {
  if (!patient) return '';
  return `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
}

function findPatient(patients, patientId) {
  if (!patientId) return null;
  const id = String(patientId).trim();
  if (!id) return null;
  const map = patients || {};
  if (map[id]) return map[id];
  return Object.values(map).find((p) => p.id === id || p._id === id) || null;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export function promotionNoteId(referralId) {
  return `note_sn_adult_${referralId}`;
}

export function promotionNotificationId(referralId) {
  return `notif_sn_adult_${referralId}`;
}

/**
 * True when this SPN referral should flip Pediatric → Adult.
 */
export function shouldPromoteSnAgeGroup({ referral, patient, today } = {}) {
  if (!referral) return false;
  if (referral.division !== 'Special Needs') return false;
  if (referral.sn_age_group !== 'Pediatric') return false;
  if (SN_AGE_PROMOTE_SKIP_STAGES.has(referral.current_stage)) return false;
  if (!patient?.dob) return false;
  return inferAgeGroupFromDob(patient.dob, today) === 'Adult';
}

function alreadyPromoted(referral, { notes, activityLog } = {}) {
  const rid = referral?.id;
  if (!rid) return false;
  const noteId = promotionNoteId(rid);
  const hasNote = Object.values(notes || {}).some((n) => (
    n.id === noteId
    || (n.referral_id === rid && String(n.content || '').includes('switched from peds to adult'))
  ));
  if (hasNote) return true;
  return Object.values(activityLog || {}).some((a) => {
    if (a.action !== SN_AGE_PROMOTE_ACTION) return false;
    const meta = parseMeta(a.metadata);
    return a.referral_id === rid || meta.referralId === rid;
  });
}

/**
 * Flip one referral and notify the intake owner (if assigned).
 * Safe to call more than once — skips when already Adult or already marked.
 */
export async function promoteSnAgeGroupToAdult({
  referral,
  patient,
  today,
  actorUserId = SYSTEM_ACTOR,
} = {}) {
  if (!referral?._id) return { skipped: true, reason: 'no_record' };
  if (!shouldPromoteSnAgeGroup({ referral, patient, today })) {
    return { skipped: true, reason: 'not_eligible' };
  }

  const lockKey = referral._id;
  if (inFlight.has(lockKey)) return { skipped: true, reason: 'in_flight' };
  inFlight.add(lockKey);

  try {
    const store = useCareStore.getState();
    const live = store.referrals?.[referral._id] || referral;
    if (live.sn_age_group !== 'Pediatric') {
      return { skipped: true, reason: 'already_adult' };
    }

    const marked = alreadyPromoted(live, {
      notes: store.notes,
      activityLog: store.activityLog,
    });

    const now = new Date().toISOString();
    await updateReferralOptimistic(referral._id, {
      sn_age_group: 'Adult',
      updated_at: now,
    });

    if (marked) {
      return { skipped: true, reason: 'already_marked', fields: { sn_age_group: 'Adult' } };
    }

    const rid = referral.id || null;
    const pid = referral.patient_id || patient?.id || null;
    const label = patientLabel(patient);

    try {
      await createNoteOptimistic({
        id: rid ? promotionNoteId(rid) : `note_${Date.now()}_sn_adult`,
        patient_id: pid,
        referral_id: rid,
        author_id: actorUserId,
        content: SN_AGE_PROMOTE_MESSAGE,
        created_at: now,
        is_pinned: false,
      });
    } catch (err) {
      console.warn('[promoteSnAgeGroup] note failed (non-fatal):', err?.message || err);
    }

    try {
      await recordActivity({
        actorUserId,
        action: SN_AGE_PROMOTE_ACTION,
        patientId: pid,
        referralId: rid,
        detail: SN_AGE_PROMOTE_MESSAGE,
        metadata: { previous: 'Pediatric', next: 'Adult' },
      });
    } catch (err) {
      console.warn('[promoteSnAgeGroup] activity log failed (non-fatal):', err?.message || err);
    }

    const ownerId = String(referral.intake_owner_id || '').trim();
    if (ownerId && rid) {
      try {
        await createNotification({
          id: promotionNotificationId(rid),
          recipient_user_id: ownerId,
          actor_user_id: actorUserId,
          type: 'sn_age_group_adult',
          entity_type: 'referral',
          entity_id: rid,
          patient_id: pid,
          referral_id: rid,
          title: SN_AGE_PROMOTE_MESSAGE,
          body: label || null,
          is_read: false,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        // Unique id collision = another client already notified — ignore.
        console.warn('[promoteSnAgeGroup] notification failed (non-fatal):', err?.message || err);
      }
    }

    return { skipped: false, fields: { sn_age_group: 'Adult' } };
  } finally {
    inFlight.delete(lockKey);
  }
}

/**
 * Scan the hydrated store and promote every eligible SPN referral.
 * Fire-and-forget from hydrate — never throws to the caller.
 */
export async function sweepSnAgeGroupPromotions({ today } = {}) {
  if (sweepRunning) return { ran: false, reason: 'in_flight' };
  sweepRunning = true;
  try {
    const { referrals, patients } = useCareStore.getState();
    const candidates = Object.values(referrals || {}).filter((referral) => {
      const patient = findPatient(patients, referral.patient_id);
      return shouldPromoteSnAgeGroup({ referral, patient, today });
    });

    let promoted = 0;
    for (const referral of candidates) {
      const patient = findPatient(useCareStore.getState().patients, referral.patient_id);
      try {
        const result = await promoteSnAgeGroupToAdult({ referral, patient, today });
        if (!result.skipped) promoted += 1;
      } catch (err) {
        console.warn('[promoteSnAgeGroup] sweep item failed:', referral.id, err?.message || err);
      }
    }
    return { ran: true, candidates: candidates.length, promoted };
  } catch (err) {
    console.warn('[promoteSnAgeGroup] sweep failed:', err?.message || err);
    return { ran: false, reason: 'error' };
  } finally {
    sweepRunning = false;
  }
}
