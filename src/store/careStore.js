import { create } from 'zustand';
import { getBroadcastChannel, isBroadcastSuppressed, suppressBroadcast } from '../utils/windowManager.js';

export const useCareStore = create((set, get) => ({
  // ── Hydration lifecycle ───────────────────────────────────────────────────
  hydrated: false,
  hydrating: false,
  hydrationError: null,
  hydrationProgress: { done: 0, total: 0 },

  // ── Entity tables (normalized: keyed by Airtable record ID) ──────────────
  patients: {},
  referrals: {},
  notes: {},
  tasks: {},
  stageHistory: {},
  files: {},
  insuranceChecks: {},
  conflicts: {},
  authorizations: {},
  episodes: {},
  triageAdult: {},
  triagePediatric: {},

  // ── Lookup / reference tables ────────────────────────────────────────────
  marketers: {},
  users: {},
  referralSources: {},
  roles: {},
  facilities: {},
  physicians: {},
  campaigns: {},
  marketerFacilities: {},
  campaignMarketers: {},
  permissions: {},
  permissionPresets: {},
  userPermissions: {},

  // ── Network facilities ──────────────────────────────────────────────────
  networkFacilities: {},

  // ── Department system ──────────────────────────────────────────────────
  departments: {},
  departmentScopes: {},
  activityLog: {},

  // ── Sync state ───────────────────────────────────────────────────────────
  lastSyncAt: null,
  syncError: null,
}));

// ── Helpers for external (non-React) code ──────────────────────────────────

export function getStore() {
  return useCareStore.getState();
}

export function setStore(partial) {
  useCareStore.setState(partial);
}

export function mergeEntities(key, normalized) {
  useCareStore.setState((s) => ({
    [key]: { ...s[key], ...normalized },
  }));
}

export function updateEntity(key, recordId, fields) {
  useCareStore.setState((s) => ({
    [key]: {
      ...s[key],
      [recordId]: { ...s[key][recordId], ...fields },
    },
  }));
}

export function removeEntity(key, recordId) {
  useCareStore.setState((s) => {
    const copy = { ...s[key] };
    delete copy[recordId];
    return { [key]: copy };
  });
}

// ── Cross-window state sync via BroadcastChannel ─────────────────────────────

const SYNC_KEYS = [
  'patients', 'referrals', 'notes', 'tasks', 'stageHistory', 'files',
  'insuranceChecks', 'conflicts', 'authorizations', 'episodes',
  'triageAdult', 'triagePediatric', 'marketers', 'users', 'referralSources',
  'roles', 'facilities', 'physicians', 'campaigns', 'marketerFacilities',
  'campaignMarketers', 'permissions', 'permissionPresets', 'userPermissions',
  'networkFacilities',
  'departments', 'departmentScopes', 'activityLog',
  'lastSyncAt',
];

let _broadcastReady = false;

export function setupBroadcastSync() {
  if (_broadcastReady) return;
  _broadcastReady = true;

  const ch = getBroadcastChannel();
  if (!ch) return;

  useCareStore.subscribe((state, prevState) => {
    if (isBroadcastSuppressed()) return;
    const diff = {};
    let hasDiff = false;
    for (const key of SYNC_KEYS) {
      if (state[key] !== prevState[key]) {
        diff[key] = state[key];
        hasDiff = true;
      }
    }
    if (hasDiff) {
      try { ch.postMessage({ type: 'CARESTREAM_SYNC', payload: diff }); } catch {}
    }
  });

  ch.addEventListener('message', (event) => {
    if (event.data?.type === 'CARESTREAM_SYNC') {
      suppressBroadcast(() => {
        useCareStore.setState(event.data.payload);
      });
    }
  });
}
