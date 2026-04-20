/**
 * In-memory test harness that simulates the persistence layer used by the
 * Eligibility + Authorization modules. No network, no Airtable, no timers.
 *
 * Each table is a Map keyed by a synthetic id. `recordActivity` writes to
 * the audit log so tests can assert on what happened.
 */

let counter = 0;
const nextId = (prefix) => `${prefix}_${++counter}`;

export function createHarness() {
  const state = {
    patientInsurances: new Map(),
    eligibilityVerifications: new Map(),
    authorizations: new Map(),
    conflicts: new Map(),
    disenrollmentFlags: new Map(),
    activityLog: [],
  };

  function resetCounter() { counter = 0; }

  const api = {
    state,
    reset: () => {
      for (const k of Object.keys(state)) {
        if (state[k] instanceof Map) state[k].clear();
        else if (Array.isArray(state[k])) state[k].length = 0;
      }
      resetCounter();
    },
    createPatientInsurance(fields) {
      const id = nextId('pi');
      const rec = { id, ...fields, created_at: new Date().toISOString() };
      state.patientInsurances.set(id, rec);
      return rec;
    },
    updatePatientInsurance(id, fields) {
      const prev = state.patientInsurances.get(id);
      if (!prev) throw new Error('missing');
      const next = { ...prev, ...fields, updated_at: new Date().toISOString() };
      state.patientInsurances.set(id, next);
      return next;
    },
    listInsurancesForPatient(patientId) {
      return Array.from(state.patientInsurances.values()).filter((r) => r.patient_id === patientId);
    },
    createEligibilityVerification(fields) {
      const id = nextId('ev');
      const rec = { id, ...fields, created_at: new Date().toISOString() };
      state.eligibilityVerifications.set(id, rec);
      return rec;
    },
    listVerificationsForPatient(patientId) {
      return Array.from(state.eligibilityVerifications.values()).filter((r) => r.patient_id === patientId);
    },
    createAuthorization(fields) {
      const id = nextId('auth');
      const rec = { id, ...fields, created_at: new Date().toISOString() };
      state.authorizations.set(id, rec);
      return rec;
    },
    createConflict(fields) {
      const id = nextId('c');
      const rec = { id, ...fields, created_at: new Date().toISOString() };
      state.conflicts.set(id, rec);
      return rec;
    },
    createDisenrollmentFlag(fields) {
      const id = nextId('dis');
      const rec = { id, ...fields, created_at: new Date().toISOString() };
      state.disenrollmentFlags.set(id, rec);
      return rec;
    },
    recordActivity(entry) {
      state.activityLog.push({ ...entry, timestamp: new Date().toISOString() });
      return entry;
    },
    auditActions() {
      return state.activityLog.map((a) => a.action);
    },
    assertAudited(action) {
      const found = state.activityLog.some((a) => a.action === action);
      if (!found) throw new Error(`Expected audit action ${action} in log. Got: ${state.activityLog.map((a) => a.action).join(', ')}`);
      return true;
    },
  };
  return api;
}

export function snapshotDemographicsInsurance(insurance) {
  // Mirror Demographics -> Eligibility snapshot. This is read-only on the
  // eligibility side. The test harness asserts it does not get mutated.
  return Object.freeze({
    patientId:        insurance.patient_id,
    payerDisplayName: insurance.payer_display_name,
    insuranceCategory: insurance.insurance_category,
    memberId:         insurance.member_id,
    orderRank:        insurance.order_rank,
    effectiveDate:    insurance.effective_date,
    terminationDate:  insurance.termination_date,
  });
}
