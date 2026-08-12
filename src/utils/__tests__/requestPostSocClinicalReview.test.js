import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateReferralOptimistic = vi.fn(async () => ({}));
const createNoteOptimistic = vi.fn(async () => ({}));
const recordActivity = vi.fn(async () => ({}));
const createNotification = vi.fn(async () => ({}));

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: (...args) => updateReferralOptimistic(...args),
  createNoteOptimistic: (...args) => createNoteOptimistic(...args),
}));

vi.mock('../../api/activityLog.js', () => ({
  recordActivity: (...args) => recordActivity(...args),
}));

vi.mock('../../api/notifications.js', () => ({
  createNotification: (...args) => createNotification(...args),
}));

const {
  canRequestPostSocClinical,
  listClinicalRnUsers,
  requestPostSocClinicalReview,
  postSocClinicalCompleteClearFields,
} = await import('../requestPostSocClinicalReview.js');

describe('requestPostSocClinicalReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists clinical / COC role users and COC-facility linked users', () => {
    const users = {
      a: { id: 'usr_rn', first_name: 'Ann', last_name: 'RN', status: 'Active', role_id: 'role_clin' },
      b: { id: 'usr_mkt', first_name: 'Max', last_name: 'Mkt', status: 'Active', role_id: 'role_mkt' },
      c: { id: 'usr_coc', first_name: 'Cara', last_name: 'Coc', status: 'Active', role_id: 'role_other' },
    };
    const roles = {
      r1: { id: 'role_clin', name: 'Clinical Intake RN' },
      r2: { id: 'role_mkt', name: 'Marketer' },
      r3: { id: 'role_other', name: 'Staff' },
    };
    const cocNurseFacilities = {
      l1: { user_id: 'usr_coc', facility_id: 'fac_1' },
    };
    const list = listClinicalRnUsers({ users, roles, cocNurseFacilities });
    expect(list.map((u) => u.id).sort()).toEqual(['usr_coc', 'usr_rn']);
  });

  it('canRequestPostSocClinical only for SOC completed without clinical done', () => {
    expect(canRequestPostSocClinical({
      _id: 'r1',
      soc_completed_date: '2026-08-01',
    })).toBe(true);
    expect(canRequestPostSocClinical({
      _id: 'r1',
      soc_completed_date: '2026-08-01',
      clinical_review_completed_at: '2026-08-02',
    })).toBe(false);
    expect(canRequestPostSocClinical({ _id: 'r1' })).toBe(false);
  });

  it('assigns RN, sets in_clinical_review, notifies assignee', async () => {
    const referral = {
      _id: 'recR1',
      id: 'ref_1',
      patient_id: 'pat_1',
      patientName: 'Chris Persaud',
      soc_completed_date: '2026-08-01',
      current_stage: 'Intake',
    };

    const { fields } = await requestPostSocClinicalReview({
      referral,
      assigneeUserId: 'usr_rn',
      actorUserId: 'usr_mkt',
      actorName: 'Marketer Sam',
      assigneeName: 'Ann RN',
      patientLabel: 'Chris Persaud',
    });

    expect(fields.in_clinical_review).toBe(true);
    expect(fields.clinical_review_assigned_to_id).toBe('usr_rn');
    expect(fields.clinical_review_assigned_by_id).toBe('usr_mkt');
    expect(fields).not.toHaveProperty('current_stage');

    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      in_clinical_review: true,
      clinical_review_assigned_to_id: 'usr_rn',
    }));
    expect(createNoteOptimistic).toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'clinical_review_assigned',
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_rn',
      type: 'clinical_review_assigned',
      title: expect.stringMatching(/post-SOC/i),
    }));
  });

  it('does not notify when assigning to self', async () => {
    await requestPostSocClinicalReview({
      referral: {
        _id: 'recR1',
        id: 'ref_1',
        patient_id: 'pat_1',
        soc_completed_date: '2026-08-01',
      },
      assigneeUserId: 'usr_rn',
      actorUserId: 'usr_rn',
      actorName: 'Ann',
      assigneeName: 'Ann',
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('rejects when clinical already complete', async () => {
    await expect(requestPostSocClinicalReview({
      referral: {
        _id: 'recR1',
        soc_completed_date: '2026-08-01',
        clinical_review_completed_at: '2026-08-02',
      },
      assigneeUserId: 'usr_rn',
      actorUserId: 'usr_mkt',
    })).rejects.toThrow(/already complete/i);
    expect(updateReferralOptimistic).not.toHaveBeenCalled();
  });

  it('postSocClinicalCompleteClearFields clears assignment stamps', () => {
    expect(postSocClinicalCompleteClearFields()).toEqual({
      clinical_review_assigned_to_id: null,
      clinical_review_assigned_at: null,
      clinical_review_assigned_by_id: null,
    });
  });
});
