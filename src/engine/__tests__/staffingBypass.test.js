/**
 * Staffing bypass: a referral whose visit is already scheduled (or done) must
 * never stop in Staffing Feasibility — scheduling implies staffing was
 * already secured. The interception lives in attemptTransition so every door
 * (eligibility auto-advance, clinical confirm, EMR advance, manual moves)
 * gets the same behavior.
 */
import { describe, it, expect } from 'vitest';
import { attemptTransition } from '../transitionEngine.js';
import { resolveStaffingBypass } from '../../utils/stageTransitions.js';

const base = {
  _id: 'recTest1',
  id: 'ref_test_1',
  patient_id: 'pat_test_1',
  current_stage: 'EMR Onboarding',
};

const attempt = (referral, context = {}) => attemptTransition({
  referral,
  toStage: 'Staffing Feasibility',
  context: { system: true, actorUserId: 'usr_1', ...context },
});

describe('resolveStaffingBypass', () => {
  it('null when no visit is scheduled or completed (normal staffing flow)', () => {
    expect(resolveStaffingBypass(base)).toBeNull();
  });

  it('scheduled visit routes to SOC Scheduled', () => {
    const r = resolveStaffingBypass({ ...base, soc_scheduled_date: '2026-09-15' });
    expect(r.stage).toBe('SOC Scheduled');
  });

  it('completed visit with open paperwork routes to Intake', () => {
    const r = resolveStaffingBypass({
      ...base,
      soc_completed_date: '2026-09-10',
      documentation_deferred: true, // open docs, not cleared
    });
    expect(r.stage).toBe('Intake');
  });

  it('completed visit with everything closed routes to Completed', () => {
    const r = resolveStaffingBypass({
      ...base,
      soc_completed_date: '2026-09-10',
      documentation_deferred: false,
      clinical_review_decision: 'accept',
      clinical_review_completed_at: '2026-09-11',
    });
    expect(r.stage).toBe('Completed');
  });
});

describe('attemptTransition — staffing bypass interception', () => {
  it('no scheduled visit: lands in Staffing Feasibility normally', () => {
    const result = attempt(base);
    expect(result.allowed).toBe(true);
    expect(result.effectiveStage).toBe('Staffing Feasibility');
    expect(result.wasStaffingBypassed).toBe(false);
  });

  it('scheduled visit: redirected to SOC Scheduled with an audit tag', () => {
    const result = attempt({ ...base, soc_scheduled_date: '2026-09-15T00:00:00Z' });
    expect(result.allowed).toBe(true);
    expect(result.effectiveStage).toBe('SOC Scheduled');
    expect(result.fieldUpdates.current_stage).toBe('SOC Scheduled');
    expect(result.wasStaffingBypassed).toBe(true);
    expect(result.auditNote).toContain('Auto-routed past Staffing');
  });

  it('completed visit, everything closed: redirected straight to Completed', () => {
    const result = attempt({
      ...base,
      soc_completed_date: '2026-09-10T00:00:00Z',
      clinical_review_decision: 'accept',
      clinical_review_completed_at: '2026-09-11T00:00:00Z',
    });
    expect(result.effectiveStage).toBe('Completed');
    expect(result.wasStaffingBypassed).toBe(true);
  });

  it('completed visit, paperwork open: redirected to Intake', () => {
    const result = attempt({
      ...base,
      soc_completed_date: '2026-09-10T00:00:00Z',
      documentation_deferred: 'true',
    });
    expect(result.effectiveStage).toBe('Intake');
    expect(result.wasStaffingBypassed).toBe(true);
  });

  it('honors a schedule stamped in the same write via extraFields', () => {
    const result = attempt(base, { extraFields: { soc_scheduled_date: '2026-10-01' } });
    expect(result.effectiveStage).toBe('SOC Scheduled');
    expect(result.wasStaffingBypassed).toBe(true);
  });

  it('caller note is preserved alongside the bypass tag', () => {
    const result = attempt(
      { ...base, soc_scheduled_date: '2026-09-15' },
      { note: '[Eligibility complete]' },
    );
    expect(result.auditNote).toContain('[Eligibility complete]');
    expect(result.auditNote).toContain('Auto-routed past Staffing');
  });

  it('declared user edge (non-system) also gets intercepted', () => {
    const result = attemptTransition({
      referral: { ...base, current_stage: 'EMR Onboarding', soc_scheduled_date: '2026-09-15' },
      toStage: 'Staffing Feasibility',
      context: { actorUserId: 'usr_1' },
    });
    // EMR Onboarding → Staffing Feasibility is a declared edge; the bypass
    // still redirects the destination.
    expect(result.allowed).toBe(true);
    expect(result.effectiveStage).toBe('SOC Scheduled');
  });
});
