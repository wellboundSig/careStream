import { useMemo, useCallback } from 'react';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';

const ALL_KEYS_SET = new Set(Object.values(PERMISSION_KEYS));

/**
 * Returns permission-check helpers for the currently signed-in user.
 *
 * Feature permissions:
 * - `can(key)`          → boolean
 * - `canAny(...keys)`   → boolean
 * - `canAll(...keys)`   → boolean
 * - `hasDivision(name)` → boolean
 * - `granted`           → Set<string>
 *
 * Assignment permissions ("Can assign to"):
 * - `allowedAssignees`       → Set<string> of user IDs this user can assign to (null = unrestricted)
 * - `canAssignTo(userId)`    → boolean
 * - `isAssignmentRestricted` → boolean — true if the user has an explicit restriction set
 *
 * Migration safety: if no UserPermissions record exists, ALL permissions
 * are granted and assignment is unrestricted.
 */
export function usePermissions() {
  const { appUserId } = useCurrentAppUser();
  const userPermissions = useCareStore((s) => s.userPermissions);

  const record = useMemo(() => {
    if (!appUserId) return null;
    return Object.values(userPermissions).find((up) => up.user_id === appUserId) || null;
  }, [appUserId, userPermissions]);

  const granted = useMemo(() => {
    if (!record?.permissions) return ALL_KEYS_SET;
    try {
      const keys = JSON.parse(record.permissions);
      return new Set(Array.isArray(keys) ? keys : []);
    } catch {
      return ALL_KEYS_SET;
    }
  }, [record]);

  const { allowedAssignees, isAssignmentRestricted } = useMemo(() => {
    if (!record?.allowed_assignees) return { allowedAssignees: null, isAssignmentRestricted: false };
    try {
      const ids = JSON.parse(record.allowed_assignees);
      if (Array.isArray(ids) && ids.length >= 0) {
        return { allowedAssignees: new Set(ids), isAssignmentRestricted: true };
      }
    } catch { /* fall through */ }
    return { allowedAssignees: null, isAssignmentRestricted: false };
  }, [record]);

  const can    = useCallback((key) => granted.has(key), [granted]);
  const canAny = useCallback((...keys) => keys.some((k) => granted.has(k)), [granted]);
  const canAll = useCallback((...keys) => keys.every((k) => granted.has(k)), [granted]);

  const hasDivision = useCallback(
    (div) => {
      if (div === 'ALF') return granted.has(PERMISSION_KEYS.DIVISION_ALF);
      if (div === 'Special Needs') return granted.has(PERMISSION_KEYS.DIVISION_SN);
      return true;
    },
    [granted],
  );

  const canAssignTo = useCallback(
    (userId) => {
      if (!allowedAssignees) return true;
      return allowedAssignees.has(userId);
    },
    [allowedAssignees],
  );

  return { can, canAny, canAll, hasDivision, granted, allowedAssignees, isAssignmentRestricted, canAssignTo };
}
