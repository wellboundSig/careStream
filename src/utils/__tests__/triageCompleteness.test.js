import { describe, it, expect } from 'vitest';
import { isTriageComplete, getRequiredFields } from '../triageCompleteness.js';

// Complete adult triage using boolean values (store format after normalization)
function makeAdultTriage(overrides = {}) {
  return {
    caregiver_name: 'Jane Doe',
    caregiver_phone: '2125550100',
    caregiver_email: 'jane@example.com',
    has_pets: false,
    has_homecare_services: false,
    has_community_hab: false,
    code_95: 'no',
    services_needed: ['SN', 'PT'],
    therapy_availability: 'Mornings M-F',
    is_diabetic: false,
    pcp_name: 'Dr. Smith',
    pcp_last_visit: '2026-01-15',
    pcp_phone: '2125550200',
    pcp_fax: '2125550201',
    pcp_address: '123 Main St, NY',
    cm_name: 'Case Manager',
    cm_company: 'Agency X',
    cm_phone: '2125550300',
    cm_fax_or_email: 'cm@agency.com',
    ...overrides,
  };
}

function makePediatricTriage(overrides = {}) {
  return {
    phone_call_made_to: 'Mother',
    household_description: 'Lives with parents',
    has_pets: false,
    has_homecare_services: false,
    has_community_hab: false,
    has_boe_services: false,
    code_95: 'yes',
    services_needed: ['SN', 'PT', 'ABA'],
    therapy_availability: 'After school',
    hha_hours_frequency: '4 hours/day',
    is_diabetic: false,
    immunizations_up_to_date: 'true',
    school_bus_time: '15:30',
    has_recent_hospitalization: false,
    pcp_name: 'Dr. Jones',
    pcp_last_visit: '2026-02-01',
    pcp_phone: '2125550400',
    pcp_fax: '2125550401',
    pcp_address: '456 Oak Ave, NY',
    cm_name: 'CM Smith',
    cm_phone: '2125550500',
    ...overrides,
  };
}

// ─── Three-state boolean tests (critical for patient safety) ─────────────────

describe('Three-state boolean: true / false / unanswered', () => {
  it('boolean true counts as answered (with conditional met)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: true, pet_details: 'Cat' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('boolean false counts as answered', () => {
    const { complete } = isTriageComplete(makeAdultTriage({ has_pets: false }), 'adult');
    expect(complete).toBe(true);
  });

  it('string "TRUE" counts as answered (triggers conditional)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'TRUE', pet_details: 'Cat' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('string "FALSE" counts as answered', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'FALSE' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('string "Yes" counts as answered (triggers conditional)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'Yes', pet_details: 'Dog' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('string "No" counts as answered', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: 'No' }), 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('null is NOT answered — marks incomplete', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ has_pets: null }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('has_pets');
  });

  it('field absent but key exists in data as undefined — marks incomplete', () => {
    const data = makeAdultTriage();
    data.has_pets = undefined;
    const { missing } = isTriageComplete(data, 'adult');
    expect(missing).toContain('has_pets');
  });

  it('field completely absent from data (column may not exist) — skipped', () => {
    const data = makeAdultTriage();
    delete data.has_pets;
    const { missing } = isTriageComplete(data, 'adult');
    expect(missing).not.toContain('has_pets');
  });

  it('empty string is NOT answered — marks incomplete', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ has_pets: '' }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('has_pets');
  });
});

// ─── Every boolean field individually ────────────────────────────────────────

describe('Every boolean field: true saves, false saves, empty = incomplete', () => {
  const boolFields = [
    { field: 'has_pets', form: 'adult' },
    { field: 'has_homecare_services', form: 'adult' },
    { field: 'has_community_hab', form: 'adult' },
    { field: 'is_diabetic', form: 'adult' },
    { field: 'has_pets', form: 'pediatric' },
    { field: 'has_homecare_services', form: 'pediatric' },
    { field: 'has_community_hab', form: 'pediatric' },
    { field: 'is_diabetic', form: 'pediatric' },
    { field: 'immunizations_up_to_date', form: 'pediatric' },
    { field: 'has_recent_hospitalization', form: 'pediatric' },
  ];

  for (const { field, form } of boolFields) {
    const maker = form === 'adult' ? makeAdultTriage : makePediatricTriage;

    it(`${form} ${field} = true → complete`, () => {
      expect(isTriageComplete(maker({ [field]: true }), form).missing).not.toContain(field);
    });

    it(`${form} ${field} = false → complete`, () => {
      expect(isTriageComplete(maker({ [field]: false }), form).missing).not.toContain(field);
    });

    it(`${form} ${field} = 'TRUE' → complete`, () => {
      expect(isTriageComplete(maker({ [field]: 'TRUE' }), form).missing).not.toContain(field);
    });

    it(`${form} ${field} = 'FALSE' → complete`, () => {
      expect(isTriageComplete(maker({ [field]: 'FALSE' }), form).missing).not.toContain(field);
    });

    it(`${form} ${field} = undefined (key present) → incomplete`, () => {
      const data = maker();
      data[field] = undefined;
      expect(isTriageComplete(data, form).missing).toContain(field);
    });

    it(`${form} ${field} = null → incomplete`, () => {
      expect(isTriageComplete(maker({ [field]: null }), form).missing).toContain(field);
    });

    it(`${form} ${field} = '' → incomplete`, () => {
      expect(isTriageComplete(maker({ [field]: '' }), form).missing).toContain(field);
    });
  }
});

