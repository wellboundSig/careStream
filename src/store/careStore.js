import { create } from 'zustand';

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
