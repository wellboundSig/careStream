/**
 * Urgent care ⇒ High priority coupling.
 * Marking a case urgent bumps priority to High for reporting; the bump is a
 * one-way door — clearing urgent care never downgrades, and existing
 * High/Critical priorities are left alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/activityLog.js', () => ({
  recordActivity: vi.fn().mockResolvedValue({}),
}));

import { updateReferralOptimistic } from '../../store/mutations.js';
import {
  setUrgentCare,
  setUrgentCareType,
  urgentCareTypeColor,
  urgentCareTypeBg,
  parseUrgentCareTypes,
} from '../urgentCare.js';

function lastWrite() {
  return updateReferralOptimistic.mock.calls.at(-1)[1];
}

beforeEach(() => {
  updateReferralOptimistic.mockClear();
});

describe('setUrgentCare priority coupling', () => {
  it('bumps a Normal-priority case to High when marked urgent', async () => {
    await setUrgentCare({
      referral: { _id: 'rec_1', priority: 'Normal' },
      next: true,
      actorUserId: 'usr_a',
    });
    expect(lastWrite()).toMatchObject({ requires_urgent_care: true, priority: 'High' });
  });

  it('bumps a blank-priority case to High', async () => {
    await setUrgentCare({ referral: { _id: 'rec_2' }, next: true, actorUserId: 'usr_a' });
    expect(lastWrite().priority).toBe('High');
  });

  it('never downgrades Critical', async () => {
    await setUrgentCare({
      referral: { _id: 'rec_3', priority: 'Critical' },
      next: true,
      actorUserId: 'usr_a',
    });
    expect(lastWrite().priority).toBeUndefined();
  });

  it('clearing urgent care leaves priority untouched', async () => {
    await setUrgentCare({
      referral: { _id: 'rec_4', priority: 'High', requires_urgent_care: true },
      next: false,
      actorUserId: 'usr_a',
    });
    expect(lastWrite().priority).toBeUndefined();
    expect(lastWrite().requires_urgent_care).toBe(false);
  });
});

describe('setUrgentCareType priority coupling', () => {
  it('selecting a type on a non-urgent case turns urgent on and bumps priority', async () => {
    await setUrgentCareType({
      referral: { _id: 'rec_5', priority: 'Low' },
      types: ['wound'],
      actorUserId: 'usr_a',
    });
    expect(lastWrite()).toMatchObject({
      requires_urgent_care: true,
      urgent_care_type: 'wound',
      priority: 'High',
    });
  });

  it('changing the type on an already-urgent case does not rewrite priority', async () => {
    await setUrgentCareType({
      referral: { _id: 'rec_6', priority: 'High', requires_urgent_care: true },
      types: ['insulin'],
      actorUserId: 'usr_a',
    });
    expect(lastWrite().priority).toBeUndefined();
  });
});

describe('urgent care type colors', () => {
  it('gives each type its own color', () => {
    const wound = urgentCareTypeColor('wound');
    const insulin = urgentCareTypeColor('insulin');
    const injection = urgentCareTypeColor('injection');
    expect(wound).toMatch(/^#/);
    expect(insulin).toMatch(/^#/);
    expect(injection).toMatch(/^#/);
    expect(new Set([wound, insulin, injection]).size).toBe(3);
  });

  it('keeps a fallback color for unknown / empty type', () => {
    expect(urgentCareTypeColor()).toBe(urgentCareTypeColor('wound'));
    expect(urgentCareTypeBg()).toMatch(/^#/);
  });

  it('still parses comma-separated and legacy both', () => {
    expect(parseUrgentCareTypes('wound,injection')).toEqual(['wound', 'injection']);
    expect(parseUrgentCareTypes('both')).toEqual(['wound', 'insulin']);
  });
});
