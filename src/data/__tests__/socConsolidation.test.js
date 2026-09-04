import { describe, it, expect } from 'vitest';
import { STAGE_SLUGS, STAGE_META, ROLE_MODES, ALL_STAGES, isSocCompletedReferral } from '../stageConfig.js';
import StageRules from '../StageRules.json';
import { PANE_NAV } from '../paneRoutes.js';

describe('SOC consolidation — DB stage values preserved', () => {
  it('Pre-SOC exists as a DB stage', () => {
    expect(STAGE_SLUGS['Pre-SOC']).toBe('pre-soc');
    expect(StageRules.stages['Pre-SOC']).toBeTruthy();
    expect(StageRules.stages['Pre-SOC'].terminal).toBe(false);
  });

  it('SOC Scheduled exists as a DB stage (not removed)', () => {
    expect(STAGE_SLUGS['SOC Scheduled']).toBe('soc-scheduled');
    expect(StageRules.stages['SOC Scheduled']).toBeTruthy();
    expect(StageRules.stages['SOC Scheduled'].terminal).toBe(false);
  });

  it('SOC Completed exists as a DB stage; post-visit flow made it transitional', () => {
    expect(STAGE_SLUGS['SOC Completed']).toBe('soc-completed');
    expect(StageRules.stages['SOC Completed']).toBeTruthy();
    // Post-visit documentation flow: SOC Completed ("Visit Completed") now
    // routes onward to Post Visit Intake or the terminal Completed stage.
    expect(StageRules.stages['SOC Completed'].terminal).toBe(false);
    expect(StageRules.stages['SOC Completed'].canMoveTo).toContain('Post Visit Intake');
    expect(StageRules.stages['SOC Completed'].canMoveTo).toContain('Completed');
  });

  it('all three SOC stages are in ALL_STAGES', () => {
    expect(ALL_STAGES).toContain('Pre-SOC');
    expect(ALL_STAGES).toContain('SOC Scheduled');
    expect(ALL_STAGES).toContain('SOC Completed');
  });

  it('Pre-SOC moves directly to SOC Completed (SOC Scheduled removed from forward path 2026-05-20)', () => {
    // Per the workflow overhaul, the forward path is Pre-SOC → SOC Completed.
    // SOC Scheduled is retained as a legacy stage for historical records but
    // is no longer a forward destination.
    expect(StageRules.stages['Pre-SOC'].canMoveTo).toContain('SOC Completed');
    expect(StageRules.stages['Pre-SOC'].canMoveTo).not.toContain('SOC Scheduled');
  });

  it('StageRules transition paths are intact (SOC Scheduled → SOC Completed allowed for legacy records)', () => {
    expect(StageRules.stages['SOC Scheduled'].canMoveTo).toContain('SOC Completed');
  });
});

describe('SOC consolidation — UI changes', () => {
  it('Pre-SOC STAGE_META has consolidatedStages covering Pre-SOC + SOC Scheduled', () => {
    const meta = STAGE_META['Pre-SOC'];
    expect(meta.consolidatedStages).toEqual(['Pre-SOC', 'SOC Scheduled']);
  });

  it('SOC Scheduled STAGE_META is marked hiddenFromNav', () => {
    expect(STAGE_META['SOC Scheduled'].hiddenFromNav).toBe(true);
  });

  it('SOC Completed displayName is "Visit Completed"', () => {
    expect(STAGE_META['SOC Completed'].displayName).toBe('Visit Completed');
  });

  it('scheduler role mode shows Staffing, Pre-SOC and Completed but NOT SOC Scheduled / SOC Completed', () => {
    const schedulerMode = ROLE_MODES.find((m) => m.id === 'scheduler');
    expect(schedulerMode.stages).toContain('Staffing Feasibility');
    expect(schedulerMode.stages).toContain('Pre-SOC');
    expect(schedulerMode.stages).toContain('Completed');
    // Visit Completed module removed 2026-08-26 — done cases go to Completed,
    // open-paperwork cases are worked inside Intake.
    expect(schedulerMode.stages).not.toContain('SOC Completed');
    expect(schedulerMode.stages).not.toContain('SOC Scheduled');
    expect(schedulerMode.stages).not.toContain('EMR Onboarding');
  });

  it('SOC Completed stage is hidden from nav (no standalone Visit Completed module)', () => {
    expect(STAGE_META['SOC Completed'].hiddenFromNav).toBe(true);
  });

  it('pane nav shows Pre-SOC and Completed but NOT SOC Scheduled / SOC Completed', () => {
    const moduleItems = PANE_NAV.find((g) => g.group === 'Modules').items;
    const paths = moduleItems.map((i) => i.path);
    expect(paths).toContain('/modules/pre-soc');
    expect(paths).toContain('/modules/completed');
    expect(paths).not.toContain('/modules/soc-completed');
    expect(paths).not.toContain('/modules/soc-scheduled');
  });
});

