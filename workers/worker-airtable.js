/**
 * worker-airtable
 *
 * Responsibilities:
 *   1. Proxy all Airtable REST API calls from the browser (no token in bundle).
 *   2. Handle Clerk webhooks to auto-create/update Airtable user records on signup.
 *   3. Manage Airtable webhooks — poll for payloads and push change notifications
 *      to connected clients via Server-Sent Events (SSE).
 *
 * Required Worker Secrets (Settings → Variables and Secrets):
 *   AIRTABLE_TOKEN        — Airtable Personal Access Token (pat...)
 *   AIRTABLE_BASE_ID      — Airtable Base ID (appr7CZdBQ966kwvL)
 *   CLERK_WEBHOOK_SECRET  — Clerk webhook signing secret (whsec_...)
 *
 * Required Worker Variable (plain text, not secret):
 *   DEFAULT_ROLE_ID       — role_id assigned to new users (e.g. rol_001)
 *
 * Optional KV Namespace Binding (for webhook cursor persistence):
 *   WEBHOOK_KV            — KV namespace for storing webhook cursors
 */

const ALLOWED_ORIGINS = [
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'http://localhost:5173',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// ── Clerk webhook signature verification (Svix / HMAC-SHA256) ────────────────

async function verifyClerkSignature(request, rawBody, secret) {
  try {
    const whSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const secretBytes = Uint8Array.from(atob(whSecret), (c) => c.charCodeAt(0));

    const msgId        = request.headers.get('svix-id') || '';
    const msgTimestamp = request.headers.get('svix-timestamp') || '';
    const msgSignature = request.headers.get('svix-signature') || '';

    if (!msgId || !msgTimestamp || !msgSignature) return false;

    // Reject messages older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(msgTimestamp, 10)) > 300) return false;

    const key = await crypto.subtle.importKey(
      'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const toSign   = `${msgId}.${msgTimestamp}.${rawBody}`;
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

    // svix-signature may contain multiple space-separated "v1,<base64>" values
    return msgSignature.split(' ').some((s) => {
      const [version, sig] = s.split(',');
      return version === 'v1' && sig === computed;
    });
  } catch {
    return false;
  }
}

// ── Generate next usr_XXX id ─────────────────────────────────────────────────

async function getNextUserId(env) {
  const res = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('Users')}?fields[]=id`,
    { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } }
  );
  const data = await res.json();
  let max = 0;
  for (const record of data.records || []) {
    const num = parseInt((record.fields?.id || '').replace('usr_', ''), 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `usr_${String(max + 1).padStart(3, '0')}`;
}

// ── Clerk webhook handler ─────────────────────────────────────────────────────

async function handleClerkWebhook(request, env) {
  const rawBody = await request.text();

  if (env.CLERK_WEBHOOK_SECRET) {
    const valid = await verifyClerkSignature(request, rawBody, env.CLERK_WEBHOOK_SECRET);
    if (!valid) return new Response('Unauthorized', { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // Only handle user lifecycle events
  if (!['user.created', 'user.updated'].includes(event.type)) {
    return new Response('OK', { status: 200 });
  }

  const d = event.data;
  const primaryEmail = d.email_addresses?.find(
    (e) => e.id === d.primary_email_address_id
  )?.email_address;

  if (!primaryEmail) return new Response('No primary email', { status: 400 });

  const firstName = d.first_name || '';
  const lastName  = d.last_name  || '';
  const imageUrl  = d.image_url  || d.profile_image_url || '';
  const clerkId   = d.id;

  // Look up existing Airtable user by email
  const searchUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('Users')}` +
    `?filterByFormula=${encodeURIComponent(`{email} = "${primaryEmail}"`)}&maxRecords=1`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  const searchData = await searchRes.json();
  const existing = searchData.records?.[0] || null;

  if (existing) {
    // Update existing record — fill in any missing fields
    const updates = { clerk_user_id: clerkId };
    if (imageUrl)                          updates.clerk_image_url = imageUrl;
    if (firstName && !existing.fields.first_name) updates.first_name = firstName;
    if (lastName  && !existing.fields.last_name)  updates.last_name  = lastName;

    await fetch(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('Users')}/${existing.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: updates }),
      }
    );
  } else if (event.type === 'user.created') {
    // Create a brand-new Airtable record
    const nextId = await getNextUserId(env);
    const fields = {
      id:              nextId,
      clerk_user_id:   clerkId,
      email:           primaryEmail,
      first_name:      firstName,
      last_name:       lastName,
      clerk_image_url: imageUrl,
      status:          'Active',
      scope:           'Main',
      role_id:         env.DEFAULT_ROLE_ID || 'rol_001',
    };

    await fetch(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('Users')}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }
    );
  }

  return new Response('OK', { status: 200 });
}

