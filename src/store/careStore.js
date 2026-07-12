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
  entities: {},
  notes: {},
  tasks: {},
  stageHistory: {},
  files: {},
  insuranceChecks: {},
  conflicts: {},
  conflictCategories: {},       // ConflictCategories — admin-managed conflict category list
  authorizations: {},
  disenrollmentAssistanceFlags: {}, // DisenrollmentAssistanceFlags — open/in_review rows drive the Disenrollment module queue
  episodes: {},
  triageAdult: {},
  triagePediatric: {},
  cursoryReviews: {},          // CursoryReview rows — one per referral
  clinicalReviews: {},         // ClinicalReview rows — one per referral (Clinical Intake RN checklist)
  opwddCases: {},              // OPWDDEligibilityCases — one per active OPWDD referral
  opwddChecklistItems: {},     // OPWDDCaseChecklistItems — per-requirement rows

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
  languages: {},
  userLanguages: {},

  // ── Inbound Submissions ────────────────────────────────────────────────
  inboundSubmissions: {},
  inboundSubmissionAttachments: {},
  inboundSubmissionEvents: {},

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

// Cheap deep-enough equality for store records: field values are primitives,
// strings, or small arrays — JSON comparison is exact for all of them.
function recordsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;
    if (typeof av === 'object' || typeof bv === 'object') {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

// Identity-preserving merge: records that haven't actually changed keep their
// EXACT object reference, and if nothing changed at all the setState is
// skipped entirely — so realtime echoes, polling passes, and re-hydrates with
// identical data cause ZERO re-renders (no more UI "snapping" on every write).
export function mergeEntities(key, normalized) {
  useCareStore.setState((s) => {
    const current = s[key] || {};
    let changed = false;
    const updates = {};
    for (const [id, record] of Object.entries(normalized)) {
      if (recordsEqual(current[id], record)) continue;
      updates[id] = record;
      changed = true;
    }
    if (!changed) return {}; // no-op — preserves all identities
    return { [key]: { ...current, ...updates } };
  });
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
  'insuranceChecks', 'conflicts', 'conflictCategories', 'authorizations', 'disenrollmentAssistanceFlags', 'episodes',
  'triageAdult', 'triagePediatric', 'cursoryReviews', 'clinicalReviews',
  'opwddCases', 'opwddChecklistItems',
  'entities',
  'marketers', 'users', 'referralSources',
  'roles', 'facilities', 'physicians', 'campaigns', 'marketerFacilities',
  'campaignMarketers', 'permissions', 'permissionPresets', 'userPermissions',
  'inboundSubmissions', 'inboundSubmissionAttachments', 'inboundSubmissionEvents',
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
