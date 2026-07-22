// Realtime push via AWS AppSync Events (migration plan Phase 8).
//
// wellbound-api publishes { table, recId, action, actorSub } to the
// `default/changes` channel after every successful write. This module holds a
// WebSocket subscription (authenticated with the user's Clerk JWT through the
// Lambda authorizer) and applies each change in under a second:
//   - invalidates the client read cache for the table
//   - merges/removes the exact record in the Zustand store
//   - fires an in-app notification when a task is assigned to YOU
//
// Falls back gracefully: if the socket drops, exponential-backoff reconnect;
// meanwhile the tiered polling in sync.js still provides eventual consistency.
//
// Legacy mode (VITE_API_URL unset): the old Cloudflare SSE path.

import airtable, { invalidateTable } from '../api/airtable.js';
import { useCareStore, mergeEntities, removeEntity } from './careStore.js';
import { TABLE_TO_STORE_KEY } from './hydrate.js';
import { syncHotTables } from './sync.js';
import { silentRehydrate } from './hydrate.js';

const EVENTS_HOST = import.meta.env.VITE_EVENTS_HTTP_HOST || '';
const WORKER_URL = import.meta.env.VITE_AIRTABLE_WORKER_URL;

let socket = null;
let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let stopped = false;

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── Change application ────────────────────────────────────────────────────────

function myClerkId() {
  try { return window.Clerk?.user?.id || null; } catch { return null; }
}

function myAppUserId() {
  const clerkId = myClerkId();
  if (!clerkId) return null;
  const users = useCareStore.getState().users || {};
  const me = Object.values(users).find((u) => u.clerk_user_id === clerkId);
  return me?.id || null;
}

/** In-app notification — AppShell renders these (see RealtimeToasts). */
export function notify(detail) {
  try { window.dispatchEvent(new CustomEvent('wb:notification', { detail })); } catch { /* ssr/test */ }
}

async function applyChange({ table, recId, action, actorSub }) {
  invalidateTable(table);
  const storeKey = TABLE_TO_STORE_KEY[table];
  if (!storeKey || !recId) return;

  if (action === 'deleted') {
    removeEntity(storeKey, recId);
    return;
  }

  // Own-write echo: the optimistic update already put this data in the store.
  // Re-fetching would only churn updated_at and trigger pointless re-renders;
  // polling reconciles any drift.
  if (actorSub && actorSub === myClerkId()) return;

  let record = null;
  try {
    record = await airtable.fetchOne(table, recId);
  } catch {
    return; // deleted in the meantime / transient — polling will reconcile
  }
  const me = myAppUserId();

  // Notifications are recipient-private — never merge another user's inbox rows.
  if (table === 'Notifications') {
    if (!me || record.fields.recipient_user_id !== me) return;
  }

  const prev = useCareStore.getState()[storeKey]?.[recId];
  mergeEntities(storeKey, { [recId]: { _id: recId, ...record.fields } });

  // Task-assignment toast: someone ELSE created/updated a task that is
  // now assigned to me (and wasn't before).
  if (table === 'Tasks' && actorSub !== myClerkId()) {
    const assignee = record.fields.assigned_to_id;
    if (me && assignee === me && prev?.assigned_to_id !== me) {
      notify({
        title: 'New task assigned to you',
        body: record.fields.title || record.fields.description || 'Open Tasks to view it.',
        href: '/tasks',
      });
    }
  }

  // Mention (and future) inbox toasts when a notification lands for me.
  if (
    table === 'Notifications' &&
    actorSub !== myClerkId() &&
    record.fields.recipient_user_id === me &&
    !prev
  ) {
    notify({
      title: record.fields.title || 'New notification',
      body: record.fields.body || '',
      href: record.fields.patient_id ? null : undefined,
    });
  }
}

// ── AppSync Events WebSocket ─────────────────────────────────────────────────

async function connectAppSync() {
  if (stopped) return;
  cleanup();

  let token = null;
  try {
    token = window.Clerk?.session ? await window.Clerk.session.getToken() : null;
  } catch { /* not signed in yet */ }
  if (!token) {
    reconnectTimer = setTimeout(connectAppSync, 3000);
    return;
  }

  const authHeader = { host: EVENTS_HOST, Authorization: token };
  const wsUrl = `wss://${EVENTS_HOST.replace('appsync-api', 'appsync-realtime-api')}/event/realtime`;

  try {
    socket = new WebSocket(wsUrl, ['aws-appsync-event-ws', `header-${b64url(JSON.stringify(authHeader))}`]);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
  socket.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    if (data.type === 'connection_ack') {
      reconnectDelay = 1000;
      socket.send(JSON.stringify({
        type: 'subscribe',
        id: `sub-${Date.now()}`,
        channel: 'default/changes',
        authorization: authHeader,
      }));
    } else if (data.type === 'data') {
      try { applyChange(JSON.parse(data.event)); } catch { /* malformed */ }
    } else if (data.type === 'subscribe_error' || data.type === 'connection_error') {
      scheduleReconnect();
    }
    // 'ka' keepalives and 'subscribe_success' need no action.
  };
  socket.onclose = () => { if (!stopped) scheduleReconnect(); };
  socket.onerror = () => { /* onclose follows */ };
}

function scheduleReconnect() {
  cleanup();
  clearTimeout(reconnectTimer);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  reconnectTimer = setTimeout(connectAppSync, reconnectDelay);
}

// ── Legacy Cloudflare SSE (pre-Aurora rollback path) ─────────────────────────

function onSseMessage(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'connected') { reconnectDelay = 1000; return; }
    if (data.type === 'airtable_change') {
      const hot = new Set(['Referrals', 'Patients', 'Tasks']);
      if (data.tables?.some((t) => hot.has(t))) syncHotTables();
      else silentRehydrate();
    }
  } catch { /* ignore */ }
}

async function connectSse() {
  if (!WORKER_URL || import.meta.env.DEV) return;
  cleanup();
  let token = null;
  try {
    token = window.Clerk?.session ? await window.Clerk.session.getToken() : null;
  } catch { /* ignore */ }
  if (!token) { reconnectTimer = setTimeout(connectSse, 3000); return; }
  eventSource = new EventSource(`${WORKER_URL.replace(/\/$/, '')}/events?token=${encodeURIComponent(token)}`);
  eventSource.onmessage = onSseMessage;
  eventSource.onerror = () => {
    cleanup();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    reconnectTimer = setTimeout(connectSse, reconnectDelay);
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function cleanup() {
  if (socket) { try { socket.close(); } catch { /* already closed */ } socket = null; }
  if (eventSource) { eventSource.close(); eventSource = null; }
}

function connect() {
  if (import.meta.env.VITE_API_URL && EVENTS_HOST) return connectAppSync();
  return connectSse();
}

export function startRealtime() {
  stopped = false;
  connect();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !socket && !eventSource && !stopped) {
      clearTimeout(reconnectTimer);
      reconnectDelay = 1000;
      connect();
    }
  });
}

export function stopRealtime() {
  stopped = true;
  cleanup();
  clearTimeout(reconnectTimer);
}
