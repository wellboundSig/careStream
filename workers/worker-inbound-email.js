/**
 * worker-inbound-email
 *
 * Receives Resend `email.received` webhooks for referral@wellboundcarestream.com,
 * fetches full body + attachments via the Receiving API, and creates
 * InboundSubmissions rows in wellbound-api (Aurora).
 *
 * Secrets / vars (Cloudflare Worker):
 *   RESEND_API_KEY           — Resend API key
 *   RESEND_WEBHOOK_SECRET    — Svix signing secret from the Resend webhook
 *   API_URL                  — wellbound-api base (e.g. https://….amazonaws.com)
 *   INTERNAL_API_KEY         — x-internal-key for /internal routes
 *   FILES_API_URL            — optional files-api base for attachment upload
 *   INBOUND_TO_ADDRESS       — default referral@wellboundcarestream.com
 */

const TARGET_DEFAULT = 'referral@wellboundcarestream.com';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'inbound-email' });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const rawBody = await request.text();
    try {
      await verifyResendSignature(request, rawBody, env.RESEND_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[inbound] signature verify failed', err.message);
      return json({ error: 'invalid_signature' }, 401);
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    if (event.type !== 'email.received') {
      return json({ ok: true, ignored: event.type });
    }

    const data = event.data || {};
    const target = (env.INBOUND_TO_ADDRESS || TARGET_DEFAULT).toLowerCase();
    const recipients = [
      ...(data.to || []),
      ...(data.received_for || []),
      ...(data.cc || []),
    ].map((a) => String(a).toLowerCase());

    if (!recipients.some((a) => a.includes(target))) {
      return json({ ok: true, ignored: 'wrong_recipient', recipients });
    }

    if (!env.API_URL || !env.INTERNAL_API_KEY || !env.RESEND_API_KEY) {
      console.error('[inbound] missing API_URL / INTERNAL_API_KEY / RESEND_API_KEY');
      return json({ error: 'misconfigured' }, 500);
    }

    try {
      const result = await processReceivedEmail(env, data);
      return json({ ok: true, ...result });
    } catch (err) {
      console.error('[inbound] process failed', err);
      return json({ error: err.message || 'process_failed' }, 500);
    }
  },
};

async function processReceivedEmail(env, data) {
  const emailId = data.email_id;
  const messageId = data.message_id || null;

  // Dedupe by provider_email_id or message_id
  const existing = await findExisting(env, emailId, messageId);
  if (existing) {
    return { deduped: true, id: existing.fields?.id || existing.id };
  }

  const full = await resendGet(`emails/receiving/${emailId}`, env.RESEND_API_KEY);
  const fromHeader = full.headers?.from || data.from || '';
  const { name: fromName, email: fromEmail } = parseFrom(fromHeader, data.from);

  const bodyText = full.text || stripHtml(full.html || '');
  const bodyHtml = full.html || '';
  const subject = data.subject || full.subject || '(no subject)';

  const parsed = parseInboundEmailLite({
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    from_name: fromName,
    from_email: fromEmail,
  });

  const now = new Date().toISOString();
  const id = `inb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nextNum = await nextSubmissionNumber(env);

  const fields = {
    id,
    submission_number: nextNum,
    from_email: fromEmail,
    from_name: fromName,
    to_addrs: JSON.stringify(data.to || full.to || []),
    cc_addrs: JSON.stringify(data.cc || full.cc || []),
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    message_id: messageId || undefined,
    received_at: data.created_at || full.created_at || now,
    provider: 'resend',
    provider_email_id: emailId,
    raw_headers: full.headers || undefined,
    status: 'new',
    source: 'email',
    parsed,
    created_at: now,
    updated_at: now,
  };

  const rec = await apiCreate(env, 'InboundSubmissions', fields);

  await apiCreate(env, 'InboundSubmissionEvents', {
    id: `inev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    inbound_submission_id: id,
    actor_id: '',
    action: 'received',
    detail: `Resend inbound ${emailId}`,
    created_at: now,
  }).catch((e) => console.warn('[inbound] event log failed', e.message));

  // Attachments (best-effort)
  const atts = full.attachments || data.attachments || [];
  for (const att of atts) {
    try {
      await storeAttachment(env, id, emailId, att);
    } catch (e) {
      console.warn('[inbound] attachment failed', att.filename, e.message);
    }
  }

  return { id, rec_id: rec.id, submission_number: nextNum };
}

async function storeAttachment(env, submissionId, emailId, att) {
  const attId = att.id;
  const filename = att.filename || `attachment-${attId}`;
  let storageKey = '';
  let size = att.size || 0;

  if (env.FILES_API_URL && env.INTERNAL_API_KEY && attId) {
    // Download from Resend attachments API when available
    try {
      const meta = await resendGet(`emails/receiving/${emailId}/attachments/${attId}`, env.RESEND_API_KEY);
      const downloadUrl = meta.download_url || meta.url;
      if (downloadUrl) {
        const bin = await fetch(downloadUrl);
        const buf = await bin.arrayBuffer();
        size = buf.byteLength;
        const putUrl = `${env.FILES_API_URL.replace(/\/$/, '')}/upload-tickets/${encodeURIComponent(submissionId)}/${encodeURIComponent(filename)}`;
        const put = await fetch(putUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': att.content_type || 'application/octet-stream',
            'x-internal-key': env.INTERNAL_API_KEY,
          },
          body: buf,
        });
        if (put.ok) {
          const info = await put.json().catch(() => ({}));
          storageKey = info.key || `Tickets/${submissionId}/${filename}`;
        }
      }
    } catch (e) {
      console.warn('[inbound] attach download/upload', e.message);
    }
  }

  const now = new Date().toISOString();
  await apiCreate(env, 'InboundSubmissionAttachments', {
    id: `inat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    inbound_submission_id: submissionId,
    file_name: filename,
    content_type: att.content_type || '',
    size_bytes: size,
    storage_key: storageKey,
    provider_attachment_id: attId || '',
    uploaded_at: now,
    created_at: now,
  });
}

async function findExisting(env, providerEmailId, messageId) {
  const formula = providerEmailId
    ? `{provider_email_id} = '${esc(providerEmailId)}'`
    : (messageId ? `{message_id} = '${esc(messageId)}'` : null);
  if (!formula) return null;
  const url = `${env.API_URL.replace(/\/$/, '')}/internal/${encodeURIComponent('InboundSubmissions')}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const res = await fetch(url, { headers: { 'x-internal-key': env.INTERNAL_API_KEY } });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.records || [])[0] || null;
}

