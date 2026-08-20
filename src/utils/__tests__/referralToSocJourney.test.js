import { describe, it, expect } from 'vitest';
import {
  journeyStamps,
  inferReached,
  stuckHopFor,
  buildJourneyRows,
  annotateJourneyOutliers,
  applyJourneyFilters,
  summarizeJourney,
  bottleneckCopy,
  filterReferralsByDateBasis,
  percentile,
  median,
} from '../referralToSocJourney.js';

const TODAY = new Date('2026-08-20T12:00:00');

function row(overrides = {}) {
  return {
    id: overrides.id || 'ref_1',
    patientName: overrides.patientName || 'Ada Cole',
    referral_date: '2026-08-01',
    current_stage: 'Intake',
    division: 'ALF',
    ...overrides,
  };
}

describe('journey stamps and stuck hop', () => {
  it('falls back to full EMR when initial HCHB is blank', () => {
    const stamps = journeyStamps({
      referral_date: '2026-08-01',
      emr_onboarded_at: '2026-08-04',
    });
    expect(stamps.initialAt).toBe('2026-08-04');
    expect(stamps.fullEmrAt).toBe('2026-08-04');
  });

  it('prefers initial EMR for HCHB', () => {
    const stamps = journeyStamps({
      emr_initial_onboarded_at: '2026-08-02',
      emr_onboarded_at: '2026-08-10',
    });
    expect(stamps.initialAt).toBe('2026-08-02');
  });

  it('uses scheduled date or scheduled-at stamp', () => {
    expect(journeyStamps({ soc_scheduled_date: '2026-08-12' }).scheduledAt).toBe('2026-08-12');
    expect(journeyStamps({ soc_scheduled_at: '2026-08-13T15:00:00Z' }).scheduledAt).toBe('2026-08-13T15:00:00Z');
  });

  it('marks stuck at the first missing hop', () => {
    expect(stuckHopFor(row(), journeyStamps(row()))).toBe('referral_to_hchb');
    expect(stuckHopFor(
      row({ emr_initial_onboarded_at: '2026-08-02' }),
      journeyStamps(row({ emr_initial_onboarded_at: '2026-08-02' })),
    )).toBe('hchb_to_emr');
    expect(stuckHopFor(
      row({ emr_initial_onboarded_at: '2026-08-02', emr_onboarded_at: '2026-08-05' }),
      journeyStamps(row({ emr_initial_onboarded_at: '2026-08-02', emr_onboarded_at: '2026-08-05' })),
    )).toBe('emr_to_scheduled');
    expect(stuckHopFor(
      row({
        emr_initial_onboarded_at: '2026-08-02',
        emr_onboarded_at: '2026-08-05',
        soc_scheduled_date: '2026-08-10',
      }),
      journeyStamps(row({
        emr_initial_onboarded_at: '2026-08-02',
        emr_onboarded_at: '2026-08-05',
        soc_scheduled_date: '2026-08-10',
      })),
    )).toBe('scheduled_to_soc');
  });

  it('does not mark SOC completed or NTUC as stuck', () => {
    const done = row({ current_stage: 'SOC Completed', soc_completed_date: '2026-08-12' });
    expect(stuckHopFor(done, journeyStamps(done))).toBe(null);
    const ntuc = row({ current_stage: 'NTUC' });
    expect(stuckHopFor(ntuc, journeyStamps(ntuc))).toBe(null);
  });

  it('counts later milestones as reached when SOC is done, even if a stamp is missing', () => {
    const r = row({ current_stage: 'SOC Completed', soc_completed_date: '2026-08-12' });
    const reached = inferReached(r, journeyStamps(r));
    expect(reached.soc_completed).toBe(true);
    expect(reached.soc_scheduled).toBe(true);
    expect(reached.full_emr).toBe(true);
    expect(reached.initial_emr).toBe(true);
  });
});

