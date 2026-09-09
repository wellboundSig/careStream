import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CLINICAL_LEAD_PRECHECK_STAGE,
  defaultLeadStage,
  isClinicalLeadPreCheck,
  isClinicalLeadPreCheckApproved,
  restoreLeadStage,
  needsPreCheckIntakeWarning,
  hoursToClinicalLeadPreCheck,
  clinicalLeadPreCheckStampFields,
  markClinicalLeadViable,
  markClinicalLeadNotViable,
} from '../clinicalLeadPreCheck.js';
import { STAGE_META } from '../../data/stageConfig.js';
import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { flagConflict } from '../conflictFlagging.js';

vi.mock('../../engine/transitionEngine.js', () => ({
  attemptTransition: vi.fn(),
  applyTransition: vi.fn(),
}));
vi.mock('../../api/activityLog.js', () => ({
  recordActivity: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../hooks/useRefreshTrigger.js', () => ({
  triggerDataRefresh: vi.fn(),
}));
vi.mock('../conflictFlagging.js', () => ({
  flagConflict: vi.fn().mockResolvedValue({}),
  inferConflictSourceModuleFromStage: vi.fn().mockReturnValue('clinical'),
}));

describe('defaultLeadStage', () => {
  it('starts ALF leads in Clinical Lead Pre-Check by default', () => {
    expect(defaultLeadStage({ division: 'ALF' })).toBe(CLINICAL_LEAD_PRECHECK_STAGE);
  });

  it('starts Special Needs leads in Lead Entry by default (pre-check off)', () => {
    expect(defaultLeadStage({ division: 'Special Needs', code_95: 'yes' })).toBe('Lead Entry');
  });

  it('honors explicit ALF/SPN pre-check requirements', () => {
    expect(defaultLeadStage({
      division: 'ALF',
      requirements: { alf: false, sn: true },
    })).toBe('Lead Entry');
    expect(defaultLeadStage({
      division: 'Special Needs',
      code_95: 'yes',
      requirements: { alf: false, sn: true },
    })).toBe(CLINICAL_LEAD_PRECHECK_STAGE);
  });

  it('keeps SN + no Code 95 on OPWDD Enrollment regardless of the toggles', () => {
    expect(defaultLeadStage({
      division: 'Special Needs',
      code_95: 'no',
      requirements: { alf: true, sn: true },
    })).toBe('OPWDD Enrollment');
    expect(defaultLeadStage({ division: 'Special Needs', code_95: 'no' })).toBe('OPWDD Enrollment');
  });
});

describe('pre-check stamps and restore', () => {
  it('treats current_stage as the concurrent queue flag', () => {
    expect(isClinicalLeadPreCheck({ current_stage: CLINICAL_LEAD_PRECHECK_STAGE })).toBe(true);
    expect(isClinicalLeadPreCheck({ current_stage: 'Lead Entry' })).toBe(false);
  });

  it('approval is the durable stamp, not the stage name', () => {
    expect(isClinicalLeadPreCheckApproved({ current_stage: 'Lead Entry' })).toBe(false);
    expect(isClinicalLeadPreCheckApproved({
      current_stage: 'Lead Entry',
      clinical_lead_precheck_approved_at: '2026-09-04T12:00:00.000Z',
    })).toBe(true);
  });

  it('restore goes back to pre-check until Clinical has signed off', () => {
    expect(restoreLeadStage({ current_stage: 'Discarded Leads' })).toBe(CLINICAL_LEAD_PRECHECK_STAGE);
    expect(restoreLeadStage({
      current_stage: 'Discarded Leads',
      clinical_lead_precheck_approved_at: '2026-09-04T12:00:00.000Z',
    })).toBe('Lead Entry');
    expect(restoreLeadStage({
      current_stage: 'Discarded Leads',
      division: 'Special Needs',
      code_95: 'yes',
    })).toBe('Lead Entry');
  });

  it('warns on promote only while still in pre-check', () => {
    expect(needsPreCheckIntakeWarning({ current_stage: CLINICAL_LEAD_PRECHECK_STAGE })).toBe(true);
    expect(needsPreCheckIntakeWarning({ current_stage: 'Lead Entry' })).toBe(false);
  });

  it('measures hours from referral_date to sign-off', () => {
    expect(hoursToClinicalLeadPreCheck({
      referral_date: '2026-09-04T10:00:00.000Z',
      clinical_lead_precheck_approved_at: '2026-09-04T12:30:00.000Z',
    })).toBe(2.5);
    expect(hoursToClinicalLeadPreCheck({ referral_date: '2026-09-04T10:00:00.000Z' })).toBe(null);
  });

  it('stamp fields record who and when', () => {
    const fields = clinicalLeadPreCheckStampFields({
      appUserId: 'usr_rn',
      at: '2026-09-04T15:00:00.000Z',
    });
    expect(fields.clinical_lead_precheck_approved_at).toBe('2026-09-04T15:00:00.000Z');
    expect(fields.clinical_lead_precheck_approved_by_id).toBe('usr_rn');
  });
});

