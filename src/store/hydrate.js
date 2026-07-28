import airtable from '../api/airtable.js';
import { useCareStore, mergeEntities } from './careStore.js';

function normalize(records) {
  const map = {};
  for (const r of records) {
    map[r.id] = { _id: r.id, ...r.fields };
  }
  return map;
}

const TABLES = [
  // High-volume operational tables
  { key: 'patients',         table: 'Patients' },
  { key: 'referrals',        table: 'Referrals' },
  { key: 'notes',            table: 'Notes' },
  { key: 'tasks',            table: 'Tasks' },
  { key: 'stageHistory',     table: 'StageHistory' },
  { key: 'files',            table: 'Files' },
  { key: 'insuranceChecks',  table: 'InsuranceChecks' },
  { key: 'conflicts',        table: 'Conflicts' },
  { key: 'conflictCategories', table: 'ConflictCategories' },
  { key: 'authorizations',   table: 'Authorizations' },
  { key: 'disenrollmentAssistanceFlags', table: 'DisenrollmentAssistanceFlags' },
  { key: 'episodes',         table: 'Episodes' },
  { key: 'triageAdult',      table: 'TriageAdult' },
  { key: 'triagePediatric',  table: 'TriagePediatric' },
  { key: 'cursoryReviews',   table: 'CursoryReview' },
  { key: 'clinicalReviews',  table: 'ClinicalReview' },
  { key: 'opwddCases',          table: 'OPWDDEligibilityCases' },
  { key: 'opwddChecklistItems', table: 'OPWDDCaseChecklistItems' },

  // Lookup / reference tables (small, static-ish)
  { key: 'entities',           table: 'Entities' },
  { key: 'marketers',          table: 'Marketers' },
  { key: 'users',              table: 'Users' },
  { key: 'referralSources',    table: 'ReferralSources' },
  { key: 'roles',              table: 'Roles' },
  { key: 'facilities',         table: 'Facilities' },
  { key: 'physicians',         table: 'Physicians' },
  { key: 'knownGuardians',     table: 'KnownGuardians' },
  { key: 'patientGuardians',   table: 'PatientGuardians' },
  { key: 'campaigns',          table: 'Campaigns' },
  { key: 'marketerFacilities', table: 'MarketerFacilities' },
  { key: 'campaignMarketers',  table: 'CampaignMarketers' },
  { key: 'permissions',        table: 'Permissions' },
  { key: 'permissionPresets',  table: 'PermissionPresets' },
  { key: 'userPermissions',    table: 'UserPermissions' },
  { key: 'languages',          table: 'Languages' },
  { key: 'userLanguages',      table: 'UserLanguages' },
  { key: 'issueReports',       table: 'IssueReports' },
  { key: 'cocNurseFacilities', table: 'CocNurseFacilities' },

  // Inbound Submissions
  { key: 'inboundSubmissions',            table: 'InboundSubmissions' },
  { key: 'inboundSubmissionAttachments',  table: 'InboundSubmissionAttachments' },
  { key: 'inboundSubmissionEvents',       table: 'InboundSubmissionEvents' },

  // Network facilities
  { key: 'networkFacilities',  table: 'NetworkFacilities' },

  // Department system
  { key: 'departments',        table: 'Departments' },
  { key: 'departmentScopes',   table: 'DepartmentScopes' },
  { key: 'activityLog',        table: 'ActivityLog' },
];

/** table name → store key, used by the realtime layer for targeted merges. */
export const TABLE_TO_STORE_KEY = {
  ...Object.fromEntries(TABLES.map((t) => [t.table, t.key])),
  // Recipient-scoped: not bulk-hydrated (privacy + size). Loaded via hydrateNotificationsForUser.
  Notifications: 'notifications',
};

/**
 * Load the signed-in user's notification inbox only (never all users' rows).
 */