describe('build + summarize journey', () => {
  it('computes hop days, 1-day HCHB target, and current wait', () => {
    const rows = buildJourneyRows([
      row({
        patientName: 'On Time',
        emr_initial_onboarded_at: '2026-08-02',
        emr_onboarded_at: '2026-08-06',
        soc_scheduled_date: '2026-08-10',
        soc_completed_date: '2026-08-12',
        current_stage: 'SOC Completed',
      }),
      row({
        patientName: 'Late Chart',
        emr_initial_onboarded_at: '2026-08-05',
        current_stage: 'Intake',
      }),
      row({
        id: 'ref_open',
        patientName: 'Still Open',
        current_stage: 'Intake',
      }),
    ], { today: TODAY });

    const onTime = rows.find((r) => r.patient_name === 'On Time');
    expect(onTime.days_to_hchb).toBe(1);
    expect(onTime.hchb_on_time).toBe('Yes');
    expect(onTime.days_hchb_to_emr).toBe(4);
    expect(onTime.days_emr_to_scheduled).toBe(4);
    expect(onTime.days_scheduled_to_soc).toBe(2);
    expect(onTime.days_to_soc).toBe(11);
    expect(onTime.stuck_hop).toBe(null);
    expect(onTime.current_wait).toBe(null);

    const late = rows.find((r) => r.patient_name === 'Late Chart');
    expect(late.days_to_hchb).toBe(4);
    expect(late.hchb_on_time).toBe('No');
    expect(late.stuck_hop).toBe('hchb_to_emr');
    expect(late.current_wait).toBe(15);

    const open = rows.find((r) => r.patient_name === 'Still Open');
    expect(open.hchb_on_time).toBe('Not entered');
    expect(open.stuck_hop).toBe('referral_to_hchb');
    expect(open.current_wait).toBe(19);
  });

  it('uses assigned or completed clinical RN', () => {
    const resolve = { user: (id) => ({ usr_a: 'Assigned RN', usr_c: 'Completed RN' }[id] || '-') };
    const assigned = buildJourneyRows([
      row({ clinical_review_assigned_to_id: 'usr_a' }),
    ], { resolve, today: TODAY })[0];
    expect(assigned.clinical_rn).toBe('Assigned RN');

    const completed = buildJourneyRows([
      row({ clinical_review_completed_by_id: 'usr_c' }),
    ], { resolve, today: TODAY })[0];
    expect(completed.clinical_rn).toBe('Completed RN');
  });

  it('flags outliers from p90 / long waits and leaves 1-day misses as target-only', () => {
    const raw = buildJourneyRows([
      row({ id: 'a', patientName: 'Fast', referral_date: '2026-08-01', emr_initial_onboarded_at: '2026-08-01', current_stage: 'SOC Completed', soc_completed_date: '2026-08-03' }),
      row({ id: 'b', patientName: 'Typical', referral_date: '2026-08-01', emr_initial_onboarded_at: '2026-08-02', current_stage: 'SOC Completed', soc_completed_date: '2026-08-08' }),
      row({ id: 'c', patientName: 'One Day Late', referral_date: '2026-08-01', emr_initial_onboarded_at: '2026-08-03', emr_onboarded_at: '2026-08-05', soc_scheduled_date: '2026-08-18', current_stage: 'SOC Scheduled' }),
      row({ id: 'd', patientName: 'Stuck Long', referral_date: '2026-07-01', current_stage: 'Intake' }),
    ], { today: TODAY });
    const rows = annotateJourneyOutliers(raw);

    expect(rows.find((r) => r.patient_name === 'One Day Late').missed_hchb_target).toBe(true);
    expect(rows.find((r) => r.patient_name === 'One Day Late').is_outlier).toBe(false);
    expect(rows.find((r) => r.patient_name === 'Stuck Long').is_outlier).toBe(true);
    expect(rows.find((r) => r.patient_name === 'Stuck Long').current_wait).toBeGreaterThanOrEqual(14);
  });

  it('summarizes funnel, bottleneck, and histograms', () => {
    const raw = buildJourneyRows([
      row({
        id: '1',
        patientName: 'Done',
        emr_initial_onboarded_at: '2026-08-02',
        emr_onboarded_at: '2026-08-06',
        soc_scheduled_date: '2026-08-10',
        soc_completed_date: '2026-08-12',
        current_stage: 'SOC Completed',
      }),
      row({
        id: '2',
        patientName: 'Waiting HCHB',
        current_stage: 'Intake',
      }),
      row({
        id: '3',
        patientName: 'Waiting HCHB 2',
        current_stage: 'Lead Entry',
      }),
    ], { today: TODAY });
    const rows = annotateJourneyOutliers(raw);
    const summary = summarizeJourney(rows);

    expect(summary.total).toBe(3);
    expect(summary.socCount).toBe(1);
    expect(summary.hchbEntered).toBe(1);
    expect(summary.hchbOnTime).toBe(1);
    expect(summary.funnel[0].count).toBe(3);
    expect(summary.funnel.find((f) => f.key === 'initial_emr').count).toBe(1);
    expect(summary.funnel.find((f) => f.key === 'soc_completed').count).toBe(1);
    expect(summary.bottleneck.key).toBe('referral_to_hchb');
    expect(summary.hchbHistogram.find((b) => b.key === '1').count).toBe(1);
    expect(bottleneckCopy(summary)).toContain('Referral → Initial HCHB');
  });
});

