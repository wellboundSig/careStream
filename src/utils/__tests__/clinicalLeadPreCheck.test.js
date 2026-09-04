import { describe, it, expect, vi } from 'vitest';
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
} from '../clinicalLeadPreCheck.js';
import { STAGE_META } from '../../data/stageConfig.js';
import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';

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

describe('defaultLeadStage', () => {
  it('starts ordinary leads in Clinical Lead Pre-Check', () => {
    expect(defaultLeadStage({ division: 'ALF' })).toBe(CLINICAL_LEAD_PRECHECK_STAGE);
    expect(defaultLeadStage({ division: 'Special Needs', code_95: 'yes' })).toBe(CLINICAL_LEAD_PRECHECK_STAGE);
  });

  it('keeps SN + no Code 95 on OPWDD Enrollment', () => {
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
