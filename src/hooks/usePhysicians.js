import { useMemo } from 'react';
import { useCareStore, updateEntity } from '../store/careStore.js';
import airtable from '../api/airtable.js';

// ── Backward-compat exports ────────────────────────────────────────────────
// These are imported by AppShell, PhysicianDrawer, PhysicianPicker, etc.

export function prefetchPhysicians() { /* no-op — store hydration handles this */ }

export async function refreshPhysicians() {
  try {
    const records = await airtable.fetchAll('Physicians');
    const normalized = {};
    records.forEach((r) => { normalized[r.id] = { _id: r.id, ...r.fields }; });
    useCareStore.setState({ physicians: normalized });
  } catch (err) {
    console.error('[refreshPhysicians]', err.message);
  }
}

export function updatePhysicianInCache(recordId, fields) {
  updateEntity('physicians', recordId, fields);
}

export function getPhysiciansCache() {
  return Object.values(useCareStore.getState().physicians);
}

export function subscribeToPhysicians(fn) {
  let prev = useCareStore.getState().physicians;
  return useCareStore.subscribe((state) => {
    if (state.physicians !== prev) {
      prev = state.physicians;
      fn();
    }
  });
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function usePhysicians() {
  const physicians = useCareStore((s) => s.physicians);
  const hydrated   = useCareStore((s) => s.hydrated);

  const data = useMemo(() => Object.values(physicians), [physicians]);

  return {
    physicians: data,
    loading: !hydrated,
    error: null,
    refresh: refreshPhysicians,
  };
}
