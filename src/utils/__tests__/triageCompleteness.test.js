import { describe, it, expect } from 'vitest';
import { isTriageComplete, getRequiredFields } from '../triageCompleteness.js';

// ── Test fixtures (v2 spec — careStream/triage_forms_spec.md) ───────────────

function makeAdultTriage(overrides = {}) {
  return {
    opwdd_status: 'OPWDD Eligible',
    insurance_plan_name: 'Fidelis Medicaid',
    medicaid_number: 'XX123456',
    patient_name: 'Jane Doe',
    dob: '1985-04-12',
    address: '123 Main St, Brooklyn, NY 11201',
    email: 'jane@example.com',
    caregiver_name: 'John Doe',
    caregiver_phone: '2125550100',
    add_secondary_caregiver: 'No',
    has_pets: 'No',
    has_smoking: 'No',
    has_homecare_services: 'No',
    has_community_hab: 'No',
    has_in_home_therapies: 'No',
    services_needed: ['PT', 'OT'],
    therapy_availability: 'Mornings M-F',
    health_conditions: 'Hypertension',
    pcp_name: 'Dr. Smith',
    pcp_last_visit: '2026-01-15',
    pcp_phone: '2125550200',
    pcp_fax: '2125550201',
    pcp_address: '456 Park Ave',
    pcp_npi_number: '1234567890',
    cco_name: 'Care Design NY',
    cm_name: 'Case Manager',
    cm_phone: '2125550300',
    cm_fax: '2125550301',
    cm_email: 'cm@agency.com',
    ...overrides,
  };
}

function makePediatricTriage(overrides = {}) {
  return {
    opwdd_status: 'OPWDD Pending',
    medicaid_number: 'XX654321',
    phone_call_made_to: 'Mother',
    primary_caregiver_name: 'Sarah Smith',
    primary_caregiver_phone: '2125550400',
    add_secondary_caregiver: 'No',
    emergency_same_as_primary: 'Yes',
    email: 'sarah@example.com',
    patient_name: 'Tommy Smith',
    dob: '2018-08-20',
    address: '789 Oak Ave, Brooklyn, NY 11215',
    has_pets: 'No',
    has_smoking: 'No',
    has_homecare_services: 'No',
    boe_services: 'OT, PT, SETSS',
    has_community_hab: 'No',
    services_needed: ['PT', 'OT', 'ABA'],
    therapy_availability: 'After school',
    health_conditions: 'Autism spectrum disorder',
    school_bus_time: '15:30',
    has_recent_hospitalization: 'No',
    pcp_name: 'Dr. Jones',
    pcp_last_visit: '2026-02-01',
    pcp_phone: '2125550500',
    pcp_fax: '2125550501',
    pcp_address: '101 Pine St',
    cco_name: 'Tri-County Care',
    cm_name: 'CM Smith',
    cm_phone: '2125550600',
    cm_fax: '2125550601',
    cm_email: 'cm.smith@cco.com',
    ...overrides,
  };
}

// ── OPWDD status (the new tri-state enum) ───────────────────────────────────

describe('opwdd_status — 3-state enum', () => {
  it('accepts OPWDD Eligible', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ opwdd_status: 'OPWDD Eligible' }), 'adult');
    expect(missing).not.toContain('opwdd_status');
  });
  it('accepts OPWDD Pending', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ opwdd_status: 'OPWDD Pending' }), 'adult');
    expect(missing).not.toContain('opwdd_status');
  });
  it('accepts Non-OPWDD', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ opwdd_status: 'Non-OPWDD' }), 'adult');
    expect(missing).not.toContain('opwdd_status');
  });
  it('rejects null', () => {
    const { missing, complete } = isTriageComplete(makeAdultTriage({ opwdd_status: null }), 'adult');
    expect(missing).toContain('opwdd_status');
    expect(complete).toBe(false);
  });
  it('rejects free-form text', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ opwdd_status: 'maybe' }), 'adult');
    expect(missing).toContain('opwdd_status');
  });
});

// ── Tri-state boolean fields ────────────────────────────────────────────────

