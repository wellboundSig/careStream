import { useMemo, useCallback } from 'react';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';

const ALL_KEYS_SET = new Set(Object.values(PERMISSION_KEYS));

/**
 * Returns permission-check helpers for the currently signed-in user.
 *
 * - `can(key)`          → boolean — does the user have this permission?
 * - `canAny(...keys)`   → boolean — does the user have at least one of these?
 * - `canAll(...keys)`   → boolean — does the user have every one of these?
 * - `hasDivision(name)` → boolean — can the user see this division's data?
 * - `granted`           → Set<string> of all granted keys (for UI rendering)
 *
 * Migration safety: if no UserPermissions record exists for the user yet,
 * ALL permissions are granted so nobody is locked out before admins configure.
 */
export function usePermissions() {
  const { appUserId } = useCurrentAppUser();
  const userPermissions = useCareStore((s) => s.userPermissions);

  const granted = useMemo(() => {
    if (!appUserId) return ALL_KEYS_SET;

    const record = Object.values(userPermissions).find(
      (up) => up.user_id === appUserId,
    );

    if (!record?.permissions) return ALL_KEYS_SET;

    try {
      const keys = JSON.parse(record.permissions);
      return new Set(Array.isArray(keys) ? keys : []);
    } catch {
      return ALL_KEYS_SET;
    }
  }, [appUserId, userPermissions]);

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

  return { can, canAny, canAll, hasDivision, granted };
}
