import { describe, it, expect } from 'vitest';
import {
  isOpenClinicalReview,
  clinicalReviewEnteredAt,
  daysInClinicalReview,
  enrichReferralWithMetrics,
  isOnTrackStaffing,
  staffingEnteredAt,
  daysInStaffing,
} from '../referralMetrics.js';

describe('clinical review queue timing', () => {
  it('treats pipeline Clinical, in_clinical_review, and open assignment as in-queue', () => {
    expect(isOpenClinicalReview({ current_stage: 'Clinical Intake RN Review' })).toBe(true);
    expect(isOpenClinicalReview({ current_stage: 'SOC Completed', in_clinical_review: true })).toBe(true);
    expect(isOpenClinicalReview({
      current_stage: 'SOC Completed',
      clinical_review_assigned_to_id: 'usr_rn',
    })).toBe(true);
    expect(isOpenClinicalReview({
      current_stage: 'SOC Completed',
      clinical_review_assigned_to_id: 'usr_rn',
      clinical_review_completed_at: '2026-08-01',
    })).toBe(false);
    expect(isOpenClinicalReview({ current_stage: 'SOC Completed' })).toBe(false);
  });

  it('prefers assigned-at, then pushed-at, then stage entry when Clinical is the stage', () => {
    expect(clinicalReviewEnteredAt({
      current_stage: 'SOC Completed',
      in_clinical_review: true,
      clinical_review_assigned_at: '2026-08-18T12:00:00Z',
      clinical_review_pushed_at: '2026-08-01T12:00:00Z',
    })).toBe('2026-08-18T12:00:00Z');

    expect(clinicalReviewEnteredAt({
      current_stage: 'EMR Onboarding',
      in_clinical_review: true,
      clinical_review_pushed_at: '2026-08-10T12:00:00Z',
    })).toBe('2026-08-10T12:00:00Z');

    expect(clinicalReviewEnteredAt({
      current_stage: 'Clinical Intake RN Review',
    }, '2026-08-12T08:00:00Z')).toBe('2026-08-12T08:00:00Z');

    expect(clinicalReviewEnteredAt({ current_stage: 'SOC Completed' })).toBe(null);
  });

  it('counts calendar days in review from the stamp', () => {
    const now = new Date('2026-08-20T15:00:00Z');
    expect(daysInClinicalReview({
      current_stage: 'SOC Completed',
      in_clinical_review: true,
      clinical_review_assigned_at: '2026-08-16T10:00:00Z',
    }, null, now)).toBe(4);
  });

  it('enriches both stage and review clocks', () => {
    const row = enrichReferralWithMetrics({
      id: 'ref_1',
      current_stage: 'SOC Completed',
      in_clinical_review: true,
      clinical_review_assigned_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      referral_date: new Date(Date.now() - 20 * 86400000).toISOString(),
    }, []);
    expect(row._days_in_clinical).toBe(2);
    expect(row._days_in_pipeline).toBe(20);
    expect(row._clinical_entered_at).toBeTruthy();
  });
});

describe('staffing On Track clock', () => {
  it('starts only after the hard push to Staffing Feasibility', () => {
    expect(isOnTrackStaffing({ current_stage: 'Intake' })).toBe(false);
    expect(isOnTrackStaffing({ current_stage: 'Clinical Intake RN Review' })).toBe(false);
    expect(isOnTrackStaffing({ current_stage: 'Staffing Feasibility' })).toBe(true);

    expect(staffingEnteredAt({ current_stage: 'Intake' }, '2026-08-01T12:00:00Z')).toBe(null);
    expect(staffingEnteredAt({ current_stage: 'Staffing Feasibility' }, '2026-08-18T12:00:00Z'))
      .toBe('2026-08-18T12:00:00Z');
  });

  it('counts days from the hard-push stamp, not concurrent radar visibility', () => {
    const now = new Date('2026-08-20T15:00:00Z');
    expect(daysInStaffing({ current_stage: 'Intake' }, '2026-08-01T12:00:00Z', now)).toBe(null);
    expect(daysInStaffing({
      current_stage: 'Staffing Feasibility',
    }, '2026-08-16T10:00:00Z', now)).toBe(4);
  });

  it('enriches staffing days only when On Track', () => {
    const onTrack = enrichReferralWithMetrics({
      id: 'ref_1',
      current_stage: 'Staffing Feasibility',
      referral_date: new Date(Date.now() - 20 * 86400000).toISOString(),
    }, [{
      referral_id: 'ref_1',
      to_stage: 'Staffing Feasibility',
      timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
    }]);
    expect(onTrack._days_in_staffing).toBe(2);

    const radar = enrichReferralWithMetrics({
      id: 'ref_2',
      current_stage: 'Intake',
      referral_date: new Date(Date.now() - 20 * 86400000).toISOString(),
    }, [{
      referral_id: 'ref_2',
      to_stage: 'Intake',
      timestamp: new Date(Date.now() - 20 * 86400000).toISOString(),
    }]);
    expect(radar._days_in_staffing).toBe(null);
    expect(radar._days_in_stage).toBe(20);
  });
});