describe('Three-state booleans: Yes / No / Unanswered', () => {
  it('Yes counts as answered', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'Yes' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });
  it('No counts as answered', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'No' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });
  it('boolean true also counts (legacy ingest)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: true }), 'adult');
    expect(missing).not.toContain('has_pets');
  });
  it('boolean false also counts', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: false }), 'adult');
    expect(missing).not.toContain('has_pets');
  });
  it('null marks as missing', () => {
    const { missing, complete } = isTriageComplete(makeAdultTriage({ has_pets: null }), 'adult');
    expect(missing).toContain('has_pets');
    expect(complete).toBe(false);
  });
  it('empty string marks as missing', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: '' }), 'adult');
    expect(missing).toContain('has_pets');
  });
  it('key completely absent is treated the same as null (incomplete)', () => {
    const data = makeAdultTriage();
    delete data.has_pets;
    const { missing } = isTriageComplete(data, 'adult');
    expect(missing).toContain('has_pets');
  });
});

// ── Spec conditional rules ──────────────────────────────────────────────────

describe('Adult conditionals follow spec', () => {
  it('add_secondary_caregiver=Yes requires secondary name + phone', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      add_secondary_caregiver: 'Yes',
    }), 'adult');
    expect(missing).toContain('secondary_caregiver_name');
    expect(missing).toContain('secondary_caregiver_phone');
  });
  it('add_secondary_caregiver=No does NOT require secondaries', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      add_secondary_caregiver: 'No',
    }), 'adult');
    expect(missing).not.toContain('secondary_caregiver_name');
  });

  it('has_homecare_services=Yes requires agency + hours_days', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      has_homecare_services: 'Yes',
    }), 'adult');
    expect(missing).toContain('homecare_agency_name');
    expect(missing).toContain('homecare_hours_days');
  });

  it('has_in_home_therapies=Yes requires current_therapy_services', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      has_in_home_therapies: 'Yes',
    }), 'adult');
    expect(missing).toContain('current_therapy_services');
  });

  it('services_needed includes HHA → requires hha_hours_frequency', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      services_needed: ['HHA'],
      hha_hours_frequency: '',
    }), 'adult');
    expect(missing).toContain('hha_hours_frequency');
  });

  it('services_needed without PT/OT/ST → therapy_availability NOT required', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      services_needed: ['HHA'],
      therapy_availability: '',
      hha_hours_frequency: '4 hrs/day',
    }), 'adult');
    expect(missing).not.toContain('therapy_availability');
  });

  it('services_needed includes PT → therapy_availability required', () => {
    const { missing } = isTriageComplete(makeAdultTriage({
      services_needed: ['PT'],
      therapy_availability: '',
    }), 'adult');
    expect(missing).toContain('therapy_availability');
  });
});

describe('Pediatric conditionals follow spec', () => {
  it('emergency_same_as_primary=No requires emergency contact name + phone', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      emergency_same_as_primary: 'No',
    }), 'pediatric');
    expect(missing).toContain('emergency_contact_name');
    expect(missing).toContain('emergency_contact_phone');
  });

  it('emergency_same_as_primary=Yes does NOT require emergency contact', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      emergency_same_as_primary: 'Yes',
    }), 'pediatric');
    expect(missing).not.toContain('emergency_contact_name');
  });

  it('add_secondary_caregiver=Yes requires secondaries', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      add_secondary_caregiver: 'Yes',
    }), 'pediatric');
    expect(missing).toContain('secondary_caregiver_name');
    expect(missing).toContain('secondary_caregiver_phone');
  });

  it('has_homecare_services=Yes requires agency + hours_days', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      has_homecare_services: 'Yes',
    }), 'pediatric');
    expect(missing).toContain('homecare_agency_name');
    expect(missing).toContain('homecare_hours_days');
  });

  it('therapy services trigger therapy_availability requirement', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      services_needed: ['ST'],
      therapy_availability: '',
    }), 'pediatric');
    expect(missing).toContain('therapy_availability');
  });

  it('only ABA selected → therapy_availability NOT required', () => {
    const { missing } = isTriageComplete(makePediatricTriage({
      services_needed: ['ABA'],
      therapy_availability: '',
    }), 'pediatric');
    expect(missing).not.toContain('therapy_availability');
  });
});

// ── Phone, email, NPI validation ────────────────────────────────────────────

