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
 * ActivityLog's actor_id / patient_id / referral_id are meant to be plain
 * TEXT columns (the rest of the app stores ids as text — see the insurance
 * consolidation work). Some bases still have them as legacy `singleSelect`
 * fields with a fixed allowlist; sending a new id (e.g. `pat_<ts>_<rand>`)
 * there returns 422 `INVALID_MULTIPLE_CHOICE_OPTIONS` because our token can't
 * mint new select options.
 *
 * Strategy (resilient to either schema, never blocks the user):
 *  1. Attempt the full write WITH the id columns, silently — if those columns
 *     are text (the desired end state) this succeeds and the ids land in
 *     their own columns.
 *  2. If it fails for ANY reason, retry once with the id columns stripped.
 *     The ids are always also folded into `metadata`, so nothing is lost.
 *  3. Audit failures NEVER throw — a logging hiccup must not break the
 *     user-facing action that triggered it.
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
  const metadataJson = JSON.stringify(baseMetadata);

  // Text-only row that always writes regardless of the id-column types.
  const reducedFields = {
    action:    entry.action,
    timestamp: new Date().toISOString(),
    ...(entry.detail && { detail: entry.detail }),
    metadata:  metadataJson,
  };

  const fullFields = {
    ...reducedFields,
    ...(entry.actorUserId && { actor_id:    entry.actorUserId }),
    ...(entry.patientId   && { patient_id:  entry.patientId   }),
    ...(entry.referralId  && { referral_id: entry.referralId  }),
  };

  try {
    // Silent: a failure here is expected on bases where the id columns are
    // still legacy selects, and is fully handled by the retry below.
    return await airtable.create(TABLE, fullFields, { silent: true });
  } catch {
    try {
      return await airtable.create(TABLE, reducedFields);
    } catch (err2) {
      // eslint-disable-next-line no-console
      console.warn('[recordActivity] audit write failed (non-fatal):', err2?.message || err2);
      return null;
    }
  }
}
