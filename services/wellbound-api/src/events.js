/**
 * events.js — publish change events to AppSync Events (realtime push).
 *
 * Every successful write publishes { table, recId, action, actorSub, at } to
 * the `default/changes` channel. Browsers hold a WebSocket subscription (via
 * the Clerk-verifying Lambda authorizer) and refresh the affected table in
 * under a second — this is what replaced the old Airtable-webhook SSE path.
 *
 * The publish IS awaited (unlike the access log): an unawaited fetch freezes
 * with the container and the last write before idle would silently lose its
 * event. A timeout guard caps the cost so a hung AppSync can never stall
 * writes — on timeout, clients still converge via the polling safety net.
 * Payload carries IDs only — never field data, so no PHI transits the bus.
 *
 * Env:
 *   EVENTS_HTTP_URL  — https://…appsync-api.us-east-2.amazonaws.com/event
 *   EVENTS_API_KEY   — AppSync API key (publish auth; server-side only)
 */

const EVENTS_HTTP_URL = process.env.EVENTS_HTTP_URL || '';
const EVENTS_API_KEY = process.env.EVENTS_API_KEY || '';
const PUBLISH_TIMEOUT_MS = 1500;

export async function publishChanges(changes) {
  if (!EVENTS_HTTP_URL || !EVENTS_API_KEY || !changes.length) return;
  const events = changes.map((c) => JSON.stringify({
    table: c.table, recId: c.recId || null, action: c.action,
    actorSub: c.actorSub || null, at: Date.now(),
  }));
  try {
    // AppSync Events accepts up to 5 events per request.
    const batches = [];
    for (let i = 0; i < events.length; i += 5) batches.push(events.slice(i, i + 5));
    await Promise.all(batches.map(async (batch) => {
      const res = await fetch(EVENTS_HTTP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': EVENTS_API_KEY },
        body: JSON.stringify({ channel: 'default/changes', events: batch }),
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      if (!res.ok) console.error('[events] publish failed:', res.status, (await res.text()).slice(0, 200));
    }));
  } catch (err) {
    console.error('[events] publish error:', err.message);
  }
}