describe('concurrent module membership', () => {
  const leads = STAGE_META['Lead Entry'].matchReferral;
  const clinical = STAGE_META['Clinical Intake RN Review'].matchReferral;
  const intake = STAGE_META['Intake'].matchReferral;

  it('lists a pre-check lead in both Leads and Clinical Review', () => {
    const r = { current_stage: CLINICAL_LEAD_PRECHECK_STAGE };
    expect(leads(r)).toBe(true);
    expect(clinical(r)).toBe(true);
    expect(intake(r)).toBe(false);
  });

  it('drops Clinical after Mark Viable and keeps the regular Lead Entry queue', () => {
    const r = {
      current_stage: 'Lead Entry',
      clinical_lead_precheck_approved_at: '2026-09-04T12:00:00.000Z',
    };
    expect(leads(r)).toBe(true);
    expect(clinical(r)).toBe(false);
  });
});

describe('markClinicalLeadViable', () => {
  it('moves Pre-Check to Lead Entry with the approval stamp', async () => {
    const stampAt = '2026-09-04T15:00:00.000Z';
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(stampAt);
    attemptTransition.mockReturnValue({ allowed: true, fieldUpdates: {} });
    applyTransition.mockResolvedValue({ ok: true });
    const referral = { _id: 'rec1', id: 'ref_1', patient_id: 'pat_1', current_stage: CLINICAL_LEAD_PRECHECK_STAGE };
    const left = vi.fn();
    await markClinicalLeadViable({ referral, appUserId: 'usr_rn', onLeftModule: left });
    expect(left).toHaveBeenCalled();
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      referral,
      toStage: 'Lead Entry',
      context: expect.objectContaining({
        system: true,
        extraFields: {
          clinical_lead_precheck_approved_at: stampAt,
          clinical_lead_precheck_approved_by_id: 'usr_rn',
        },
      }),
    }));
    Date.prototype.toISOString.mockRestore();
  });
});

describe('markClinicalLeadNotViable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attemptTransition.mockReturnValue({ allowed: true, fieldUpdates: { current_stage: 'Conflict' } });
    applyTransition.mockResolvedValue({ ok: true });
    flagConflict.mockResolvedValue({});
  });

  it('requires a conflict note', async () => {
    const referral = {
      _id: 'rec1', id: 'ref_1', patient_id: 'pat_1',
      current_stage: CLINICAL_LEAD_PRECHECK_STAGE,
    };
    await expect(markClinicalLeadNotViable({
      referral,
      appUserId: 'usr_rn',
      conflict: { category: 'other', severity: 'High', description: '   ' },
    })).rejects.toThrow(/note are required/i);
    expect(flagConflict).not.toHaveBeenCalled();
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it('flags a conflict, mentions account managers, and moves to Conflict', async () => {
    const referral = {
      _id: 'rec1', id: 'ref_1', patient_id: 'pat_1',
      current_stage: CLINICAL_LEAD_PRECHECK_STAGE,
    };
    const left = vi.fn();
    await markClinicalLeadNotViable({
      referral,
      appUserId: 'usr_rn',
      actorName: 'Vanessa Villa',
      conflict: { category: 'other', severity: 'High', description: 'Not a skilled need' },
      onLeftModule: left,
    });
    expect(flagConflict).toHaveBeenCalledWith(expect.objectContaining({
      referral,
      actorUserId: 'usr_rn',
      category: 'other',
      severity: 'High',
      description: 'Not a skilled need',
      origin: 'clinical_lead_not_viable',
      mentionAccountManagerInfo: true,
    }));
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      referral,
      toStage: 'Conflict',
    }));
    expect(left).toHaveBeenCalled();
    expect(applyTransition).toHaveBeenCalled();
  });
});