describe('Inline field validation', () => {
  it('accepts a valid 10-digit phone', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_phone: '2125550100' }), 'adult');
    expect(missing).not.toContain('caregiver_phone');
  });
  it('rejects a short phone', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_phone: '555' }), 'adult');
    expect(missing).toContain('caregiver_phone');
  });
  it('rejects phone with letters', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_phone: '212555ABCD' }), 'adult');
    expect(missing).toContain('caregiver_phone');
  });

  it('accepts a valid email', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ email: 'a@b.co' }), 'adult');
    expect(missing).not.toContain('email');
  });
  it('rejects an email without @', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ email: 'notanemail' }), 'adult');
    expect(missing).toContain('email');
  });
  it('rejects an email without TLD', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ email: 'a@b' }), 'adult');
    expect(missing).toContain('email');
  });

  it('accepts a 10-digit NPI', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ pcp_npi_number: '1234567890' }), 'adult');
    expect(missing).not.toContain('pcp_npi_number');
  });
  it('rejects a 9-digit NPI', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ pcp_npi_number: '123456789' }), 'adult');
    expect(missing).toContain('pcp_npi_number');
  });

  it('cco_name must be one of the three CCOs', () => {
    const ok = isTriageComplete(makeAdultTriage({ cco_name: 'Care Design NY' }), 'adult');
    expect(ok.missing).not.toContain('cco_name');
    const bad = isTriageComplete(makeAdultTriage({ cco_name: 'Some Other CCO' }), 'adult');
    expect(bad.missing).toContain('cco_name');
  });
});

// ── Whole-form completion ───────────────────────────────────────────────────

describe('Whole-form completion', () => {
  it('a fully-filled adult triage passes', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage(), 'adult');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('a fully-filled pediatric triage passes', () => {
    const { complete, missing } = isTriageComplete(makePediatricTriage(), 'pediatric');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('half-filled adult triage is incomplete', () => {
    const partial = {
      opwdd_status: 'OPWDD Eligible',
      caregiver_name: 'Jane',
    };
    const { complete, missing } = isTriageComplete(partial, 'adult');
    expect(complete).toBe(false);
    // Every required field except the two we set must be flagged.
    expect(missing).toContain('insurance_plan_name');
    expect(missing).toContain('pcp_npi_number');
  });

  it('clearing a single field flips complete → incomplete', () => {
    const { missing } = isTriageComplete({ ...makeAdultTriage(), pcp_npi_number: '' }, 'adult');
    expect(missing).toContain('pcp_npi_number');
  });
});

// ── Multi-select services_needed ────────────────────────────────────────────

describe('services_needed multi-select', () => {
  it('empty array is incomplete', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ services_needed: [] }), 'adult');
    expect(missing).toContain('services_needed');
  });
  it('non-array is incomplete', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ services_needed: null }), 'adult');
    expect(missing).toContain('services_needed');
  });
  it('one selected service is complete (provided its conditional children are filled)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ services_needed: ['PT'] }), 'adult');
    expect(missing).not.toContain('services_needed');
    expect(missing).not.toContain('therapy_availability'); // already provided by fixture
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('null data returns incomplete', () => {
    expect(isTriageComplete(null, 'adult').complete).toBe(false);
  });
  it('undefined data returns incomplete', () => {
    expect(isTriageComplete(undefined, 'adult').complete).toBe(false);
  });
  it('empty object is incomplete (legacy records show as needing re-entry)', () => {
    const { complete, missing } = isTriageComplete({}, 'adult');
    expect(complete).toBe(false);
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe('getRequiredFields', () => {
  it('returns the adult required set', () => {
    const fields = getRequiredFields('adult');
    expect(fields).toContain('opwdd_status');
    expect(fields).toContain('insurance_plan_name');
    expect(fields).toContain('caregiver_name');
    expect(fields).toContain('pcp_npi_number');
    expect(fields).not.toContain('phone_call_made_to');
    expect(fields).not.toContain('is_diabetic'); // dropped in v2
  });
  it('returns the pediatric required set', () => {
    const fields = getRequiredFields('pediatric');
    expect(fields).toContain('opwdd_status');
    expect(fields).toContain('phone_call_made_to');
    expect(fields).toContain('primary_caregiver_name');
    expect(fields).toContain('boe_services');
    expect(fields).not.toContain('caregiver_name');
    expect(fields).not.toContain('pcp_npi_number'); // adult-only in v2
  });
});
