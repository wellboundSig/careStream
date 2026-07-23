import { describe, it, expect } from 'vitest';
import { buildTeamActivityEvents, buildActorAliasMap } from '../teamActivity.js';

describe('buildActorAliasMap', () => {
  it('maps clerk and airtable ids to business id', () => {
    const map = buildActorAliasMap(
      {
        rec1: { id: 'usr_001', _id: 'rec1', clerk_user_id: 'user_clerk_abc' },
      },
      new Set(['usr_001']),
    );
    expect(map.get('usr_001')).toBe('usr_001');
    expect(map.get('rec1')).toBe('usr_001');
    expect(map.get('user_clerk_abc')).toBe('usr_001');
  });
});

describe('buildTeamActivityEvents', () => {
  const users = {
    recV: { id: 'usr_van', _id: 'recV', clerk_user_id: 'clerk_van', first_name: 'Vanessa' },
  };
  const memberIds = new Set(['usr_van']);

  it('surfaces triage filled by a team member with patient context', () => {
    const events = buildTeamActivityEvents({
      memberIds,
      users,
      stores: {
        referrals: {
          r1: { id: 'ref_chris', _id: 'recR', patient_id: 'pat_chris', current_stage: 'Intake' },
        },
        triagePediatric: {
          t1: {
            id: 'tri_1',
            _id: 'recT',
            referral_id: 'ref_chris',
            filled_by_id: 'usr_van',
            created_at: '2026-07-20T15:30:00.000Z',
            phone_call_made_to: 'Mother',
          },
        },
      },
    });

    const triage = events.find((e) => e.action === 'Triage Submitted');
    expect(triage).toBeTruthy();
    expect(triage.actorId).toBe('usr_van');
    expect(triage.patientId).toBe('pat_chris');
    expect(triage.detail).toContain('Phone call: Mother');

    const phone = events.find((e) => e.action === 'Phone Call Logged');
    expect(phone?.detail).toBe('Mother');
  });

  it('resolves triage actor when filled_by_id is a Clerk id', () => {
    const events = buildTeamActivityEvents({
      memberIds,
      users,
      stores: {
        referrals: { r1: { id: 'ref_1', patient_id: 'pat_1' } },
        triageAdult: {
          t1: {
            referral_id: 'ref_1',
            filled_by_id: 'clerk_van',
            created_at: '2026-07-21T10:00:00.000Z',
          },
        },
      },
    });
    expect(events.some((e) => e.action === 'Triage Submitted' && e.actorId === 'usr_van')).toBe(true);
  });

  it('reads ActivityLog actor from metadata when actor_id column is empty', () => {
    const events = buildTeamActivityEvents({
      memberIds,
      users,
      stores: {
        activityLog: {
          a1: {
            action: 'eligibility_checked',
            timestamp: '2026-07-19T12:00:00.000Z',
            detail: 'Active coverage',
            metadata: JSON.stringify({
              actorUserId: 'usr_van',
              patientId: 'pat_2',
              referralId: 'ref_2',
            }),
          },
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('Eligibility Checked');
    expect(events[0].patientId).toBe('pat_2');
    expect(events[0].actorId).toBe('usr_van');
  });

  it('includes stage changes, files, conflicts, and eligibility milestones', () => {
    const events = buildTeamActivityEvents({
      memberIds,
      users,
      stores: {
        referrals: {
          r1: {
            id: 'ref_1',
            patient_id: 'pat_1',
            eligibility_completed_at: '2026-07-18T09:00:00.000Z',
            eligibility_completed_by_id: 'usr_van',
          },
        },
        stageHistory: {
          s1: {
            referral_id: 'ref_1',
            from_stage: 'Intake',
            to_stage: 'Eligibility Verification',
            changed_by_id: 'usr_van',
            timestamp: '2026-07-18T08:00:00.000Z',
          },
        },
        files: {
          f1: {
            uploaded_by_id: 'usr_van',
            created_at: '2026-07-17T11:00:00.000Z',
            file_name: 'orders.pdf',
            category: 'MD Orders',
            patient_id: 'pat_1',
            referral_id: 'ref_1',
          },
        },
        conflicts: {
          c1: {
            flagged_by_id: 'usr_van',
            created_at: '2026-07-16T14:00:00.000Z',
            category: 'Insurance',
            patient_id: 'pat_1',
            referral_id: 'ref_1',
          },
        },
      },
    });

    const actions = new Set(events.map((e) => e.action));
    expect(actions.has('Stage Change')).toBe(true);
    expect(actions.has('File Uploaded')).toBe(true);
    expect(actions.has('Conflict Flagged')).toBe(true);
    expect(actions.has('Eligibility Completed')).toBe(true);
  });

  it('ignores activity from non-members', () => {
    const events = buildTeamActivityEvents({
      memberIds,
      users,
      stores: {
        triageAdult: {
          t1: {
            filled_by_id: 'usr_other',
            created_at: '2026-07-20T15:30:00.000Z',
            referral_id: 'ref_1',
          },
        },
      },
    });
    expect(events).toHaveLength(0);
  });
});
