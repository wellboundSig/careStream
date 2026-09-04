import { describe, it, expect } from 'vitest';
import { ACCOUNT_MANAGER_INFO_MENTION_ID } from '../mentions.js';
import {
  hasAccountManagerInfo,
  hasClinicalIntakeSendBackNote,
  isPendingLogReferral,
  pendingLogMentionIndex,
} from '../pendingLog.js';

describe('pending log membership', () => {
  it('includes a case with an @account manager info log on the referral', () => {
    const r = { id: 'ref_1', account_manager_info: 'Aug 31 · RN\nNeed insurance card' };
    expect(hasAccountManagerInfo(r)).toBe(true);
    expect(isPendingLogReferral(r)).toBe(true);
  });

  it('includes a clinical send-back that has a note', () => {
    const r = {
      id: 'ref_2',
      returned_from_clinical: true,
      returned_from_clinical_note: 'Missing F2F — sending file back to intake',
    };
    expect(hasClinicalIntakeSendBackNote(r)).toBe(true);
    expect(isPendingLogReferral(r)).toBe(true);
  });

  it('does not include a send-back flag with no note', () => {
    expect(isPendingLogReferral({
      id: 'ref_3',
      returned_from_clinical: true,
      returned_from_clinical_note: '',
    })).toBe(false);
  });

  it('includes a case whose chart note mentioned Account manager info', () => {
    const notes = {
      n1: {
        content: `Please review @[Account manager info](${ACCOUNT_MANAGER_INFO_MENTION_ID})`,
        patient_id: 'pat_9',
        referral_id: 'ref_9',
      },
    };
    const index = pendingLogMentionIndex(notes);
    expect(isPendingLogReferral({ id: 'ref_9', patient_id: 'pat_9' }, index)).toBe(true);
    expect(isPendingLogReferral({ id: 'ref_other', patient_id: 'pat_other' }, index)).toBe(false);
  });

  it('drops NTUC / discarded cases even if they have AM info', () => {
    expect(isPendingLogReferral({
      current_stage: 'NTUC',
      account_manager_info: 'still here',
    })).toBe(false);
  });

  it('excludes ordinary completed cases with no AM note and no clinical send-back', () => {
    expect(isPendingLogReferral({
      id: 'ref_done',
      current_stage: 'Completed',
      soc_completed_date: '2026-07-24',
    })).toBe(false);
  });
});
