import { describe, it, expect } from 'vitest';
import {
  byBusinessId,
  resolveTaskDivision,
  divisionVisible,
  filterTasksByDivision,
} from '../taskDivision.js';

const patientsById = {
  pat_alf: { id: 'pat_alf', division: 'ALF' },
  pat_sn: { id: 'pat_sn', division: 'Special Needs' },
  pat_nodiv: { id: 'pat_nodiv' },
};
const referralsById = {
  ref_alf: { id: 'ref_alf', division: 'ALF' },
  ref_sn: { id: 'ref_sn', division: 'Special Needs' },
};

const snOnly = (d) => d === 'Special Needs';
const both = () => true;

describe('resolveTaskDivision', () => {
  it('uses the patient division first', () => {
    expect(resolveTaskDivision({ patient_id: 'pat_alf' }, { patientsById, referralsById })).toBe('ALF');
  });
  it('falls back to the referral division when the patient has none', () => {
    expect(resolveTaskDivision({ patient_id: 'pat_nodiv', referral_id: 'ref_sn' }, { patientsById, referralsById })).toBe('Special Needs');
  });
  it('null for general tasks with no patient or referral', () => {
    expect(resolveTaskDivision({ title: 'Order supplies' }, { patientsById, referralsById })).toBeNull();
  });
});

describe('divisionVisible', () => {
  it('permission gate: SPN-only user never sees ALF', () => {
    expect(divisionVisible('ALF', { hasDivision: snOnly, division: 'All' })).toBe(false);
    expect(divisionVisible('Special Needs', { hasDivision: snOnly, division: 'All' })).toBe(true);
  });
  it('switcher narrows within permitted divisions', () => {
    expect(divisionVisible('ALF', { hasDivision: both, division: 'Special Needs' })).toBe(false);
    expect(divisionVisible('ALF', { hasDivision: both, division: 'ALF' })).toBe(true);
  });
  it('division-less items are always visible', () => {
    expect(divisionVisible(null, { hasDivision: snOnly, division: 'ALF' })).toBe(true);
  });
});

describe('filterTasksByDivision', () => {
  const tasks = [
    { id: 't1', patient_id: 'pat_alf' },
    { id: 't2', patient_id: 'pat_sn' },
    { id: 't3', referral_id: 'ref_alf' },
    { id: 't4' }, // general task
  ];

  it('SPN-only user (like Mia): ALF tasks are hidden everywhere', () => {
    const out = filterTasksByDivision(tasks, { hasDivision: snOnly, division: 'All', patientsById, referralsById });
    expect(out.map((t) => t.id)).toEqual(['t2', 't4']);
  });

  it('full-access user with ALF switcher active', () => {
    const out = filterTasksByDivision(tasks, { hasDivision: both, division: 'ALF', patientsById, referralsById });
    expect(out.map((t) => t.id)).toEqual(['t1', 't3', 't4']);
  });

  it('byBusinessId accepts store maps and arrays', () => {
    expect(byBusinessId({ recA: { id: 'x' } }).x).toBeTruthy();
    expect(byBusinessId([{ id: 'y' }]).y).toBeTruthy();
  });
});
