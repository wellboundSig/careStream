import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, PERMISSION_CATALOG, DENY_BY_DEFAULT_PERMISSIONS } from '../../data/permissionKeys.js';
import {
  mapSpreadsheetHeaders,
  splitPersonName,
  parseFlexibleDate,
  parseOtherInsurance,
  parseCsvText,
  planRowChecks,
  summarizeOptumResult,
  buildExportRows,
  runQueuedChecks,
} from '../batchEligibility.js';

describe('permission', () => {
  it('is catalogued and deny-by-default', () => {
    expect(PERMISSION_KEYS.CLINICAL_ELIGIBILITY_BATCH).toBe('clinical.eligibility_batch');
    expect(PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.CLINICAL_ELIGIBILITY_BATCH)).toBeTruthy();
    expect(DENY_BY_DEFAULT_PERMISSIONS.has(PERMISSION_KEYS.CLINICAL_ELIGIBILITY_BATCH)).toBe(true);
  });
});

describe('mapSpreadsheetHeaders', () => {
  it('maps the roster columns case-insensitively', () => {
    const { map } = mapSpreadsheetHeaders([
      'Patient Name', 'SSN', 'Resident Type', 'Gender', 'DOB', 'DOA',
      'Medicaid ID', 'Medicare ID', 'Other Insurance', 'Skill Need',
    ]);
    expect(map.name).toBe('Patient Name');
    expect(map.medicaidId).toBe('Medicaid ID');
    expect(map.medicareId).toBe('Medicare ID');
    expect(map.otherInsurance).toBe('Other Insurance');
  });
});

describe('splitPersonName', () => {
  it('handles Last, First and First Last', () => {
    expect(splitPersonName('Hogan, Melford')).toEqual({ firstName: 'Melford', lastName: 'Hogan' });
    expect(splitPersonName('Melford Hogan')).toEqual({ firstName: 'Melford', lastName: 'Hogan' });
  });
});

describe('parseFlexibleDate', () => {
  it('accepts ISO, US, and Excel serial', () => {
    expect(parseFlexibleDate('2019-11-16')).toBe('2019-11-16');
    expect(parseFlexibleDate('11/16/2019')).toBe('2019-11-16');
    expect(parseFlexibleDate(43785)).toBe('2019-11-16');
  });
});

describe('parseOtherInsurance', () => {
  it('pulls a trailing member id when present', () => {
    expect(parseOtherInsurance('Fidelis 11315999')).toEqual({ name: 'Fidelis', memberId: '11315999' });
    expect(parseOtherInsurance('Aetna / W1234567')).toEqual({ name: 'Aetna', memberId: 'W1234567' });
    expect(parseOtherInsurance('Healthfirst')).toEqual({ name: 'Healthfirst', memberId: '' });
  });
});

describe('parseCsvText + planRowChecks', () => {
  const csv = [
    'Patient Name,SSN,Resident Type,Gender,DOB,DOA,Medicaid ID,Medicare ID,Other Insurance,Skill Need',
    'Melford Hogan,123-45-6789,ALF,M,11/16/2019,8/1/2026,AB12345A,1EG4TE5MK72,Fidelis,SN',
    'Jane Only,,,,,,AB99999A,,,',
    'Pat Skip,,,,,,,,,PT',
  ].join('\n');

  it('queues Medicare + Medicaid when IDs exist and skips empty other', () => {
    const rows = parseCsvText(csv);
    expect(rows[0].firstName).toBe('Melford');
    expect(rows[0].medicareId).toBe('1EG4TE5MK72');
    const checks = planRowChecks(rows[0]);
    expect(checks.find((c) => c.key === 'medicare').status).toBe('queued');
    expect(checks.find((c) => c.key === 'medicare').payerId).toBe('CMS');
    expect(checks.find((c) => c.key === 'medicaid').payerId).toBe('MCDNY');
    expect(checks.find((c) => c.key === 'other').status).toBe('skipped');
  });

  it('skips Medicare when the ID is empty and marks missing name/DOB', () => {
    const rows = parseCsvText(csv);
    const jane = rows.find((r) => r.nameRaw === 'Jane Only');
    const checks = planRowChecks(jane);
    expect(checks.find((c) => c.key === 'medicare').status).toBe('skipped');
    expect(checks.find((c) => c.key === 'medicaid').status).toBe('skipped');
    expect(checks.find((c) => c.key === 'medicaid').reason).toMatch(/DOB|name/i);
  });

  it('marks unknown commercial payers as unsupported (Waystar later)', () => {
    const checks = planRowChecks({
      firstName: 'A', lastName: 'B', dob: '1950-01-01',
      medicaidId: '', medicareId: '',
      otherInsuranceName: 'Some Regional Plan',
      otherInsuranceMemberId: 'XYZ999',
    });
    expect(checks.find((c) => c.key === 'other').status).toBe('unsupported');
  });

  it('queues Fidelis when a member ID is on the other-insurance column', () => {
    const checks = planRowChecks({
      firstName: 'A', lastName: 'B', dob: '1950-01-01',
      medicaidId: '', medicareId: '',
      otherInsuranceName: 'Fidelis',
      otherInsuranceMemberId: 'ABC123456',
    });
    const other = checks.find((c) => c.key === 'other');
    expect(other.status).toBe('queued');
    expect(other.payerId).toBe('11315');
    expect(other.network).toBe('optum');
  });
});

describe('runQueuedChecks + export', () => {
  it('runs only queued Optum jobs and writes result columns', async () => {
    const row = {
      nameRaw: 'Melford Hogan',
      firstName: 'Melford',
      lastName: 'Hogan',
      ssn: '123-45-6789',
      residentType: 'ALF',
      gender: 'M',
      dob: '2019-11-16',
      doa: '2026-08-01',
      medicaidId: 'AB12345A',
      medicareId: '1EG4TE5MK72',
      otherInsuranceName: '',
      otherInsuranceMemberId: '',
      skillNeed: 'SN',
      checks: planRowChecks({
        firstName: 'Melford', lastName: 'Hogan', dob: '2019-11-16',
        medicaidId: 'AB12345A', medicareId: '1EG4TE5MK72',
        otherInsuranceName: '', otherInsuranceMemberId: '',
      }),
    };
    await runQueuedChecks([row], {
      delayMs: 0,
      concurrency: 2,
      runCheck: async (_r, check) => ({
        ok: true,
        summary: {
          suggestedStatus: 'confirmed_active',
          activeCoverage: true,
          benefitCount: 2,
          planLabel: check.label,
          plainEnglish: 'Payer reported active coverage.',
        },
      }),
    });
    expect(row.checks.find((c) => c.key === 'medicare').status).toBe('done');
    expect(row.checks.find((c) => c.key === 'other').status).toBe('skipped');
    const exported = buildExportRows([row]);
    expect(exported[0]['Medicare result']).toBe('confirmed_active');
    expect(exported[0]['Checks run']).toBe(2);
  });
});

describe('summarizeOptumResult', () => {
  it('flags enrollment blocks as not usable', () => {
    const s = summarizeOptumResult({
      ok: true,
      summary: { suggestedStatus: 'unable_to_verify', enrollmentBlock: true, benefitCount: 0 },
    });
    expect(s.usable).toBe(false);
  });
});
