import { describe, it, expect } from 'vitest';
import { REFERRAL_METHODS, normalizeReferralMethod } from '../sourceConstants.js';

describe('normalizeReferralMethod', () => {
  it('returns empty for blank', () => {
    expect(normalizeReferralMethod('')).toBe('');
    expect(normalizeReferralMethod(null)).toBe('');
  });

  it('passes through canonical values', () => {
    for (const m of REFERRAL_METHODS) {
      expect(normalizeReferralMethod(m)).toBe(m);
    }
  });

  it('maps historical labels', () => {
    expect(normalizeReferralMethod('word of mouth')).toBe('Word of Mouth');
    expect(normalizeReferralMethod('Facebook Ads')).toBe('Facebook Ads');
    expect(normalizeReferralMethod('self-referral')).toBe('Patient Self-Referral');
    expect(normalizeReferralMethod('web lead')).toBe('Website');
    expect(normalizeReferralMethod('Call-In / Word of Mouth')).toBe('Word of Mouth');
  });

  it('returns empty for unknown free text', () => {
    expect(normalizeReferralMethod('Judith Campos')).toBe('');
  });
});