describe('SOC consolidation — metrics compatibility', () => {
  it('raw DB values Pre-SOC, SOC Scheduled, SOC Completed are unchanged strings', () => {
    expect(Object.keys(StageRules.stages)).toContain('Pre-SOC');
    expect(Object.keys(StageRules.stages)).toContain('SOC Scheduled');
    expect(Object.keys(StageRules.stages)).toContain('SOC Completed');
  });

  it('Completed is the terminal stage; the SOC group stages all flow onward', () => {
    expect(StageRules.stages['Pre-SOC'].terminal).toBe(false);
    expect(StageRules.stages['SOC Scheduled'].terminal).toBe(false);
    expect(StageRules.stages['SOC Completed'].terminal).toBe(false);
    expect(StageRules.stages['Completed'].terminal).toBe(true);
  });
});

describe('SOC Completed concurrent membership (soc_completed_date)', () => {
  it('counts stage SOC Completed', () => {
    expect(isSocCompletedReferral({ current_stage: 'SOC Completed' })).toBe(true);
  });

  it('keeps patients with a completion stamp when current_stage returns to Intake', () => {
    expect(isSocCompletedReferral({
      current_stage: 'Intake',
      soc_completed_date: '2026-07-20',
    })).toBe(true);
    expect(STAGE_META['SOC Completed'].matchReferral({
      current_stage: 'Intake',
      soc_completed_date: '2026-07-20',
    })).toBe(true);
  });

  it('does not count Intake without a completion stamp', () => {
    expect(isSocCompletedReferral({ current_stage: 'Intake' })).toBe(false);
  });

  it('drops NTUC / Discarded even if a stamp remains', () => {
    expect(isSocCompletedReferral({
      current_stage: 'NTUC',
      soc_completed_date: '2026-07-20',
    })).toBe(false);
    expect(isSocCompletedReferral({
      current_stage: 'Discarded Leads',
      soc_completed_date: '2026-07-20',
    })).toBe(false);
  });
});

describe('Clinical Review display names', () => {
  it('shows Clinical Review in the UI without renaming the stored stage', () => {
    expect(STAGE_META['Clinical Intake RN Review'].displayName).toBe('Clinical Review');
    expect(STAGE_META['Post Visit Clinical Review'].displayName).toBe('Clinical Review Post Visit');
  });
});

describe('Intake vs Clinical queue membership', () => {
  const intake = STAGE_META['Intake'].matchReferral;
  const clinical = STAGE_META['Clinical Intake RN Review'].matchReferral;

  it('lists a Clinical Lead Pre-Check case on both Leads and Clinical, not Intake', () => {
    const r = { current_stage: 'Clinical Lead Pre-Check' };
    expect(STAGE_META['Lead Entry'].matchReferral(r)).toBe(true);
    expect(clinical(r)).toBe(true);
    expect(intake(r)).toBe(false);
  });

  it('keeps a normal Intake case on Intake only', () => {
    const r = { current_stage: 'Intake' };
    expect(intake(r)).toBe(true);
    expect(clinical(r)).toBe(false);
  });

  it('never lists a stored Clinical Review stage on Intake', () => {
    expect(intake({ current_stage: 'Clinical Intake RN Review' })).toBe(false);
    expect(intake({ current_stage: 'Post Visit Clinical Review' })).toBe(false);
    expect(clinical({ current_stage: 'Clinical Intake RN Review' })).toBe(true);
  });

  it('drops Intake once pushed to Clinical, even if current_stage is still Intake', () => {
    const r = { current_stage: 'Intake', in_clinical_review: true };
    expect(intake(r)).toBe(false);
    expect(clinical(r)).toBe(true);
  });

  it('drops post-visit Intake after the Clinical handoff', () => {
    const r = {
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      in_clinical_review: true,
    };
    expect(intake(r)).toBe(false);
    expect(clinical(r)).toBe(true);
  });

  it('does not keep a finished SOC Completed case on Clinical just because the handoff flag lingered', () => {
    const r = {
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      clinical_review_decision: 'accept',
      in_clinical_review: true,
    };
    expect(clinical(r)).toBe(false);
    expect(intake(r)).toBe(false);
    expect(STAGE_META['Completed'].matchReferral(r)).toBe(true);
  });

  it('returns the case to Intake after Clinical send-back clears the handoff', () => {
    const r = {
      current_stage: 'Intake',
      in_clinical_review: false,
      returned_from_clinical: true,
    };
    expect(intake(r)).toBe(true);
    expect(clinical(r)).toBe(false);
  });
});

describe('Completed module is terminal-only', () => {
  const completed = STAGE_META['Completed'].matchReferral;
  const intake = STAGE_META['Intake'].matchReferral;

  it('lists current_stage Completed', () => {
    expect(completed({ current_stage: 'Completed' })).toBe(true);
  });

  it('lists a legacy SOC Completed row only when clinical and docs are closed', () => {
    expect(completed({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
    })).toBe(false);
    expect(completed({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      clinical_review_completed_at: '2026-08-05',
    })).toBe(true);
    expect(completed({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      clinical_review_decision: 'accept',
      in_clinical_review: true,
    })).toBe(true);
    expect(completed({
      current_stage: 'Intake',
      soc_completed_date: '2026-08-04',
      clinical_review_completed_at: '2026-08-05',
    })).toBe(false);
  });

  it('keeps visit-done SOC Completed rows on Intake when paperwork is still open', () => {
    const r = { current_stage: 'SOC Completed', soc_completed_date: '2026-08-04' };
    expect(intake(r)).toBe(true);
    expect(completed(r)).toBe(false);
  });
});
