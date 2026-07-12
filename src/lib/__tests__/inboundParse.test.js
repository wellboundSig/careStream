import { describe, it, expect } from 'vitest';
import { parseInboundEmail, parsedToFormPrefill } from '../inboundParse.js';

describe('parseInboundEmail', () => {
  it('never treats sender as patient', () => {
    const parsed = parseInboundEmail({
      from_name: 'Jane Case Manager',
      from_email: 'jane@facility.org',
      subject: 'Hello',
      body_text: 'Please call me back.',
    });
    expect(parsed.referrer_name).toBe('Jane Case Manager');
    expect(parsed.referrer_email).toBe('jane@facility.org');
    expect(parsed.patient_name).toBeFalsy();
  });

  it('extracts labeled patient fields with high confidence', () => {
    const parsed = parseInboundEmail({
      from_name: 'Discharge Desk',
      from_email: 'dc@hospital.org',
      subject: 'New referral',
      body_text: `
Patient: Smith, Mary
DOB: 03/15/1948
Phone: (718) 555-0199
Insurance: Fidelis
Facility: Sunrise ALF
      `,
    });
    expect(parsed.patient_name).toBe('Smith, Mary');
    expect(parsed.patient_first).toBe('Mary');
    expect(parsed.patient_last).toBe('Smith');
    expect(parsed.confidence.patient_name).toBe('high');
    expect(parsed.dob).toMatch(/1948/);
    expect(parsed.phone).toMatch(/718/);
    expect(parsed.insurance).toMatch(/Fidelis/i);
    expect(parsed.facility).toMatch(/Sunrise/i);
  });

  it('prefills only high/medium confidence into form fields', () => {
    const parsed = parseInboundEmail({
      from_name: 'RN',
      from_email: 'rn@x.com',
      subject: 'Referral for John Adams',
      body_text: 'Patient: John Adams\nDOB: 01/02/1950',
    });
    const prefill = parsedToFormPrefill(parsed);
    expect(prefill.first_name).toBe('John');
    expect(prefill.last_name).toBe('Adams');
    expect(prefill.dob).toBeTruthy();
    expect(prefill.initial_notes).toMatch(/referrer/i);
  });
});