describe('filters and date basis', () => {
  it('filters cohort, stuck hop, outliers, and text', () => {
    const raw = annotateJourneyOutliers(buildJourneyRows([
      row({ id: '1', patientName: 'Ada Cole', current_stage: 'SOC Completed', soc_completed_date: '2026-08-12', facility_id: 'fac_1' }),
      row({ id: '2', patientName: 'Stuck Case', current_stage: 'Intake', referral_date: '2026-07-01' }),
      row({ id: '3', patientName: 'NTUC Case', current_stage: 'NTUC' }),
    ], {
      today: TODAY,
      resolve: { facility: (id) => (id === 'fac_1' ? 'Sunrise' : '-') },
    }));

    expect(applyJourneyFilters(raw, { cohort: 'soc' })).toHaveLength(1);
    expect(applyJourneyFilters(raw, { cohort: 'ntuc' })[0].patient_name).toBe('NTUC Case');
    expect(applyJourneyFilters(raw, { stuckHop: 'referral_to_hchb' }).map((r) => r.patient_name))
      .toEqual(['Stuck Case']);
    expect(applyJourneyFilters(raw, { outliersOnly: true }).every((r) => r.is_outlier)).toBe(true);
    expect(applyJourneyFilters(raw, { facility: 'sun' })[0].patient_name).toBe('Ada Cole');
    expect(applyJourneyFilters(raw, { minDays: 30 })[0].patient_name).toBe('Stuck Case');
    expect(applyJourneyFilters(raw, { droppedBefore: 'initial_emr' }).map((r) => r.patient_name))
      .toEqual(['Stuck Case', 'NTUC Case']);
    expect(applyJourneyFilters(raw, { hchbMinDays: '0', hchbMaxDays: '1' })).toHaveLength(0);
  });

  it('slices by HCHB or SOC date instead of referral date', () => {
    const refs = [
      row({ id: 'old', referral_date: '2026-01-01', emr_initial_onboarded_at: '2026-08-18', soc_completed_date: '2026-08-19', current_stage: 'SOC Completed' }),
      row({ id: 'new', referral_date: '2026-08-18', emr_initial_onboarded_at: '2026-08-19' }),
      row({ id: 'no-stamp', referral_date: '2026-08-18' }),
    ];
    const byHchb = filterReferralsByDateBasis(refs, { days: 7, basis: 'hchb', now: TODAY });
    expect(byHchb.map((r) => r.id).sort()).toEqual(['new', 'old']);

    const bySoc = filterReferralsByDateBasis(refs, { days: 7, basis: 'soc', now: TODAY });
    expect(bySoc.map((r) => r.id)).toEqual(['old']);

    const allSoc = filterReferralsByDateBasis(refs, { days: null, basis: 'soc', now: TODAY });
    expect(allSoc.map((r) => r.id)).toEqual(['old']);
  });
});

describe('stats helpers', () => {
  it('computes median and percentile', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3.25);
    expect(percentile([], 90)).toBe(null);
  });
});
