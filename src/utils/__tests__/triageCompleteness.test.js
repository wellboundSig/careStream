import { describe, it, expect } from 'vitest';
import { isTriageComplete, getRequiredFields } from '../triageCompleteness.js';

function makeAdultTriage(overrides = {}) {
  return {
    caregiver_name: 'Jane Doe',
    caregiver_phone: '2125550100',
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
    cm_name: 'Case Manager',
    cm_company: 'Agency X',
    cm_phone: '2125550300',
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
    cm_name: 'CM Smith',
    cm_phone: '2125550500',
    ...overrides,
  };
}

describe('isTriageComplete — adult', () => {
  it('returns complete for fully filled adult triage', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage(), 'adult');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('fails when caregiver_name is missing', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ caregiver_name: '' }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('caregiver_name');
  });

  it('fails when code_95 is missing', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ code_95: '' }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('code_95');
  });

  it('fails when services_needed is empty array', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ services_needed: [] }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('services_needed');
  });

  it('fails when boolean field has_pets is unanswered (undefined)', () => {
    const data = makeAdultTriage();
    delete data.has_pets;
    const { complete, missing } = isTriageComplete(data, 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('has_pets');
  });

  it('passes when boolean field has_pets is explicitly false', () => {
    const { complete } = isTriageComplete(makeAdultTriage({ has_pets: false }), 'adult');
    expect(complete).toBe(true);
  });

  it('requires pet_details when has_pets is true', () => {
    const { complete, missing } = isTriageComplete(
      makeAdultTriage({ has_pets: true, pet_details: '' }),
      'adult'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('pet_details');
  });

  it('passes with pet_details filled when has_pets is true', () => {
    const { complete } = isTriageComplete(
      makeAdultTriage({ has_pets: true, pet_details: 'Dog, friendly' }),
      'adult'
    );
    expect(complete).toBe(true);
  });

  it('requires homecare sub-fields when has_homecare_services is true', () => {
    const { complete, missing } = isTriageComplete(
      makeAdultTriage({ has_homecare_services: true }),
      'adult'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('homecare_agency_name');
    expect(missing).toContain('homecare_hours');
    expect(missing).toContain('homecare_days');
  });

  it('requires diabetes_monitor_by when is_diabetic is true', () => {
    const { complete, missing } = isTriageComplete(
      makeAdultTriage({ is_diabetic: true }),
      'adult'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('diabetes_monitor_by');
  });

  it('handles null data', () => {
    const { complete, missing } = isTriageComplete(null, 'adult');
    expect(complete).toBe(false);
    expect(missing.length).toBeGreaterThan(0);
  });

  it('handles undefined data', () => {
    const { complete } = isTriageComplete(undefined, 'adult');
    expect(complete).toBe(false);
  });

  it('fails when pcp_name is null', () => {
    const { complete, missing } = isTriageComplete(makeAdultTriage({ pcp_name: null }), 'adult');
    expect(complete).toBe(false);
    expect(missing).toContain('pcp_name');
  });
});

describe('isTriageComplete — pediatric', () => {
  it('returns complete for fully filled pediatric triage', () => {
    const { complete, missing } = isTriageComplete(makePediatricTriage(), 'pediatric');
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('fails when phone_call_made_to is missing', () => {
    const { complete, missing } = isTriageComplete(makePediatricTriage({ phone_call_made_to: '' }), 'pediatric');
    expect(complete).toBe(false);
    expect(missing).toContain('phone_call_made_to');
  });

  it('fails when has_recent_hospitalization is unanswered', () => {
    const data = makePediatricTriage();
    delete data.has_recent_hospitalization;
    const { complete, missing } = isTriageComplete(data, 'pediatric');
    expect(complete).toBe(false);
    expect(missing).toContain('has_recent_hospitalization');
  });

  it('requires recent_hospitalization details when has_recent_hospitalization is true', () => {
    const { complete, missing } = isTriageComplete(
      makePediatricTriage({ has_recent_hospitalization: true, recent_hospitalization: '' }),
      'pediatric'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('recent_hospitalization');
  });

  it('passes with hospitalization details provided', () => {
    const { complete } = isTriageComplete(
      makePediatricTriage({ has_recent_hospitalization: true, recent_hospitalization: 'Admitted 2 weeks ago for asthma' }),
      'pediatric'
    );
    expect(complete).toBe(true);
  });

  it('requires boe_services details when has_boe_services is true', () => {
    const { complete, missing } = isTriageComplete(
      makePediatricTriage({ has_boe_services: true, boe_services: '' }),
      'pediatric'
    );
    expect(complete).toBe(false);
    expect(missing).toContain('boe_services');
  });

  it('passes with boe_services details provided', () => {
    const { complete } = isTriageComplete(
      makePediatricTriage({ has_boe_services: true, boe_services: 'Speech therapy through school' }),
      'pediatric'
    );
    expect(complete).toBe(true);
  });

  it('fails when immunizations_up_to_date is unanswered', () => {
    const data = makePediatricTriage();
    delete data.immunizations_up_to_date;
    const { complete, missing } = isTriageComplete(data, 'pediatric');
    expect(complete).toBe(false);
    expect(missing).toContain('immunizations_up_to_date');
  });

  it('accepts string "true" for immunizations_up_to_date', () => {
    const { complete } = isTriageComplete(
      makePediatricTriage({ immunizations_up_to_date: 'true' }),
      'pediatric'
    );
    expect(complete).toBe(true);
  });

  it('accepts string "false" for immunizations_up_to_date', () => {
    const { complete } = isTriageComplete(
      makePediatricTriage({ immunizations_up_to_date: 'false' }),
      'pediatric'
    );
    expect(complete).toBe(true);
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
