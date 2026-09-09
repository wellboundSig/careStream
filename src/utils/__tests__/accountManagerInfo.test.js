import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACCOUNT_MANAGER_INFO_MENTION_ID, withAccountManagerInfoMention } from '../mentions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';

const mockStore = { userPermissions: {} };
vi.mock('../../store/careStore.js', () => ({
  getStore: () => mockStore,
}));
vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn(),
}));

const { listPendingLogRecipientUserIds } = await import('../accountManagerInfo.js');

describe('withAccountManagerInfoMention', () => {
  it('appends the Account manager info token', () => {
    const out = withAccountManagerInfoMention('Not a skilled need');
    expect(out).toContain('Not a skilled need');
    expect(out).toContain(ACCOUNT_MANAGER_INFO_MENTION_ID);
    expect(out).toContain('@[Account manager info]');
  });

  it('does not duplicate an existing mention', () => {
    const once = withAccountManagerInfoMention('Note');
    expect(withAccountManagerInfoMention(once)).toBe(once);
  });
});

describe('listPendingLogRecipientUserIds', () => {
  beforeEach(() => {
    mockStore.userPermissions = {
      a: {
        user_id: 'usr_am',
        permissions: JSON.stringify([PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG]),
      },
      b: {
        user_id: 'usr_rn',
        permissions: JSON.stringify([PERMISSION_KEYS.MODULE_CLINICAL]),
      },
      c: {
        user_id: 'usr_sched',
        permissions: [PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG, PERMISSION_KEYS.MODULE_SCHEDULING],
      },
    };
  });

  it('returns pending-log viewers and skips the actor', () => {
    expect(listPendingLogRecipientUserIds({ excludeId: 'usr_am' }).sort()).toEqual(['usr_sched']);
    expect(listPendingLogRecipientUserIds().sort()).toEqual(['usr_am', 'usr_sched']);
  });
});
