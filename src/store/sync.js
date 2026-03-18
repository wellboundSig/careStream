import airtable from '../api/airtable.js';
import { useCareStore, mergeEntities } from './careStore.js';
import { silentRehydrate } from './hydrate.js';

function normalize(records) {
  const map = {};
  for (const r of records) {
    map[r.id] = { _id: r.id, ...r.fields };
  }
  return map;
}

// ── Table tiers for polling ─────────────────────────────────────────────────
// Hot: stage changes, task completions — visible to other users within seconds
const HOT = [
  { key: 'referrals', table: 'Referrals', sortField: 'updated_at' },
  { key: 'tasks',     table: 'Tasks',     sortField: 'updated_at' },
];

// Warm: notes, conflicts — visible within ~30s
const WARM = [
  { key: 'notes',     table: 'Notes',     sortField: 'updated_at' },
  { key: 'patients',  table: 'Patients',  sortField: 'updated_at' },
  { key: 'conflicts', table: 'Conflicts', sortField: 'created_at' },
];

const HOT_INTERVAL  = 10_000;   // 10 seconds
const WARM_INTERVAL = 30_000;   // 30 seconds
const FULL_INTERVAL = 300_000;  // 5 minutes — full consistency pass

let hotTimer  = null;
let warmTimer = null;
let fullTimer = null;

async function syncTier(tables) {
  for (const { key, table, sortField } of tables) {
    try {
      const records = await airtable.fetchAll(table, {
        sort: [{ field: sortField, direction: 'desc' }],
        maxRecords: 100,
      });
      if (records.length > 0) {
        mergeEntities(key, normalize(records));
      }
    } catch {
      // Silent — background sync never disrupts UI
    }
  }
  useCareStore.setState({ lastSyncAt: Date.now() });
}

/**
 * Immediately sync the hot tables (Referrals, Tasks).
 * Called by triggerDataRefresh() after mutations.
 */
export async function syncHotTables() {
  await syncTier(HOT);
}

/**
 * Start tiered background polling. Call once after hydration completes.
 */
export function startSync() {
  if (hotTimer) return; // already running

  hotTimer  = setInterval(() => syncTier(HOT),  HOT_INTERVAL);
  warmTimer = setInterval(() => syncTier(WARM), WARM_INTERVAL);
  fullTimer = setInterval(() => silentRehydrate(), FULL_INTERVAL);
}

/**
 * Stop all background polling. Call on unmount.
 */
export function stopSync() {
  clearInterval(hotTimer);
  clearInterval(warmTimer);
  clearInterval(fullTimer);
  hotTimer = warmTimer = fullTimer = null;
}
