/**
 * Transition engine smoke + behavior tests.
 *
 * Validates that attemptTransition computes the right field updates / side
 * effects and that applyTransition performs exactly one optimistic write plus
 * audit. The exhaustive edge/guard coverage lives in transitions.table.test.js.
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
const { getStore } = await import('../../store/careStore.js');
const { seedStore } = await import('../../test/factories.js');
const airtable = (await import('../../api/airtable.js')).default;

function getRef() { return getStore().referrals.rec_ref1; }

describe('attemptTransition (pure)', () => {
  it('allows a valid edge and sets current_stage', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Lead Entry' } });
    const r = attemptTransition({ referral, toStage: 'Intake' });
    expect(r.allowed).toBe(true);
    expect(r.fieldUpdates.current_stage).toBe('Intake');
  });

  it('blocks an invalid edge with a reason', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Lead Entry' } });
    const r = attemptTransition({ referral, toStage: 'SOC Completed' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Cannot move/);
  });

  it('merges UI-sourced extraFields into the write', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Lead Entry' } });
    const r = attemptTransition({ referral, toStage: 'Intake', context: { extraFields: { intake_owner_id: 'usr_9' } } });
    expect(r.fieldUpdates.intake_owner_id).toBe('usr_9');
  });

  it('stamps hold_return_stage when moving to Hold', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Intake' } });
    const r = attemptTransition({ referral, toStage: 'Hold', context: { note: 'paused' } });
    expect(r.fieldUpdates.current_stage).toBe('Hold');
    expect(r.fieldUpdates.hold_return_stage).toBe('Intake');
    expect(r.fieldUpdates.hold_reason).toBe('paused');
  });

  it('intercepts NTUC to Admin Confirmation for non-direct users', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Conflict' } });
    const r = attemptTransition({ referral, toStage: 'NTUC', context: { note: 'n', canDirectNtuc: false } });
    expect(r.effectiveStage).toBe('Admin Confirmation');
    expect(r.wasIntercepted).toBe(true);
  });

  it('queues resolveOpenConflicts when leaving Conflict with a note', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Conflict' } });
    const r = attemptTransition({ referral, toStage: 'Intake', context: { note: 'resolved' } });
    expect(r.sideEffects.some((e) => e.type === 'resolveOpenConflicts')).toBe(true);
  });

  it('blocks Pre-SOC -> SOC Scheduled as a user move (not a declared edge)', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Pre-SOC' } });
    const r = attemptTransition({ referral, toStage: 'SOC Scheduled' });
    expect(r.allowed).toBe(false);
  });

  it('allows Pre-SOC -> SOC Scheduled as a sanctioned system move', () => {
    const { referral } = seedStore({ referral: { current_stage: 'Pre-SOC' } });
    const r = attemptTransition({ referral, toStage: 'SOC Scheduled', context: { system: true } });
    expect(r.allowed).toBe(true);
    expect(r.fieldUpdates.current_stage).toBe('SOC Scheduled');
  });
});

describe('applyTransition (writer)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('performs exactly one referral write and updates the store', async () => {
    const { referral } = seedStore({ referral: { current_stage: 'Lead Entry' } });
    const result = attemptTransition({ referral, toStage: 'Intake', context: { extraFields: { intake_owner_id: 'usr_9' } } });
    const out = await applyTransition({ referral, result, context: { actorUserId: 'usr_9' } });
    expect(out.ok).toBe(true);
    expect(getRef().current_stage).toBe('Intake');
    expect(getRef().intake_owner_id).toBe('usr_9');
    // One Referrals PATCH (audit StageHistory create is separate).
    expect(airtable.update).toHaveBeenCalledTimes(1);
  });

  it('returns not-ok for a disallowed transition without writing', async () => {
    const { referral } = seedStore({ referral: { current_stage: 'Lead Entry' } });
    const result = attemptTransition({ referral, toStage: 'SOC Completed' });
    const out = await applyTransition({ referral, result, context: {} });
    expect(out.ok).toBe(false);
    expect(getRef().current_stage).toBe('Lead Entry');
    expect(airtable.update).not.toHaveBeenCalled();
  });
});