// ─── Full form completion tests ──────────────────────────────────────────────

describe('Full form completion — adult', () => {
  it('complete adult triage passes', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage(), 'adult');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('fails when caregiver_name is missing', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ caregiver_name: '' }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('caregiver_name');
  });

  it('fails when services_needed is empty array', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ services_needed: [] }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('services_needed');
  });

  it('requires pet_details when has_pets is true', () => {
    const { complete, missing } = isTriageComplete(
      makeAdultTriage({ has_pets: true, pet_details: '' }),
      'adult'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('pet_details');
  });

  it('passes with pet_details when has_pets is true', () => {
    const { complete } = isTriageComplete(
      makeAdultTriage({ has_pets: true, pet_details: 'Dog, friendly' }),
      'adult'
    );
    expect(complete).toBe(true);
  });

  it('does NOT require pet_details when has_pets is false', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ has_pets: false }), 'adult');
    expect(missing).not.toContain('pet_details');
  });

  it('requires homecare sub-fields when has_homecare_services is true', () => {
    const { missing } = isTriageComplete(
      makeAdultTriage({ has_homecare_services: true }),
      'adult'
    );
    expect(missing).toContain('homecare_agency_name');
    expect(missing).toContain('homecare_hours');
    expect(missing).toContain('homecare_days');
  });

  it('requires diabetes_monitor_by when is_diabetic is true', () => {
    const { missing } = isTriageComplete(
      makeAdultTriage({ is_diabetic: true }),
      'adult'
    );
    expect(missing).toContain('diabetes_monitor_by');
  });
});

describe('Full form completion — pediatric', () => {
  it('complete pediatric triage passes', () => {
    const { complete, missing } = isTriageComplete(makePediatricTriage(), 'pediatric');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('fails when phone_call_made_to is missing', () => {
    const { complete, missing } = isTriageComplete(makePediatricTriage({ phone_call_made_to: '' }), 'pediatric');
    expect(complete).toBe(false);
    expect(missing).toContain('phone_call_made_to');
  });

  it('requires hospitalization note when has_recent_hospitalization is true', () => {
    const { missing } = isTriageComplete(
      makePediatricTriage({ has_recent_hospitalization: true, hospitalization_note: '' }),
      'pediatric'
    );
    expect(missing).toContain('hospitalization_note');
  });

  it('requires boe_services details when has_boe_services is true', () => {
    const { missing } = isTriageComplete(
      makePediatricTriage({ has_boe_services: true, boe_services: '' }),
      'pediatric'
    );
    expect(missing).toContain('boe_services');
  });
});

// ─── Partial form tests ─────────────────────────────────────────────────────

describe('Partial form — checkmark must not appear', () => {
  it('half-filled adult form is incomplete', () => {
    const partial = {
      caregiver_name: 'Jane',
      caregiver_phone: '2125550100',
      caregiver_email: 'j@test.com',
      has_pets: false,
      code_95: 'no',
    };
    const { complete } = isTriageComplete(partial, 'adult');
    expect(complete).toBe(false);
  });

  it('half-filled pediatric form is incomplete', () => {
    const partial = {
      phone_call_made_to: 'Mother',
      household_description: 'Parents',
      has_pets: false,
    };
    const { complete } = isTriageComplete(partial, 'pediatric');
    expect(complete).toBe(false);
  });

  it('removing one answer from complete form makes it incomplete', () => {
    const data = makeAdultTriage();
    delete data.pcp_name;
    const { complete, missing } = isTriageComplete(data, 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('pcp_name');
  });
});

// ─── Validation tests ────────────────────────────────────────────────────────

describe('Phone and email validation in completeness', () => {
  it('rejects invalid phone (too short)', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_phone: '555' }), 'adult');
    expect(missing).toContain('caregiver_phone');
  });

  it('accepts valid 10-digit phone', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_phone: '2125550100' }), 'adult');
    expect(missing).not.toContain('caregiver_phone');
  });

  it('rejects email without @', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_email: 'notanemail' }), 'adult');
    expect(missing).toContain('caregiver_email');
  });

  it('accepts valid email', () => {
    const { missing } = isTriageComplete(makeAdultTriage({ caregiver_email: 'test@example.com' }), 'adult');
    expect(missing).not.toContain('caregiver_email');
  });
});

// ─── null data ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('null data returns incomplete', () => {
    const { complete } = isTriageComplete(null, 'adult');
    expect(complete).toBe(false);
  });

  it('undefined data returns incomplete', () => {
    const { complete } = isTriageComplete(undefined, 'adult');
    expect(complete).toBe(false);
  });

  it('empty object returns incomplete', () => {
    const { complete } = isTriageComplete({}, 'adult');
    expect(complete).toBe(false);
  });
});

describe('getRequiredFields', () => {
  it('returns adult required fields', () => {
    const fields = getRequiredFields('adult');
    expect(fields).toContain('caregiver_name');
    expect(fields).toContain('code_95');
    expect(fields).not.toContain('phone_call_made_to');
  });

  it('returns pediatric required fields', () => {
    const fields = getRequiredFields('pediatric');
    expect(fields).toContain('phone_call_made_to');
    expect(fields).toContain('has_recent_hospitalization');
    expect(fields).not.toContain('caregiver_name');
  });
});
