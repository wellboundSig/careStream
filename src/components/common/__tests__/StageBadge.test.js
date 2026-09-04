import { describe, it, expect } from 'vitest';
import { displayStageName } from '../StageBadge.jsx';

describe('displayStageName', () => {
  it('keeps stored Intake / Clinical names when the visit has not happened', () => {
    expect(displayStageName({ current_stage: 'Intake' })).toBe('Intake');
    expect(displayStageName({ current_stage: 'Clinical Intake RN Review' })).toBe('Clinical Review');
  });

  it('shows Completed for the terminal stage even when a visit stamp exists', () => {
    expect(displayStageName({
      current_stage: 'Completed',
      soc_completed_date: '2026-08-04',
    })).toBe('Completed');
  });

  it('labels a finished legacy SOC Completed row as Completed, not Intake Post Visit', () => {
    expect(displayStageName({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      clinical_review_completed_at: '2026-08-05',
    })).toBe('Completed');
  });

  it('appends Post Visit on Intake after the visit, without changing the stored stage', () => {
    expect(displayStageName({
      current_stage: 'Intake',
      soc_completed_date: '2026-08-04',
    })).toBe('Intake Post Visit');
    expect(displayStageName({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
    })).toBe('Intake Post Visit');
  });

  it('labels a post-visit Clinical handoff as Clinical Review Post Visit', () => {
    expect(displayStageName({
      current_stage: 'Intake',
      soc_completed_date: '2026-08-04',
      in_clinical_review: true,
    })).toBe('Clinical Review Post Visit');
    expect(displayStageName({
      current_stage: 'SOC Completed',
      soc_completed_date: '2026-08-04',
      in_clinical_review: true,
    })).toBe('Clinical Review Post Visit');
    expect(displayStageName({
      current_stage: 'Clinical Intake RN Review',
      soc_completed_date: '2026-08-04',
    })).toBe('Clinical Review Post Visit');
  });
});
