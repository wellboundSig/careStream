import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockAppUserId = 'usr_test';
let mockUserPermissions = {};

vi.mock('../../store/careStore.js', () => ({
  useCareStore: (selector) => selector({ userPermissions: mockUserPermissions }),
}));

vi.mock('../useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUserId: mockAppUserId }),
}));

const { usePermissions } = await import('../usePermissions.js');

describe('usePermissions — allowedAssignees', () => {
  it('returns unrestricted when no allowed_assignees field exists', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '["task.view"]' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.allowedAssignees).toBe(null);
    expect(result.current.isAssignmentRestricted).toBe(false);
    expect(result.current.canAssignTo('usr_anyone')).toBe(true);
  });

  it('returns unrestricted when allowed_assignees is empty string', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '["task.view"]', allowed_assignees: '' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.allowedAssignees).toBe(null);
    expect(result.current.isAssignmentRestricted).toBe(false);
  });

  it('restricts assignment when allowed_assignees is a JSON array', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '["task.view"]', allowed_assignees: '["usr_2","usr_3"]' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isAssignmentRestricted).toBe(true);
    expect(result.current.canAssignTo('usr_2')).toBe(true);
    expect(result.current.canAssignTo('usr_3')).toBe(true);
    expect(result.current.canAssignTo('usr_4')).toBe(false);
    expect(result.current.canAssignTo('usr_999')).toBe(false);
  });

  it('returns empty set for empty JSON array (can assign to nobody)', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '[]', allowed_assignees: '[]' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isAssignmentRestricted).toBe(true);
    expect(result.current.allowedAssignees.size).toBe(0);
    expect(result.current.canAssignTo('usr_anyone')).toBe(false);
  });

  it('handles malformed JSON gracefully', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '[]', allowed_assignees: 'not json' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.allowedAssignees).toBe(null);
    expect(result.current.isAssignmentRestricted).toBe(false);
  });

  it('returns unrestricted when no UserPermissions record exists', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {};
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canAssignTo('usr_anyone')).toBe(true);
  });
});

describe('usePermissions — feature permissions (existing behavior)', () => {
  it('grants all keys when no record exists (migration safety)', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {};
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can('referral.view')).toBe(true);
    expect(result.current.can('admin.permissions')).toBe(true);
  });

  it('respects explicit permission keys', () => {
    mockAppUserId = 'usr_1';
    mockUserPermissions = {
      up1: { _id: 'up1', user_id: 'usr_1', permissions: '["referral.view","task.view"]' },
    };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can('referral.view')).toBe(true);
    expect(result.current.can('task.view')).toBe(true);
    expect(result.current.can('admin.permissions')).toBe(false);
  });
});
