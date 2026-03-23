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
const HOT = [
  { key: 'referrals', table: 'Referrals', sortField: 'updated_at' },
  { key: 'patients',  table: 'Patients',  sortField: 'updated_at' },
  { key: 'tasks',     table: 'Tasks',     sortField: 'updated_at' },
];

const WARM = [
  { key: 'notes',     table: 'Notes',     sortField: 'updated_at' },
  { key: 'conflicts', table: 'Conflicts', sortField: 'created_at' },
];

const HOT_INTERVAL  = 45_000;      // 45 seconds (was 10s — 78% reduction)
const WARM_INTERVAL = 120_000;     // 2 minutes  (was 30s — 75% reduction)
const FULL_INTERVAL = 1_800_000;   // 30 minutes (was 5m  — 83% reduction)

let hotTimer  = null;
let warmTimer = null;
let fullTimer = null;
let _visible  = true;

// ── Incremental sync — only fetch records changed since last sync ───────────
// Falls back to "latest 100" on first pass (no lastSyncAt yet).
function buildIncrementalFormula(sortField) {
  const lastSync = useCareStore.getState().lastSyncAt;
  if (!lastSync) return null;
  const iso = new Date(lastSync - 5000).toISOString();
  return `IS_AFTER({${sortField}}, '${iso}')`;
}

async function syncTier(tables) {
  const fetches = tables.map(async ({ key, table, sortField }) => {
    try {
      const formula = buildIncrementalFormula(sortField);
      const params = {
        sort: [{ field: sortField, direction: 'desc' }],
        ...(formula ? { filterByFormula: formula } : { maxRecords: 100 }),
      };
      const records = await airtable.fetchAll(table, params);
      if (records.length > 0) {
        mergeEntities(key, normalize(records));
      }
    } catch {
      // Silent — background sync never disrupts UI
    }
  });
  await Promise.all(fetches);
  useCareStore.setState({ lastSyncAt: Date.now() });
}

/**
 * Immediately sync the hot tables.
 * Called by triggerDataRefresh() after mutations.
 */
export async function syncHotTables() {
  await syncTier(HOT);
}

// ── Visibility-aware polling ────────────────────────────────────────────────
// Pauses all intervals when the tab is hidden, resumes + does an immediate
// catch-up sync when the tab becomes visible again.

function onVisibilityChange() {
  if (document.hidden) {
    _visible = false;
    clearTimers();
  } else {
    _visible = true;
    syncTier(HOT);
    scheduleTimers();
  }
}

function clearTimers() {
  clearInterval(hotTimer);
  clearInterval(warmTimer);
  clearInterval(fullTimer);
  hotTimer = warmTimer = fullTimer = null;
}

function scheduleTimers() {
  if (hotTimer) return;
  hotTimer  = setInterval(() => syncTier(HOT),  HOT_INTERVAL);
  warmTimer = setInterval(() => syncTier(WARM), WARM_INTERVAL);
  fullTimer = setInterval(() => silentRehydrate(), FULL_INTERVAL);
}

export function startSync() {
  if (hotTimer) return;
  scheduleTimers();
  document.addEventListener('visibilitychange', onVisibilityChange);
}

export function stopSync() {
  clearTimers();
  _visible = true;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}
