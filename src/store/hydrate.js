import airtable from '../api/airtable.js';
import { useCareStore } from './careStore.js';

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
  { key: 'authorizations',   table: 'Authorizations' },
  { key: 'episodes',         table: 'Episodes' },
  { key: 'triageAdult',      table: 'TriageAdult' },
  { key: 'triagePediatric',  table: 'TriagePediatric' },
  { key: 'cursoryReviews',   table: 'CursoryReview' },
  { key: 'opwddCases',          table: 'OPWDDEligibilityCases' },
  { key: 'opwddChecklistItems', table: 'OPWDDCaseChecklistItems' },

  // Lookup / reference tables (small, static-ish)
  { key: 'marketers',          table: 'Marketers' },
  { key: 'users',              table: 'Users' },
  { key: 'referralSources',    table: 'ReferralSources' },
  { key: 'roles',              table: 'Roles' },
  { key: 'facilities',         table: 'Facilities' },
  { key: 'physicians',         table: 'Physicians' },
  { key: 'campaigns',          table: 'Campaigns' },
  { key: 'marketerFacilities', table: 'MarketerFacilities' },
  { key: 'campaignMarketers',  table: 'CampaignMarketers' },
  { key: 'permissions',        table: 'Permissions' },
  { key: 'permissionPresets',  table: 'PermissionPresets' },
  { key: 'userPermissions',    table: 'UserPermissions' },

  // Network facilities
  { key: 'networkFacilities',  table: 'NetworkFacilities' },

  // Department system
  { key: 'departments',        table: 'Departments' },
  { key: 'departmentScopes',   table: 'DepartmentScopes' },
  { key: 'activityLog',        table: 'ActivityLog' },
];

export async function hydrateStore() {
  const state = useCareStore.getState();
  if (state.hydrated || state.hydrating) return;

  useCareStore.setState({
    hydrating: true,
    hydrationError: null,
    hydrationProgress: { done: 0, total: TABLES.length },
  });

  try {
    let done = 0;

    const results = await Promise.all(
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
    const results = await Promise.all(
      TABLES.map(async ({ key, table }) => {
        try {
          const records = await airtable.fetchAll(table);
          return { key, data: normalize(records) };
        } catch {
          return null;
        }
      }),
    );

    const batch = { lastSyncAt: Date.now() };
    for (const result of results) {
      if (result) batch[result.key] = result.data;
    }

    useCareStore.setState(batch);
  } catch {
    // Silent failure — background sync should never disrupt the UI
  }
}
