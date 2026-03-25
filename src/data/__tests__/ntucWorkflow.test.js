import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, PERMISSION_CATALOG } from '../permissionKeys.js';
import StageRules from '../StageRules.json';
import { STAGE_META } from '../stageConfig.js';

describe('NTUC request workflow — permission keys', () => {
  it('defines REFERRAL_NTUC_DIRECT permission', () => {
    expect(PERMISSION_KEYS.REFERRAL_NTUC_DIRECT).toBe('referral.ntuc_direct');
  });

  it('has a catalog entry for NTUC_DIRECT', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.REFERRAL_NTUC_DIRECT);
    expect(entry).toBeTruthy();
    expect(entry.description.toLowerCase()).toContain('skip admin confirmation');
  });

  it('REFERRAL_NTUC still exists (not removed)', () => {
    expect(PERMISSION_KEYS.REFERRAL_NTUC).toBe('referral.ntuc');
  });
});

describe('NTUC request workflow — stage rules', () => {
  it('Admin Confirmation can move to NTUC (for confirming requests)', () => {
    expect(StageRules.stages['Admin Confirmation'].canMoveTo).toContain('NTUC');
  });

  it('Admin Confirmation can move to Conflict (for denying requests)', () => {
    expect(StageRules.stages['Admin Confirmation'].canMoveTo).toContain('Conflict');
  });

  it('Admin Confirmation can move back to most stages (for send-back)', () => {
    const canMoveTo = StageRules.stages['Admin Confirmation'].canMoveTo;
    expect(canMoveTo).toContain('Lead Entry');
    expect(canMoveTo).toContain('Intake');
    expect(canMoveTo).toContain('Eligibility Verification');
    expect(canMoveTo).toContain('Conflict');
    expect(canMoveTo).toContain('Staffing Feasibility');
  });

  it('Admin Confirmation description mentions NTUC confirmation', () => {
    const desc = StageRules.stages['Admin Confirmation'].description;
    expect(desc.toLowerCase()).toContain('ntuc');
  });

  it('NTUC is terminal and requires note', () => {
    expect(StageRules.stages['NTUC'].terminal).toBe(true);
    expect(StageRules.stages['NTUC'].requiresNote).toBe(true);
  });
});

describe('NTUC request workflow — UI metadata', () => {
  it('Admin Confirmation STAGE_META description mentions NTUC', () => {
    const desc = STAGE_META['Admin Confirmation'].description;
    expect(desc.toLowerCase()).toContain('ntuc');
  });
});
