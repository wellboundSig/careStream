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
 * @param {object} entry
 * @param {string} entry.actorUserId       Required — who performed the action
 * @param {string} entry.action            AUDIT_ACTION.* (see eligibilityEnums)
 * @param {string} [entry.patientId]
 * @param {string} [entry.referralId]
 * @param {string} [entry.detail]          Human-readable summary
 * @param {object} [entry.metadata]        Structured payload (serialised)
 */
export async function recordActivity(entry) {
  const fields = {
    actor_id:    entry.actorUserId,
    action:      entry.action,
    timestamp:   new Date().toISOString(),
    ...(entry.patientId  && { patient_id:  entry.patientId  }),
    ...(entry.referralId && { referral_id: entry.referralId }),
    ...(entry.detail     && { detail:      entry.detail     }),
    ...(entry.metadata   && { metadata:    JSON.stringify(entry.metadata) }),
  };
  return airtable.create(TABLE, fields);
}
