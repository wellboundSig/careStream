// SSE-based real-time sync — connects to the Cloudflare Worker's /events
// endpoint and triggers immediate store syncs when Airtable data changes.
// Falls back gracefully: if SSE isn't available or disconnects, the polling
// in sync.js still provides eventual consistency.

import { syncHotTables } from './sync.js';
import { silentRehydrate } from './hydrate.js';

const WORKER_URL = import.meta.env.VITE_AIRTABLE_WORKER_URL;

const HOT_TABLES = new Set([
  'Referrals', 'Patients', 'Tasks',
]);

let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

function onMessage(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'connected') {
      reconnectDelay = 1000;
      return;
    }
    if (data.type === 'airtable_change') {
      const isHot = data.tables?.some((t) => HOT_TABLES.has(t));
      if (isHot) {
        syncHotTables();
      } else {
        silentRehydrate();
      }
    }
  } catch {
    // Malformed message — ignore
  }
}

function onError() {
  cleanup();
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  reconnectTimer = setTimeout(connect, reconnectDelay);
}

function cleanup() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

async function connect() {
  // Post-Aurora-migration (VITE_API_URL set) the Airtable-webhook-driven SSE
  // stream no longer exists; tiered polling in sync.js carries freshness
  // (identical effective behavior — see migration plan Phase 7). Real push
  // returns as a Phase 8 enhancement.
  if (import.meta.env.VITE_API_URL) return;
  if (!WORKER_URL || import.meta.env.DEV) return;
  cleanup();

  // The worker now requires a Clerk session JWT on /events. EventSource can't
  // set headers, so pass it as a query param. If there's no session yet, retry
  // shortly — sync.js polling provides eventual consistency in the meantime.
  let token = null;
  try {
    token = (typeof window !== 'undefined' && window.Clerk?.session)
      ? await window.Clerk.session.getToken()
      : null;
  } catch { /* ignore */ }
  if (!token) {
    reconnectTimer = setTimeout(connect, 3000);
    return;
  }

  const sseUrl = `${WORKER_URL.replace(/\/$/, '')}/events?token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(sseUrl);
  eventSource.onmessage = onMessage;
  eventSource.onerror = onError;
}

export function startRealtime() {
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cleanup();
      clearTimeout(reconnectTimer);
    } else {
      connect();
    }
  });
}

export function stopRealtime() {
  cleanup();
  clearTimeout(reconnectTimer);
}
