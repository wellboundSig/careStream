#!/usr/bin/env node
/**
 * test-realtime.mjs — end-to-end AppSync Events smoke test.
 *
 * 1. Opens the Events WebSocket using API-key auth (Node has no Clerk session;
 *    browsers use the Lambda-authorizer path with their Clerk JWT).
 * 2. Subscribes to default/changes.
 * 3. Performs a real write through wellbound-api (create + delete a Teams row).
 * 4. Asserts the created/deleted events arrive on the socket.
 *
 * Env (from careStream/.env): WB_EVENTS_HTTP, WB_EVENTS_REALTIME,
 * WB_EVENTS_API_KEY, WB_API_URL, WB_INTERNAL_KEY.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const HTTP_HOST = new URL(process.env.WB_EVENTS_HTTP).host;
const WS_URL = process.env.WB_EVENTS_REALTIME;
const API_KEY = process.env.WB_EVENTS_API_KEY;
const API = process.env.WB_API_URL;
const INTERNAL = process.env.WB_INTERNAL_KEY;

const authHeader = { host: HTTP_HOST, 'x-api-key': API_KEY };
const b64url = (s) => Buffer.from(s).toString('base64url');

const received = [];
let ws;

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL, [
      'aws-appsync-event-ws',
      `header-${b64url(JSON.stringify(authHeader))}`,
    ]);
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'connection_ack') {
        ws.send(JSON.stringify({
          type: 'subscribe', id: 'test-sub-1', channel: 'default/changes',
          authorization: authHeader,
        }));
      } else if (data.type === 'subscribe_success') {
        clearTimeout(timeout);
        resolve();
      } else if (data.type === 'data') {
        received.push(JSON.parse(data.event));
      } else if (data.type === 'subscribe_error' || data.type === 'connection_error') {
        clearTimeout(timeout);
        reject(new Error(`ws error: ${JSON.stringify(data)}`));
      }
    };
    ws.onerror = (e) => { clearTimeout(timeout); reject(new Error(`ws failed: ${e.message || 'unknown'}`)); };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('connecting…');
await connect();
console.log('subscribed to default/changes');

// Real write through the API → should emit created + deleted events.
const create = await fetch(`${API}/internal/Teams`, {
  method: 'POST',
  headers: { 'x-internal-key': INTERNAL, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { id: 'tm_rt_test', name: 'Realtime Smoke' } }),
}).then((r) => r.json());
console.log('created row:', create.id);
await fetch(`${API}/internal/Teams/${create.id}`, { method: 'DELETE', headers: { 'x-internal-key': INTERNAL } });
console.log('deleted row');

await sleep(2500);
ws.close();

const created = received.find((e) => e.table === 'Teams' && e.action === 'created' && e.recId === create.id);
const deleted = received.find((e) => e.table === 'Teams' && e.action === 'deleted' && e.recId === create.id);
console.log(`events received: ${received.length}`, JSON.stringify(received.slice(0, 4)));
if (created && deleted) {
  console.log('✅ REALTIME OK — created + deleted events arrived');
  process.exit(0);
}
console.error('❌ missing expected events');
process.exit(1);
