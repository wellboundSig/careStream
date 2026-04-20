import { describe, it, expect } from 'vitest';
import {
  determineAllowedServicesByDivision,
  isServiceAllowed,
  validateRequestedServices,
} from '../serviceAvailabilityPolicies.js';
import {
  AUTH_SERVICE,
  DIVISION,
  FACILITY_SETTING,
} from '../../eligibilityEnums.js';

describe('determineAllowedServicesByDivision', () => {
  it('ALF excludes HHA', () => {
    const { allowed, blocked } = determineAllowedServicesByDivision({ division: DIVISION.ALF });
    expect(allowed).not.toContain(AUTH_SERVICE.HHA);
    expect(blocked.find((b) => b.service === AUTH_SERVICE.HHA)).toBeTruthy();
  });

  it('ALF still permits SN, PT, OT, ST, MSW', () => {
    const { allowed } = determineAllowedServicesByDivision({ division: DIVISION.ALF });
    expect(allowed).toEqual(expect.arrayContaining([
      AUTH_SERVICE.SN, AUTH_SERVICE.PT, AUTH_SERVICE.OT, AUTH_SERVICE.ST, AUTH_SERVICE.MSW,
    ]));
  });

  it('Authorization excludes ABA entirely', () => {
    const { allowed, blocked } = determineAllowedServicesByDivision({ division: DIVISION.SPECIAL_NEEDS });
    expect(allowed).not.toContain('ABA');
    expect(blocked.find((b) => b.service === 'ABA')).toBeTruthy();
  });

  it('Special Needs allows HHA (not an ALF setting)', () => {
    const { allowed } = determineAllowedServicesByDivision({ division: DIVISION.SPECIAL_NEEDS });
    expect(allowed).toContain(AUTH_SERVICE.HHA);
  });

  it('Facility setting = ALF also blocks HHA', () => {
    const { allowed } = determineAllowedServicesByDivision({ facilitySetting: FACILITY_SETTING.ALF });
    expect(allowed).not.toContain(AUTH_SERVICE.HHA);
  });
});

describe('isServiceAllowed', () => {
  it('is false for HHA in ALF', () => {
    expect(isServiceAllowed(AUTH_SERVICE.HHA, { division: DIVISION.ALF })).toBe(false);
  });
  it('is true for SN in ALF', () => {
    expect(isServiceAllowed(AUTH_SERVICE.SN, { division: DIVISION.ALF })).toBe(true);
  });
  it('is false for ABA anywhere', () => {
    expect(isServiceAllowed('ABA', { division: DIVISION.SPECIAL_NEEDS })).toBe(false);
  });
});

describe('validateRequestedServices', () => {
  it('flags HHA in ALF with explanatory reason', () => {
    const r = validateRequestedServices([AUTH_SERVICE.HHA, AUTH_SERVICE.SN], { division: DIVISION.ALF });
    expect(r.valid).toBe(false);
    const hhaErr = r.errors.find((e) => e.service === AUTH_SERVICE.HHA);
    expect(hhaErr).toBeTruthy();
    expect(hhaErr.reason.toLowerCase()).toMatch(/duplication|alf/);
  });

  it('flags ABA everywhere', () => {
    const r = validateRequestedServices(['ABA'], { division: DIVISION.SPECIAL_NEEDS });
    expect(r.valid).toBe(false);
  });

  it('accepts an all-allowed list', () => {
    const r = validateRequestedServices([AUTH_SERVICE.SN, AUTH_SERVICE.PT], { division: DIVISION.SPECIAL_NEEDS });
    expect(r.valid).toBe(true);
  });
});
