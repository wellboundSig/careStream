/**
 * handler.js — Lambda entry for wellbound-api (Airtable-compatible data API).
 *
 * Deployed behind an API Gateway HTTP API with TWO route classes:
 *   1. `ANY /{proxy+}`  — JWT authorizer (Clerk OIDC issuer). Claims arrive in
 *      event.requestContext.authorizer.jwt.claims. This is the browser path.
 *   2. `ANY /internal/{proxy+}` — no JWT authorizer; guarded here by
 *      x-internal-key (env INTERNAL_API_KEY). Used by the Clerk-webhook worker
 *      and the field-support worker (no Clerk session). Same handlers.
 *
 * Every request is access-logged to api_access_log (HIPAA access accounting).
 * Failures to log never fail the request (logged to CloudWatch instead).
 */

import { query } from './db.js';
import { authenticate } from './clerkJwt.js';
import { listRecords, getRecord, createRecords, updateRecords, deleteRecord, metaTables, hydrateTables, ApiError } from './records.js';

const ALLOWED_ORIGINS = new Set([
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'https://field-support.wellboundcarestream.com',
  'http://localhost:5173',
  'http://localhost:5174',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://wellboundcarestream.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    body: JSON.stringify(body),
  };
}

async function logAccess({ actorSub, actorUserId, method, table, rowRecId, rowCount, querySummary, status }) {
  try {
    await query(
      `INSERT INTO api_access_log (actor_sub, actor_user_id, method, table_name, row_rec_id, row_count, query_summary, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorSub || null, actorUserId || null, method, table, rowRecId || null,
       rowCount ?? null, querySummary ? String(querySummary).slice(0, 500) : null, status],
    );
  } catch (err) {
    console.error('[access-log] write failed:', err.message);
  }
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const method = event.requestContext?.http?.method || 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }

  // ── Resolve caller identity ────────────────────────────────────────────────
  // Clerk session tokens carry no `aud` claim by default, so verification runs
  // in-Lambda (clerkJwt.js) rather than relying on an APIGW JWT authorizer.
  let rawPath = event.rawPath || '/';
  let actorSub = null;

  if (rawPath.startsWith('/internal/')) {
    const key = event.headers?.['x-internal-key'] || event.headers?.['X-Internal-Key'];
    if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
      return json(401, { error: { type: 'UNAUTHORIZED', message: 'Invalid internal key' } }, origin);
    }
    actorSub = `internal:${event.headers?.['x-internal-caller'] || 'unknown'}`;
    rawPath = rawPath.slice('/internal'.length);
  } else {
    const claims = await authenticate(event);
    if (!claims) {
      return json(401, { error: { type: 'UNAUTHORIZED', message: 'Missing or invalid token' } }, origin);
    }
    actorSub = claims.sub;
  }

  // Metadata shim (Support's listTablesAndColumns expects /meta/tables).
  if (rawPath === '/meta/tables' && method === 'GET') {
    return json(200, metaTables(), origin);
  }

  // Batched hydrate (Phase 8): whole app boot in one round trip.
  if (rawPath === '/hydrate' && method === 'POST') {
    let hydrateBody = null;
    try { hydrateBody = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
    catch { return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin); }
    try {
      const result = await hydrateTables(hydrateBody?.tables);
      await logAccess({
        actorSub, method, table: '(hydrate)', rowCount: hydrateBody?.tables?.length, status: 200,
      });
      return json(200, result, origin);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error('[wellbound-api hydrate]', err);
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin);
    }
  }

  // Strip optional stage prefix and split /{table}[/{recId}]
  const parts = rawPath.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) {
    return json(404, { error: { type: 'NOT_FOUND', message: 'Specify a table' } }, origin);
  }
  const [tableName, recId] = parts;
  const qs = event.queryStringParameters || {};
  let body = null;
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
    catch { return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin); }
  }

  let status = 200;
  let result;
  try {
    if (method === 'GET' && !recId) {
      result = await listRecords(tableName, qs);
    } else if (method === 'GET') {
      result = await getRecord(tableName, recId);
    } else if (method === 'POST') {
      result = await createRecords(tableName, body);
    } else if (method === 'PATCH') {
      result = await updateRecords(tableName, recId || null, body);
    } else if (method === 'DELETE' && recId) {
      result = await deleteRecord(tableName, recId);
    } else {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Unsupported ${method}`);
    }
  } catch (err) {
    status = err instanceof ApiError ? err.status : 500;
    const type = err instanceof ApiError ? err.type : 'SERVER_ERROR';
    if (status === 500) console.error('[wellbound-api]', err);
    await logAccess({
      actorSub, method, table: tableName, rowRecId: recId,
      querySummary: qs.filterByFormula, status,
    });
    return json(status, { error: { type, message: err.message } }, origin);
  }

  await logAccess({
    actorSub, method, table: tableName, rowRecId: recId,
    rowCount: result?.records?.length ?? (result?.id ? 1 : null),
    querySummary: qs.filterByFormula, status,
  });
  return json(status, result, origin);
}
