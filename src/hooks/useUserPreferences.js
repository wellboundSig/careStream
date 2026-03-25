import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@clerk/react';
import { fetchPreferences, createPreferences, updatePreferences } from '../api/userPreferences.js';

const MAX_PINS = 6;

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
}

export function useUserPreferences() {
  const { user, isLoaded } = useUser();

  // Stable ref so callbacks never stale-close over the record ID
  const recordIdRef = useRef(null);

  const [prefs, setPrefs] = useState({ subnavEnabled: false, pinnedPages: [], splitScreenEnabled: false, dashboardMode: 'executive' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded || !user) { setLoading(false); return; }

    setLoading(true);
    fetchPreferences(user.id)
      .then((rec) => {
        if (rec) {
          recordIdRef.current = rec.id;
          setPrefs({
            subnavEnabled:      rec.fields.subnav_enabled ?? false,
            pinnedPages:        safeParseJSON(rec.fields.pinned_pages, []),
            splitScreenEnabled: rec.fields.split_screen_enabled ?? false,
            dashboardMode:      rec.fields.dashboard_mode || 'executive',
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isLoaded, user?.id]);

  // Base save — accepts partial updates, merges, persists optimistically
  const save = useCallback(async (updates) => {
    if (!user) return;

    setPrefs((prev) => {
      const next = { ...prev, ...updates };

      // Persist in background; revert on error
      const persist = async () => {
        try {
          if (recordIdRef.current) {
            await updatePreferences(recordIdRef.current, next);
          } else {
            const rec = await createPreferences(user.id, next);
            recordIdRef.current = rec.id;
          }
        } catch (err) {
          console.error('Failed to save preferences:', err);
          setPrefs(prev); // revert
        }
      };

      persist();
      return next;
    });
  }, [user]);

  const pinPage = useCallback((path) => {
    setPrefs((prev) => {
      if (prev.pinnedPages.includes(path)) return prev;
      if (prev.pinnedPages.length >= MAX_PINS) return prev;
      const next = {
        subnavEnabled: true, // auto-enable when a page is pinned
        pinnedPages: [...prev.pinnedPages, path],
      };
      // Persist
      const persist = async () => {
        try {
          if (recordIdRef.current) {
            await updatePreferences(recordIdRef.current, next);
          } else if (user) {
            const rec = await createPreferences(user.id, next);
            recordIdRef.current = rec.id;
          }
        } catch (err) {
          console.error('Failed to pin page:', err);
          setPrefs(prev);
        }
      };
      persist();
      return { ...prev, ...next };
    });
  }, [user]);

  const unpinPage = useCallback((path) => {
    setPrefs((prev) => {
      const pinnedPages = prev.pinnedPages.filter((p) => p !== path);
      const next = { ...prev, pinnedPages };
      const persist = async () => {
        try {
          if (recordIdRef.current) {
            await updatePreferences(recordIdRef.current, { pinnedPages });
          }
        } catch (err) {
          console.error('Failed to unpin page:', err);
          setPrefs(prev);
        }
      };
      persist();
      return next;
    });
  }, []);

  const togglePin = useCallback((path) => {
    setPrefs((prev) => {
      if (prev.pinnedPages.includes(path)) {
        const pinnedPages = prev.pinnedPages.filter((p) => p !== path);
        const next = { ...prev, pinnedPages };
        (async () => {
          try { if (recordIdRef.current) await updatePreferences(recordIdRef.current, { pinnedPages }); }
          catch { setPrefs(prev); }
        })();
        return next;
      } else {
        if (prev.pinnedPages.length >= MAX_PINS) return prev;
        const pinnedPages = [...prev.pinnedPages, path];
        const next = { ...prev, subnavEnabled: true, pinnedPages };
        (async () => {
          try {
            if (recordIdRef.current) {
              await updatePreferences(recordIdRef.current, { subnavEnabled: true, pinnedPages });
            } else if (user) {
              const rec = await createPreferences(user.id, next);
              recordIdRef.current = rec.id;
            }
          } catch { setPrefs(prev); }
        })();
        return next;
      }
    });
  }, [user]);

  const reorderPins = useCallback((newOrder) => {
    setPrefs((prev) => {
      const next = { ...prev, pinnedPages: newOrder };
      (async () => {
        try { if (recordIdRef.current) await updatePreferences(recordIdRef.current, { pinnedPages: newOrder }); }
        catch { setPrefs(prev); }
      })();
      return next;
    });
  }, []);

  return { prefs, save, loading, pinPage, unpinPage, togglePin, reorderPins, MAX_PINS };
}
