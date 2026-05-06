/**
 * ActivityLog API — append-only audit trail.
 *
 * Every significant action in the Eligibility / Authorization / Conflict /
 * Routing modules is recorded here via `recordActivity`. Writers should
 * always supply: actor, action, and patient/referral context where
 * applicable. `metadata` is an arbitrary JSON blob used by report engines.
 */

import airtable from './airtable.js';

const TABLE = 'ActivityLog';

export const getActivityLog = (params) =>
  airtable.fetchAll(TABLE, { sort: [{ field: 'timestamp', direction: 'desc' }], ...params });

export const getActivityByUser = (userId, limit = 30) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{actor_id} = "${userId}"`,
    sort: [{ field: 'timestamp', direction: 'desc' }],
    maxRecords: limit,
  });

export const getActivityByPatient = (patientId, limit = 100) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{patient_id} = "${patientId}"`,
    sort: [{ field: 'timestamp', direction: 'desc' }],
    maxRecords: limit,
  });

/**
 * Record an action to the audit log.
 *
 * NOTE: ActivityLog's actor_id / patient_id / referral_id are currently
 * `singleSelect` fields with a fixed allowlist of legacy ids in Airtable.
 * Sending a NEW id (e.g. `pat_<timestamp>_<rand>`) would trigger a 422
 * "Insufficient permissions to create new select option" because our token
 * cannot create new select options. To avoid that breaking user actions:
 *  1. We attempt the audit write with full context first.
 *  2. If Airtable rejects it because of a select-option permission issue,
 *     we retry once with the offending select fields stripped, so the
 *     audit row is still created with `action`, `detail`, and `metadata`.
 *  3. Audit failures NEVER throw — user-facing operations should not be
 *     blocked by an audit log schema mismatch. The full payload is folded
 *     into `metadata` so the data is recoverable later.
 *
 * @param {object} entry
 * @param {string} entry.actorUserId       Required — who performed the action
 * @param {string} entry.action            AUDIT_ACTION.* (see eligibilityEnums)
 * @param {string} [entry.patientId]
 * @param {string} [entry.referralId]
 * @param {string} [entry.detail]          Human-readable summary
 * @param {object} [entry.metadata]        Structured payload (serialised)
 */
export async function recordActivity(entry) {
  const baseMetadata = {
    ...(entry.metadata || {}),
    ...(entry.patientId  ? { patientId:  entry.patientId  } : {}),
    ...(entry.referralId ? { referralId: entry.referralId } : {}),
    ...(entry.actorUserId ? { actorUserId: entry.actorUserId } : {}),
  };

  const fullFields = {
    actor_id:    entry.actorUserId,
    action:      entry.action,
    timestamp:   new Date().toISOString(),
    ...(entry.patientId  && { patient_id:  entry.patientId  }),
    ...(entry.referralId && { referral_id: entry.referralId }),
    ...(entry.detail     && { detail:      entry.detail     }),
    metadata:    JSON.stringify(baseMetadata),
  };

  try {
    return await airtable.create(TABLE, fullFields);
  } catch (err) {
    const isSelectOptionIssue = /Insufficient permissions to create new select option/i
      .test(err?.airtable?.message || err?.message || '');
    if (!isSelectOptionIssue) {
      // eslint-disable-next-line no-console
      console.warn('[recordActivity] audit write failed (non-fatal):', err?.message || err);
      return null;
    }
    // Retry without the single-select-locked fields. The original ids are
    // preserved inside `metadata` so we don't lose any context.
    const reducedFields = {
      action:    entry.action,
      timestamp: new Date().toISOString(),
      ...(entry.detail && { detail: entry.detail }),
      metadata:  JSON.stringify(baseMetadata),
    };
    try {
      return await airtable.create(TABLE, reducedFields);
    } catch (err2) {
      // eslint-disable-next-line no-console
      console.warn('[recordActivity] audit retry also failed (non-fatal):', err2?.message || err2);
      return null;
    }
  }
}
