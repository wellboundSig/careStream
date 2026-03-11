import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import airtable from '../api/airtable.js';

// Session-level caches
let _appUserCache = null;
let _validAuthorIds = null;

async function fetchValidAuthorIds() {
  if (_validAuthorIds) return _validAuthorIds;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/meta/bases/${import.meta.env.VITE_AIRTABLE_BASE_ID}/tables`,
      { headers: { Authorization: `Bearer ${import.meta.env.VITE_AIRTABLE_TOKEN}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const notesTable = data.tables?.find((t) => t.name === 'Notes');
    const authorField = notesTable?.fields?.find((f) => f.name === 'author_id');
    const choices = authorField?.options?.choices?.map((c) => c.name) || null;
    _validAuthorIds = choices;
    return choices;
  } catch {
    return null;
  }
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
    if (_appUserCache) { setAppUser(_appUserCache); setLoading(false); return; }

    setLoading(true);

    (async () => {
      // 1. Match by clerk_user_id — primary, most reliable
      const byClerk = await airtable.fetchAll('Users', {
        filterByFormula: `{clerk_user_id} = "${user.id}"`,
        maxRecords: 1,
      }).catch(() => []);
      if (byClerk.length) {
        const u = { _id: byClerk[0].id, ...byClerk[0].fields };
        // Sync Clerk profile photo to Airtable so teammates can see it
        if (user.imageUrl && u.clerk_image_url !== user.imageUrl) {
          airtable.update('Users', u._id, { clerk_image_url: user.imageUrl }).catch(() => {});
          u.clerk_image_url = user.imageUrl;
        }
        _appUserCache = u;
        setAppUser(u);
        setLoading(false);
        return;
      }

      // 2. Match by email
      const email = user.primaryEmailAddress?.emailAddress;
      if (email) {
        const byEmail = await airtable.fetchAll('Users', {
          filterByFormula: `{email} = "${email}"`,
          maxRecords: 1,
        }).catch(() => []);
        if (byEmail.length) {
          const u = { _id: byEmail[0].id, ...byEmail[0].fields };
          if (user.imageUrl && u.clerk_image_url !== user.imageUrl) {
            airtable.update('Users', u._id, { clerk_image_url: user.imageUrl }).catch(() => {});
            u.clerk_image_url = user.imageUrl;
          }
          _appUserCache = u;
          setAppUser(u);
          setLoading(false);
          return;
        }
      }

      // 3. Env var override — last resort for dev when clerk_user_id isn't set yet
      const envOverride = import.meta.env.VITE_DEFAULT_AUTHOR_ID;
      if (envOverride) {
        const records = await airtable.fetchAll('Users', {
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

      // 4. Fallback: find first user whose id IS a valid Notes author option
      const valid = await fetchValidAuthorIds();
      if (valid?.length) {
        const formula = `OR(${valid.map((id) => `{id} = "${id}"`).join(',')})`;
        const validUsers = await airtable.fetchAll('Users', {
          filterByFormula: formula,
          maxRecords: 1,
        }).catch(() => []);
        if (validUsers.length) {
          const u = { _id: validUsers[0].id, ...validUsers[0].fields };
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
