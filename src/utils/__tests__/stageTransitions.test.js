import { describe, it, expect, vi } from 'vitest';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../stageTransitions.js';

describe('resolveNtucDestination', () => {
  it('passes through non-NTUC stages unchanged', () => {
    const result = resolveNtucDestination({
      requestedStage: 'Intake',
      fromStage: 'Lead Entry',
      canDirect: () => false,
      userId: 'usr_1',
    });
    expect(result.effectiveStage).toBe('Intake');
    expect(result.wasIntercepted).toBe(false);
    expect(result.ntucMetadata).toEqual({});
  });

  it('allows direct NTUC for users with NTUC_DIRECT permission', () => {
    const result = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Conflict',
      canDirect: () => true,
      userId: 'usr_admin',
    });
    expect(result.effectiveStage).toBe('NTUC');
    expect(result.wasIntercepted).toBe(false);
    expect(result.ntucMetadata).toEqual({});
  });

  it('redirects NTUC to Admin Confirmation for unauthorized users', () => {
    const result = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Conflict',
      canDirect: () => false,
      userId: 'usr_regular',
    });
    expect(result.effectiveStage).toBe('Admin Confirmation');
    expect(result.wasIntercepted).toBe(true);
    expect(result.ntucMetadata.ntuc_request_origin_stage).toBe('Conflict');
    expect(result.ntucMetadata.ntuc_requested_by).toBe('usr_regular');
    expect(result.ntucMetadata.ntuc_requested_at).toBeTruthy();
  });

  it('tracks origin stage from any source stage', () => {
    const stages = ['Lead Entry', 'Eligibility Verification', 'Hold', 'Staffing Feasibility'];
    stages.forEach((fromStage) => {
      const result = resolveNtucDestination({
        requestedStage: 'NTUC',
        fromStage,
        canDirect: () => false,
        userId: 'usr_1',
      });
      expect(result.ntucMetadata.ntuc_request_origin_stage).toBe(fromStage);
    });
  });

  it('sets ntuc_requested_at to a valid ISO date', () => {
    const result = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Intake',
      canDirect: () => false,
      userId: 'usr_1',
    });
    const parsed = new Date(result.ntucMetadata.ntuc_requested_at);
    expect(parsed.getTime()).toBeGreaterThan(0);
  });
});

describe('canMoveFromTo (existing behavior preserved)', () => {
  it('allows Lead Entry to NTUC', () => {
    expect(canMoveFromTo('Lead Entry', 'NTUC')).toBe(true);
  });

  it('blocks NTUC from moving anywhere (terminal)', () => {
    expect(canMoveFromTo('NTUC', 'Lead Entry')).toBe(false);
    expect(canMoveFromTo('NTUC', 'Admin Confirmation')).toBe(false);
  });

  it('allows any active stage to Hold', () => {
    expect(canMoveFromTo('Intake', 'Hold')).toBe(true);
    expect(canMoveFromTo('Conflict', 'Hold')).toBe(true);
  });
});

describe('needsModal (NTUC always requires modal)', () => {
  it('returns true when moving to NTUC', () => {
    expect(needsModal('Conflict', 'NTUC')).toBe(true);
    expect(needsModal('Lead Entry', 'NTUC')).toBe(true);
  });

  it('returns true when moving to Hold', () => {
    expect(needsModal('Intake', 'Hold')).toBe(true);
  });
});