// ── SSE client registry (in-memory per isolate) ────────────────────────────

const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of sseClients) {
    try { controller.enqueue(new TextEncoder().encode(msg)); }
    catch { sseClients.delete(controller); }
  }
}

function handleSSE(request, origin) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  sseClients.add(writer);
  writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

  request.signal?.addEventListener('abort', () => {
    sseClients.delete(writer);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders(origin),
    },
  });
}

// ── Airtable Webhook helpers ────────────────────────────────────────────────
// These are called via the /webhooks/setup and scheduled() handler.

const AT_WEBHOOK_URL = (baseId) =>
  `https://api.airtable.com/v0/bases/${baseId}/webhooks`;

async function listWebhooks(env) {
  const res = await fetch(AT_WEBHOOK_URL(env.AIRTABLE_BASE_ID), {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.webhooks || [];
}

async function createWebhook(env, notificationUrl) {
  const res = await fetch(AT_WEBHOOK_URL(env.AIRTABLE_BASE_ID), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notificationUrl,
      specification: {
        options: {
          filters: {
            dataTypes: ['tableData'],
          },
        },
      },
    }),
  });
  return res.json();
}

async function fetchWebhookPayloads(env, webhookId, cursor) {
  let url = `${AT_WEBHOOK_URL(env.AIRTABLE_BASE_ID)}/${webhookId}/payloads`;
  if (cursor) url += `?cursor=${cursor}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) return { payloads: [], cursor: null };
  return res.json();
}

async function handleWebhookNotification(request, env) {
  const body = await request.json().catch(() => ({}));
  const webhookId = body.webhook?.id;
  if (!webhookId) return new Response('OK', { status: 200 });

  const cursorKey = `webhook_cursor_${webhookId}`;
  let cursor = env.WEBHOOK_KV ? await env.WEBHOOK_KV.get(cursorKey) : null;

  let hasChanges = false;
  const changedTables = new Set();

  let mightHaveMore = true;
  while (mightHaveMore) {
    const result = await fetchWebhookPayloads(env, webhookId, cursor);
    const payloads = result.payloads || [];
    mightHaveMore = result.mightHaveMore || false;
    if (result.cursor) cursor = String(result.cursor);

    for (const p of payloads) {
      hasChanges = true;
      const tableName = p.changedTablesById
        ? Object.keys(p.changedTablesById)
        : [];
      tableName.forEach((t) => changedTables.add(t));
    }
  }

  if (env.WEBHOOK_KV && cursor) {
    await env.WEBHOOK_KV.put(cursorKey, String(cursor));
  }

  if (hasChanges) {
    broadcastSSE({
      type: 'airtable_change',
      tables: [...changedTables],
      timestamp: Date.now(),
    });
  }

  return new Response('OK', { status: 200 });
}

async function handleWebhookSetup(env, origin) {
  try {
    const existing = await listWebhooks(env);
    return new Response(JSON.stringify({
      webhooks: existing,
      instructions: 'Use POST /webhooks/register with { "notificationUrl": "https://your-worker.workers.dev/webhooks/airtable" } to create a webhook.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
}

async function handleWebhookRegister(request, env, origin) {
  try {
    const body = await request.json();
    const notificationUrl = body.notificationUrl;
    if (!notificationUrl) {
      return new Response(JSON.stringify({ error: 'notificationUrl required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
    const result = await createWebhook(env, notificationUrl);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
}

// ── Main fetch handler ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);

    // Clerk webhook
    if (url.pathname === '/webhooks/clerk' && request.method === 'POST') {
      return handleClerkWebhook(request, env);
    }

    // Airtable webhook notification receiver
    if (url.pathname === '/webhooks/airtable' && request.method === 'POST') {
      return handleWebhookNotification(request, env);
    }

    // Webhook management endpoints
    if (url.pathname === '/webhooks/setup' && request.method === 'GET') {
      return handleWebhookSetup(env, origin);
    }
    if (url.pathname === '/webhooks/register' && request.method === 'POST') {
      return handleWebhookRegister(request, env, origin);
    }

    // SSE endpoint for real-time change notifications
    if (url.pathname === '/events') {
      return handleSSE(request, origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

    if (!parts.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const tableName = decodeURIComponent(parts[0]);
    const recordId  = parts[1] ? decodeURIComponent(parts[1]) : null;

    let airtableUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
    if (recordId) airtableUrl += `/${recordId}`;

    if (request.method === 'GET') {
      const qs = url.searchParams.toString();
      if (qs) airtableUrl += `?${qs}`;
    }

    const hasBody = ['POST', 'PATCH', 'PUT'].includes(request.method);

    const res  = await fetch(airtableUrl, {
      method: request.method,
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: hasBody ? request.body : undefined,
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
