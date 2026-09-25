/**
 * Division scoping for tasks — single source of truth.
 *
 * A task belongs to the division of its related PATIENT (falling back to its
 * related referral when the patient has no division). Tasks with no patient or
 * referral (general admin work) have no division and are always visible.
 *
 * Every task surface (Tasks page, Dashboard caseload, Calendar) applies BOTH:
 *   1. the user's division permissions (division.alf / division.sn) — a user
 *      without access to a division must never see its tasks, and
 *   2. the global division switcher (All / ALF / Special Needs).
 */

/** Build a business-id → record map from a store map (or array) of records. */
export function byBusinessId(records) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  const map = {};
  for (const rec of list) {
    if (rec?.id) map[rec.id] = rec;
  }
  return map;
}

/** The division a task belongs to, or null when it has none. */
export function resolveTaskDivision(task, { patientsById = {}, referralsById = {} } = {}) {
  if (!task) return null;
  const patient = task.patient_id ? patientsById[task.patient_id] : null;
  if (patient?.division) return patient.division;
  const referral = task.referral_id ? referralsById[task.referral_id] : null;
  if (referral?.division) return referral.division;
  return null;
}

/** True when this user may see this division (null division = always visible). */
export function divisionVisible(div, { hasDivision, division = 'All' } = {}) {
  if (!div) return true;
  if (typeof hasDivision === 'function') {
    if (div === 'ALF' && !hasDivision('ALF')) return false;
    if (div === 'Special Needs' && !hasDivision('Special Needs')) return false;
  }
  if (division && division !== 'All' && div !== division) return false;
  return true;
}

/**
 * Filter tasks to those the user may see under the active division scope.
 * @param {Array} tasks
 * @param {object} opts
 * @param {function} opts.hasDivision  usePermissions().hasDivision
 * @param {string}   [opts.division]  active switcher value ('All' default)
 * @param {object}   opts.patientsById   business-id map (see byBusinessId)
 * @param {object}   opts.referralsById  business-id map
 */
export function filterTasksByDivision(tasks, opts = {}) {
  return (tasks || []).filter((t) => divisionVisible(resolveTaskDivision(t, opts), opts));
}
