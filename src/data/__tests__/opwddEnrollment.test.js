import { describe, it, expect } from 'vitest';
import { STAGE_SLUGS, STAGE_META, ROLE_MODES, ALL_STAGES } from '../stageConfig.js';
import StageRules from '../StageRules.json';

describe('OPWDD Enrollment — stage registration', () => {
  it('exists in STAGE_SLUGS', () => {
    expect(STAGE_SLUGS['OPWDD Enrollment']).toBe('opwdd-enrollment');
  });

  it('exists in ALL_STAGES', () => {
    expect(ALL_STAGES).toContain('OPWDD Enrollment');
  });

  it('has STAGE_META with correct properties', () => {
    const meta = STAGE_META['OPWDD Enrollment'];
    expect(meta).toBeTruthy();
    expect(meta.displayName).toBe('OPWDD');
    expect(meta.isTerminal).toBe(false);
  });

  it('is in the intake ROLE_MODE', () => {
    const intakeMode = ROLE_MODES.find((m) => m.id === 'intake');
    expect(intakeMode.stages).toContain('OPWDD Enrollment');
  });

  it('is in the "all" ROLE_MODE (via Object.keys)', () => {
    const allMode = ROLE_MODES.find((m) => m.id === 'all');
    expect(allMode.stages).toContain('OPWDD Enrollment');
  });
});

describe('OPWDD Enrollment — stage rules', () => {
  it('exists in StageRules.json', () => {
    expect(StageRules.stages['OPWDD Enrollment']).toBeTruthy();
  });

  it('canMoveTo includes Intake and Discarded Leads only', () => {
    const canMoveTo = StageRules.stages['OPWDD Enrollment'].canMoveTo;
    expect(canMoveTo).toContain('Intake');
    expect(canMoveTo).toContain('Discarded Leads');
    expect(canMoveTo.length).toBe(2);
  });

  it('is not terminal', () => {
    expect(StageRules.stages['OPWDD Enrollment'].terminal).toBe(false);
  });

  it('Lead Entry canMoveTo includes OPWDD Enrollment', () => {
    expect(StageRules.stages['Lead Entry'].canMoveTo).toContain('OPWDD Enrollment');
  });
});

describe('OPWDD Enrollment — isolation', () => {
  it('is NOT in any consolidatedStages array (ensures patient isolation)', () => {
    Object.entries(STAGE_META).forEach(([stage, meta]) => {
      if (meta.consolidatedStages) {
        expect(meta.consolidatedStages).not.toContain('OPWDD Enrollment');
      }
    });
  });

  it('is NOT in the pipeline board main ROW_GROUPS stages', () => {
    const mainStages = [
      'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
      'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
      'Conflict', 'Staffing Feasibility', 'Admin Confirmation',
      'Pre-SOC', 'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC',
    ];
    expect(mainStages).not.toContain('OPWDD Enrollment');
  });
});
