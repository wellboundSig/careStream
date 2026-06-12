import { describe, it, expect, vi } from 'vitest';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../stageTransitions.js';
import StageRules from '../../data/StageRules.json';

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
  it('blocks Lead Entry → NTUC under the tightened rules (Leads only go to Intake/Discarded/OPWDD)', () => {
    // Per the 2026-05-20 workflow overhaul, leads can ONLY go to Intake,
    // Discarded Leads, or OPWDD Enrollment. NTUC is no longer a direct
    // destination — those decisions happen after Intake review.
    expect(canMoveFromTo('Lead Entry', 'NTUC')).toBe(false);
    expect(canMoveFromTo('Lead Entry', 'Intake')).toBe(true);
    expect(canMoveFromTo('Lead Entry', 'Discarded Leads')).toBe(true);
    expect(canMoveFromTo('Lead Entry', 'OPWDD Enrollment')).toBe(true);
  });

  it('blocks NTUC from moving anywhere (terminal)', () => {
    expect(canMoveFromTo('NTUC', 'Lead Entry')).toBe(false);
    expect(canMoveFromTo('NTUC', 'Admin Confirmation')).toBe(false);
  });

  it('allows any active stage to Hold', () => {
    expect(canMoveFromTo('Intake', 'Hold')).toBe(true);
    expect(canMoveFromTo('Conflict', 'Hold')).toBe(true);
  });

  it('allows Intake → Clinical Intake RN Review (push to Clinical RN leaves Intake)', () => {
    // 2026-05-29: pushing to Clinical RN now moves the patient out of Intake,
    // so the edge must exist for pipeline/context-menu moves too.
    expect(canMoveFromTo('Intake', 'Clinical Intake RN Review')).toBe(true);
  });

  it('Conflict → every active routing destination is a valid edge', () => {
    // Drift detector for the Conflict panel: the "Resolve and send to…"
    // dropdown is derived from StageRules.Conflict.canMoveTo, so every entry
    // must round-trip through canMoveFromTo. If anyone ever hand-edits the
    // dropdown or trims the canMoveTo list, this test flags it before users
    // hit a "Cannot move from Conflict to X" toast.
    const destinations = StageRules.stages.Conflict.canMoveTo;
    expect(destinations.length).toBeGreaterThan(0);
    for (const dest of destinations) {
      expect(canMoveFromTo('Conflict', dest), `Conflict → ${dest}`).toBe(true);
    }
  });

  it('Conflict can route to OPWDD Enrollment (regression: dropdown previously rejected)', () => {
    // 2026-06-12: OPWDD Enrollment was in the dropdown but missing from the
    // canMoveTo list, so picking it produced a "failed" toast. Pin both ends.
    expect(canMoveFromTo('Conflict', 'OPWDD Enrollment')).toBe(true);
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
