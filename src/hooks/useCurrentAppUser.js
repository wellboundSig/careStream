import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import aurora from '../api/aurora.js';
import { updateEntity, useCareStore } from '../store/careStore.js';

const LAST_LOGIN_STAMP_MS = 15 * 60 * 1000;

function stampLastLogin(u) {
  if (!u?._id) return;
  const prev = u.last_login_at ? new Date(u.last_login_at).getTime() : 0;
  if (Number.isFinite(prev) && Date.now() - prev < LAST_LOGIN_STAMP_MS) return;
  const iso = new Date().toISOString();
  u.last_login_at = iso;
  if (useCareStore.getState().users?.[u._id]) {
    updateEntity('users', u._id, { last_login_at: iso });
  }
  aurora.update('Users', u._id, { last_login_at: iso }).catch(() => {});
}

// Session-level caches
let _appUserCache = null;
let _validAuthorIds = null;

/** Merge fields into the session app-user cache (e.g. after self-serve Settings saves). */
export function patchAppUserCache(fields) {
  if (!_appUserCache || !fields) return;
  Object.assign(_appUserCache, fields);
}

async function fetchValidAuthorIds() {
  // Aurora (wellbound-api): author_id is a plain text column — there is no
  // select-option constraint, so "no constraint" (null) is correct and
  // callers already treat null as unconstrained.
  return null;
}

export function useCurrentAppUser() {
  const { user, isLoaded } = useUser();
  const [appUser, setAppUser] = useState(_appUserCache);
  const [validAuthorIds, setValidAuthorIds] = useState(_validAuthorIds);
  const [loading, setLoading] = useState(!_appUserCache);

  useEffect(() => {
    // Pre-load valid select options regardless of user
    fetchValidAuthorIds().then((ids) => {
      if (ids) setValidAuthorIds(ids);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded || !user) return;

    // Clear cache if the Clerk user has changed (e.g. different person logged in)
    if (_appUserCache && _appUserCache.clerk_user_id && _appUserCache.clerk_user_id !== user.id) {
      _appUserCache = null;
    }
    if (_appUserCache) {
      stampLastLogin(_appUserCache);
      setAppUser(_appUserCache);
      setLoading(false);
      return;
    }

    setLoading(true);

    (async () => {
      // 1. Match by clerk_user_id — primary, most reliable
      const byClerk = await aurora.fetchAll('Users', {
        filterByFormula: `{clerk_user_id} = "${user.id}"`,
        maxRecords: 1,
      }).catch(() => []);
      if (byClerk.length) {
        const u = { _id: byClerk[0].id, ...byClerk[0].fields };
        // Sync Clerk profile photo to the Users table so teammates can see it
        if (user.imageUrl && u.clerk_image_url !== user.imageUrl) {
          aurora.update('Users', u._id, { clerk_image_url: user.imageUrl }).catch(() => {});
          u.clerk_image_url = user.imageUrl;
        }
        stampLastLogin(u);
        _appUserCache = u;
        setAppUser(u);
        setLoading(false);
        return;
      }

      // 2. Match by email
      const email = user.primaryEmailAddress?.emailAddress;
      if (email) {
        const byEmail = await aurora.fetchAll('Users', {
          filterByFormula: `{email} = "${email}"`,
          maxRecords: 1,
        }).catch(() => []);
        if (byEmail.length) {
          const u = { _id: byEmail[0].id, ...byEmail[0].fields };
          const updates = {};
          if (user.id && !u.clerk_user_id) updates.clerk_user_id = user.id;
          if (user.imageUrl && u.clerk_image_url !== user.imageUrl) updates.clerk_image_url = user.imageUrl;
          if (Object.keys(updates).length) {
            aurora.update('Users', u._id, updates).catch(() => {});
            Object.assign(u, updates);
          }
          stampLastLogin(u);
          _appUserCache = u;
          setAppUser(u);
          setLoading(false);
          return;
        }
      }

      // 3. Env var override — last resort for dev when clerk_user_id isn't set yet
      const envOverride = import.meta.env.VITE_DEFAULT_AUTHOR_ID;
      if (envOverride) {
        const records = await aurora.fetchAll('Users', {
          filterByFormula: `{id} = "${envOverride}"`,
          maxRecords: 1,
        }).catch(() => []);
        if (records.length) {
          const u = { _id: records[0].id, ...records[0].fields };
          _appUserCache = u;
          setAppUser(u);
          setLoading(false);
          return;
        }
      }

      setLoading(false);
    })();
  }, [isLoaded, user?.id]);

  const appUserId = appUser?.id || null;
  const appUserName = appUser
    ? `${appUser.first_name || ''} ${appUser.last_name || ''}`.trim()
    : user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Unknown';

  // Is the resolved ID actually valid in the Notes.author_id select field?
  const isValidAuthor = !validAuthorIds || (appUserId && validAuthorIds.includes(appUserId));

  return { appUser, appUserId, appUserName, validAuthorIds, isValidAuthor, loading };
}
