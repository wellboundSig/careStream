/**
 * Critical-journey smoke tests (thin E2E through the real engine).
 *
 * A SMALL, curated set of the highest-risk end-to-end flows, driven through the
 * actual transition engine + store (not the low-level mutation helpers). These
 * are the "if this breaks, we ship a broken product" paths. Keep this file
 * small — exhaustive coverage lives in the table + property tests; this is a
 * smoke layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/airtable.js', () => {
  const mk = () => ({
    update: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    create: vi.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
    remove: vi.fn().mockResolvedValue({ id: 'rec_1', deleted: true }),
    fetchAll: vi.fn().mockResolvedValue([]),
    fetchOne: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    createBatch: vi.fn().mockResolvedValue([]),
    updateBatch: vi.fn().mockResolvedValue([]),
  });
  return { default: mk(), airtable: mk() };
});

const { attemptTransition, applyTransition } = await import('../transitionEngine.js');
const { getStore, mergeEntities } = await import('../../store/careStore.js');
const { seedStore } = await import('../../test/factories.js');

function ref() { return getStore().referrals.rec_ref1; }

async function move(toStage, context = {}) {
  const referral = ref();
  const result = attemptTransition({ referral, toStage, context: { actorUserId: 'usr_1', ...context } });
  expect(result.allowed, `move to ${toStage} should be allowed: ${result.reason || ''}`).toBe(true);
  await applyTransition({ referral, result, context: { actorUserId: 'usr_1' } });
  return result;
}

describe('CRITICAL JOURNEY: ALF happy path (Lead Entry -> SOC Completed)', () => {
  beforeEach(() => { seedStore({ referral: { current_stage: 'Lead Entry' } }); });

  it('walks the full pipeline through the engine', async () => {
    await move('Intake', { extraFields: { intake_owner_id: 'usr_owner' } });
    expect(ref().current_stage).toBe('Intake');
    expect(ref().intake_owner_id).toBe('usr_owner');

    // Push to Clinical RN (sanctioned action).
    await move('Clinical Intake RN Review', { extraFields: { in_clinical_review: true } });
    expect(ref().current_stage).toBe('Clinical Intake RN Review');

    // Clinical confirm -> EMR Onboarding (sets the decision, as the panel does).
    await move('EMR Onboarding', { extraFields: { clinical_review_decision: 'accept', clinical_review_completed_at: 'now' } });
    expect(ref().current_stage).toBe('EMR Onboarding');
    expect(ref().clinical_review_decision).toBe('accept');

    await move('Staffing Feasibility', { extraFields: { emr_onboarded_at: 'now' } });
    expect(ref().current_stage).toBe('Staffing Feasibility');

    await move('Pre-SOC');
    expect(ref().current_stage).toBe('Pre-SOC');

    // Pre-SOC -> SOC Scheduled is a sanctioned sub-state (system) move.
    await move('SOC Scheduled', { system: true, extraFields: { soc_scheduled_date: '2026-07-01' } });
    expect(ref().current_stage).toBe('SOC Scheduled');

    await move('SOC Completed', { system: true, extraFields: { soc_completed_date: '2026-07-02' } });
    expect(ref().current_stage).toBe('SOC Completed');
  });
});

describe('CRITICAL JOURNEY: Conflict round-trip', () => {
  beforeEach(() => { seedStore({ referral: { current_stage: 'Eligibility Verification' } }); });

  it('routes to Conflict and resolves back to the source stage', async () => {
    await move('Conflict', { note: 'insurance mismatch' });
    expect(ref().current_stage).toBe('Conflict');

    // Seed an open conflict so the leave-Conflict auto-resolve has something to do.
    mergeEntities('conflicts', {
      c1: { _id: 'c1', id: 'conf_1', referral_id: 'ref_001', status: 'Open' },
    });

    await move('Eligibility Verification', { note: 'resolved — coverage confirmed' });
    expect(ref().current_stage).toBe('Eligibility Verification');
    // Auto-resolve fired: the open conflict is now Resolved in the store.
    expect(getStore().conflicts.c1.status).toBe('Resolved');
  });
});

describe('CRITICAL JOURNEY: NTUC request interception', () => {
  beforeEach(() => { seedStore({ referral: { current_stage: 'Conflict' } }); });

  it('non-direct NTUC requests are intercepted to Admin Confirmation', async () => {
    const referral = ref();
    const result = attemptTransition({ referral, toStage: 'NTUC', context: { note: 'reviewing', canDirectNtuc: false, actorUserId: 'usr_1' } });
    expect(result.effectiveStage).toBe('Admin Confirmation');
    await applyTransition({ referral, result, context: { actorUserId: 'usr_1' } });
    expect(ref().current_stage).toBe('Admin Confirmation');
    expect(ref().ntuc_request_origin_stage).toBe('Conflict');
  });
});

describe('CRITICAL JOURNEY: Eligibility re-check', () => {
  beforeEach(() => {
    seedStore({ referral: { current_stage: 'Eligibility Verification', eligibility_completed_at: '2026-01-01' } });
  });

  it('entering Eligibility Verification clears the prior completion (re-check gate)', async () => {
    // Simulate a move INTO Eligibility Verification from Intake (re-check request).
    seedStore({ referral: { current_stage: 'Intake', eligibility_completed_at: '2026-01-01' } });
    await move('Eligibility Verification');
    expect(ref().current_stage).toBe('Eligibility Verification');
    expect(ref().eligibility_completed_at).toBe('');
    expect(ref().eligibility_recheck_requested_at).toBeTruthy();
  });
});