export async function hydrateNotificationsForUser(userId) {
  if (!userId) return;
  try {
    const { getNotificationsForUser } = await import('../api/notifications.js');
    const records = await getNotificationsForUser(userId, { maxRecords: 150 });
    mergeEntities('notifications', normalize(records));
  } catch (err) {
    console.warn('[hydrate] Notifications:', err.message);
  }
}

/** Wait briefly for Clerk so we don't hydrate unauthenticated → empty store. */
async function waitForClerkToken(maxMs = 10000) {
  if (typeof window === 'undefined') return null;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const session = window.Clerk?.session;
      if (session) {
        const token = await session.getToken();
        if (token) return token;
      }
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    return (await window.Clerk?.session?.getToken?.()) || null;
  } catch {
    return null;
  }
}

/**
 * Batched hydrate (wellbound-api only): all tables in ONE round trip via
 * POST /hydrate. Returns results in the same { key, data } shape, or null if
 * unavailable (caller falls back to per-table fetches).
 */
async function batchedHydrate() {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) return null;
  try {
    const token = await waitForClerkToken();
    if (!token) {
      console.warn('[hydrate] No Clerk token yet — skipping batched hydrate');
      return null;
    }
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/hydrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tables: TABLES.map((t) => t.table) }),
    });
    if (!res.ok) {
      console.warn(`[hydrate] Batched hydrate failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data?.tables) return null;
    return TABLES.map(({ key, table }) => ({
      key,
      data: normalize(data.tables[table]?.records || []),
    }));
  } catch (err) {
    console.warn('[hydrate] Batched hydrate error:', err?.message || err);
    return null;
  }
}

export async function hydrateStore() {
  const state = useCareStore.getState();
  if (state.hydrated || state.hydrating) return;

  useCareStore.setState({
    hydrating: true,
    hydrationError: null,
    hydrationProgress: { done: 0, total: TABLES.length },
  });

  try {
    // One automatic retry — covers Clerk token race + brief 429s from
    // double-mounted Vite tabs without trapping the user on an error screen.
    let results = null;
    for (let attempt = 0; attempt < 2 && !results; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
      results = await batchedHydrate();
    }

    if (results) {
      useCareStore.setState({ hydrationProgress: { done: TABLES.length, total: TABLES.length } });
    } else {
      let done = 0;
      results = await Promise.all(
        TABLES.map(async ({ key, table }) => {
          try {
            const records = await airtable.fetchAll(table);
            done++;
            useCareStore.setState({ hydrationProgress: { done, total: TABLES.length } });
            return { key, data: normalize(records) };
          } catch (err) {
            done++;
            useCareStore.setState({ hydrationProgress: { done, total: TABLES.length } });
            console.warn(`[hydrate] Failed to fetch ${table}:`, err.message);
            return { key, data: {} };
          }
        }),
      );
    }

    const batch = {
      hydrated: true,
      hydrating: false,
      hydrationError: null,
      lastSyncAt: Date.now(),
    };
    for (const { key, data } of results) {
      batch[key] = data;
    }

    useCareStore.setState(batch);
  } catch (err) {
    useCareStore.setState({
      hydrating: false,
      hydrationError: err.message || 'Hydration failed',
    });
  }
}

/**
 * Silent re-hydrate — fetches all tables and merges into the store
 * without showing a loading screen. Used for periodic full-consistency sync.
 */
export async function silentRehydrate() {
  try {
    let results = await batchedHydrate();
    if (!results) {
      results = await Promise.all(
        TABLES.map(async ({ key, table }) => {
          try {
            const records = await airtable.fetchAll(table);
            return { key, data: normalize(records) };
          } catch {
            return null;
          }
        }),
      );
    }

    // Merge per table (identity-preserving) instead of wholesale replacement:
    // unchanged records keep their references, so a background re-hydrate with
    // no actual changes causes zero re-renders. Rows deleted by other users
    // are removed live by the realtime layer; a full reset happens at boot.
    for (const result of results) {
      if (result) mergeEntities(result.key, result.data);
    }
    useCareStore.setState({ lastSyncAt: Date.now() });
  } catch {
    // Silent failure — background sync should never disrupt the UI
  }
}