async function nextSubmissionNumber(env) {
  const url = `${env.API_URL.replace(/\/$/, '')}/internal/${encodeURIComponent('InboundSubmissions')}?sort%5B0%5D%5Bfield%5D=submission_number&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`;
  const res = await fetch(url, { headers: { 'x-internal-key': env.INTERNAL_API_KEY } });
  if (!res.ok) return 1;
  const data = await res.json();
  const top = (data.records || [])[0];
  const n = top?.fields?.submission_number;
  return Number.isFinite(n) ? n + 1 : 1;
}

async function apiCreate(env, table, fields) {
  const url = `${env.API_URL.replace(/\/$/, '')}/internal/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': env.INTERNAL_API_KEY,
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API create ${table} failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  // Airtable wire: { records: [{ id, fields }] } or single
  return data.records?.[0] || data;
}

async function resendGet(path, apiKey) {
  const res = await fetch(`https://api.resend.com/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend GET ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Svix-compatible verification used by Resend webhooks. */
async function verifyResendSignature(request, rawBody, secret) {
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET not set');
  const svixId = request.headers.get('svix-id');
  const svixTs = request.headers.get('svix-timestamp');
  const svixSig = request.headers.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) throw new Error('missing svix headers');

  const signed = `${svixId}.${svixTs}.${rawBody}`;
  const keyData = secret.startsWith('whsec_')
    ? base64ToBytes(secret.slice(6))
    : new TextEncoder().encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signed));
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  const candidates = svixSig.split(' ').map((p) => p.replace(/^v1,/, '').trim());
  if (!candidates.some((c) => timingSafeEqual(c, expected))) {
    throw new Error('signature mismatch');
  }
}

function parseFrom(header, fallbackEmail) {
  const h = String(header || '');
  const m = h.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  if (h.includes('@')) return { name: '', email: h.trim() };
  return { name: h.trim(), email: String(fallbackEmail || '').trim() };
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(v) {
  return String(v).replace(/'/g, "\\'");
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, svix-id, svix-timestamp, svix-signature',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};

/** Lightweight copy of client parser for the worker isolate (no imports). */
function parseInboundEmailLite(email = {}) {
  const subject = email.subject || '';
  const text = email.body_text || stripHtml(email.body_html) || '';
  const hay = `${subject}\n${text}`;
  const out = {
    patient_name: null, patient_first: null, patient_last: null,
    dob: null, phone: null, mrn: null, insurance: null, facility: null,
    referrer_name: (email.from_name || '').trim() || null,
    referrer_email: (email.from_email || '').trim() || null,
    confidence: {},
  };
  const labeled = [
    ['patient_name', /(?:^|\n)\s*(?:patient(?:\s*name)?|pt\.?|name)\s*[:\-]\s*(.+)$/im],
    ['dob', /(?:^|\n)\s*(?:d\.?o\.?b\.?|date\s*of\s*birth)\s*[:\-]\s*(.+)$/im],
    ['phone', /(?:^|\n)\s*(?:phone|tel|mobile|cell)\s*[:\-]\s*(.+)$/im],
    ['mrn', /(?:^|\n)\s*(?:mrn|medical\s*record)\s*[:\-]\s*(.+)$/im],
    ['insurance', /(?:^|\n)\s*(?:insurance|payer|plan)\s*[:\-]\s*(.+)$/im],
    ['facility', /(?:^|\n)\s*(?:facility|hospital|snf|alf)\s*[:\-]\s*(.+)$/im],
  ];
  for (const [field, re] of labeled) {
    const m = hay.match(re);
    if (m) {
      out[field] = m[1].replace(/\s+/g, ' ').trim();
      out.confidence[field] = 'high';
    }
  }
  if (out.patient_name) {
    const lf = out.patient_name.match(/^([^,]+),\s*(.+)$/);
    if (lf) {
      out.patient_last = lf[1].trim();
      out.patient_first = lf[2].trim();
    } else {
      const parts = out.patient_name.split(/\s+/);
      out.patient_first = parts[0] || null;
      out.patient_last = parts.slice(1).join(' ') || null;
    }
    out.confidence.patient_first = out.confidence.patient_name;
    out.confidence.patient_last = out.confidence.patient_name;
  }
  if (!out.phone) {
    const m = hay.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
    if (m) { out.phone = m[0]; out.confidence.phone = 'medium'; }
  }
  if (!out.dob) {
    const m = hay.match(/\b((?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2})\b/);
    if (m) { out.dob = m[1]; out.confidence.dob = 'medium'; }
  }
  return out;
}
