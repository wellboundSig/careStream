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

function connect() {
  if (!WORKER_URL || import.meta.env.DEV) return;
  cleanup();

  const sseUrl = WORKER_URL.replace(/\/$/, '') + '/events';
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
