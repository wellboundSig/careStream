/**
 * Shared test factories + scenario builders.
 *
 * Promoted out of the per-file fixtures in src/__tests__/e2eFlows.test.js and
 * src/__tests__/pipelineFlow.test.js so every test (and especially the
 * transition-engine table + property tests) constructs state the same way.
 *
 * Philosophy: any state should be ONE line to build —
 *   const { referral } = seedStore({ referral: { current_stage: 'SOC Scheduled' } });
 * so writing the 400th test is cheap.
 *
 * These helpers are framework-agnostic (no vitest imports) so they can be used
 * from tests, the property-based model, and ad-hoc scripts alike.
 */

import { setStore } from '../store/careStore.js';

// ── Entity (patient / referral) builders ────────────────────────────────────

export function makePatient(overrides = {}) {
  return {
    _id: 'rec_pat1',
    id: 'pat_001',
    first_name: 'Maria',
    last_name: 'Rodriguez',
    dob: '1985-06-15',
    gender: 'Female',
    division: 'ALF',
    address_zip: '10001',
    address_state: 'NY',
    county: 'New York',
    phone_primary: '212-555-0100',
    medicaid_number: 'AB12345C',
    insurance_plan: 'Fidelis Care',
    is_active: 'TRUE',
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeReferral(overrides = {}) {
  return {
    _id: 'rec_ref1',
    id: 'ref_001',
    patient_id: 'pat_001',
    current_stage: 'Lead Entry',
    division: 'ALF',
    priority: 'Normal',
    marketer_id: 'mkt_001',
    referral_source_id: 'src_001',
    services_requested: ['SN', 'PT'],
    referral_date: '2026-03-15T00:00:00.000Z',
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    entity_id: 'WB',
    ...overrides,
  };
}

// ── Store "world" builder ───────────────────────────────────────────────────
// A fully-initialised, empty store shaped like the real one. Pass slices in
// `overrides` to populate any table.

export function makeWorld(overrides = {}) {
  return {
    hydrated: true,
    entities: {
      rec_ent_wb:   { _id: 'rec_ent_wb',   id: 'WB',   name: 'Wellbound (WB)' },
      rec_ent_wbii: { _id: 'rec_ent_wbii', id: 'WBII', name: 'Wellbound II (WBII)' },
    },
    patients: {},
    referrals: {},
    notes: {},
    tasks: {},
    stageHistory: {},
    files: {},
    insuranceChecks: {},
    conflicts: {},
    authorizations: {},
    episodes: {},
    triageAdult: {},
    triagePediatric: {},
    clinicalReviews: {},
    cursoryReviews: {},
    ...overrides,
  };
}

/**
 * Seed the zustand store with one patient + one referral and an otherwise
 * empty world. Returns the built `{ patient, referral }`.
 *
 * @param {object} [opts]
 * @param {object} [opts.patient]  Patient field overrides.
 * @param {object} [opts.referral] Referral field overrides.
 * @param {object} [opts.world]    Extra store slices (conflicts, files, etc.).
 */
export function seedStore({ patient = {}, referral = {}, world = {} } = {}) {
  const p = makePatient(patient);
  const r = makeReferral(referral);
  setStore(makeWorld({
    patients: { [p._id]: p },
    referrals: { [r._id]: r },
    ...world,
  }));
  return { patient: p, referral: r };
}
