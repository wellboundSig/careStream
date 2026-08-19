import { describe, expect, it } from 'vitest';
import { canPerformClinicalRnReview, PERMISSION_KEYS } from '../permissionKeys.js';

describe('canPerformClinicalRnReview', () => {
  it('allows the dedicated review key or Clinical module access', () => {
    expect(canPerformClinicalRnReview((k) => k === PERMISSION_KEYS.CLINICAL_RN_REVIEW)).toBe(true);
    expect(canPerformClinicalRnReview((k) => k === PERMISSION_KEYS.MODULE_CLINICAL)).toBe(true);
    expect(canPerformClinicalRnReview(() => false)).toBe(false);
  });
});
