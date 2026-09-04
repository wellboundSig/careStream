/**
 * handler.js — Lambda entry for wellbound-api (Airtable-compatible data API).
 *
 * Deployed behind an API Gateway HTTP API with TWO route classes:
 *   1. `ANY /{proxy+}`  — JWT verified in-Lambda (Clerk OIDC).
 *   2. `ANY /internal/{proxy+}` — guarded by x-internal-key.
 *
 * Access control (additive, production-safe):
 *   - Internal callers unrestricted.
 *   - Revoked / Unassigned users cannot read PHI or write anything.
 *   - Existing staff with real roles keep prior behavior.
 *
 * Rate limits (per warm container, per actor):
 *   - POST /hydrate: 10/min
 *   - other routes: 180/min
 */

import { gzipSync } from 'node:zlib';
import { query } from './db.js';
import { authenticate } from './clerkJwt.js';
import { publishChanges } from './events.js';
import { listRecords, getRecord, createRecords, updateRecords, deleteRecord, metaTables, hydrateTables, invalidateHotCache, ApiError } from './records.js';
import {
  resolveCaller,
  assertCanWrite,
  assertHasAnyPermission,
  filterReadResult,
  filterHydrateResult,
  AccessDeniedError,
  LOCKED_READ_ALLOWLIST,
  SUPPORT_TABLES,
} from './accessControl.js';
import { allowHydrate, allowGeneral } from './rateLimit.js';
import { runOptumEligibilityCheck } from './optumEligibility.js';
import { runAvailityEligibilityCheck } from './availityEligibility.js';
import { runWaystarEligibilityCheck } from './waystarEligibility.js';
import { runSmartEligibilityCheck } from './payerRouting.js';
import { runHchbDupCheck } from './hchbDupCheck.js';
import { runHchbVisitCheck } from './hchbVisitCheck.js';

const ALLOWED_ORIGINS = new Set([
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'https://field-support.wellboundcarestream.com',
  'http://localhost:5173',
  'http://localhost:5174',
]);

const GZIP_MIN_BYTES = 1024;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://wellboundcarestream.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Key, X-User-Email',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin, Accept-Encoding',
  };
}

function acceptsGzip(event) {
  const ae = event?.headers?.['accept-encoding'] || event?.headers?.['Accept-Encoding'] || '';
  return String(ae).toLowerCase().includes('gzip');
}

function json(statusCode, body, origin, event) {
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  if (event && acceptsGzip(event) && Buffer.byteLength(raw, 'utf8') >= GZIP_MIN_BYTES) {
    return {
      statusCode,
      isBase64Encoded: true,
      headers: { ...headers, 'Content-Encoding': 'gzip' },
      body: gzipSync(raw).toString('base64'),
    };
  }
  return { statusCode, headers, body: raw };
}

function logAccess({ actorSub, actorUserId, method, table, rowRecId, rowCount, querySummary, status }) {
  const entry = {
    actorSub: actorSub || null, method, table, rowRecId: rowRecId || null,
    rowCount: rowCount ?? null, status,
    query: querySummary ? String(querySummary).slice(0, 500) : null,
  };
  console.log('[access]', JSON.stringify(entry));
  query(
    `INSERT INTO api_access_log (actor_sub, actor_user_id, method, table_name, row_rec_id, row_count, query_summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.actorSub, actorUserId || null, method, table, entry.rowRecId,
     entry.rowCount, entry.query, status],
  ).catch((err) => console.error('[access-log] db write failed:', err.message));
}

export async function handler(event) {
  if (event?.warmer) return { statusCode: 200, body: 'warm' };

  const origin = event.headers?.origin || event.headers?.Origin || '';
  const method = event.requestContext?.http?.method || 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }

  let rawPath = event.rawPath || '/';
  let actorSub = null;
  let claims = null;

  if (rawPath.startsWith('/internal/')) {
    const key = event.headers?.['x-internal-key'] || event.headers?.['X-Internal-Key'];
    if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
      return json(401, { error: { type: 'UNAUTHORIZED', message: 'Invalid internal key' } }, origin, event);
    }
    actorSub = `internal:${event.headers?.['x-internal-caller'] || 'unknown'}`;
    rawPath = rawPath.slice('/internal'.length);
  } else {
    claims = await authenticate(event);
    if (!claims) {
      return json(401, { error: { type: 'UNAUTHORIZED', message: 'Missing or invalid token' } }, origin, event);
    }
    actorSub = claims.sub;
  }

  // Pass full JWT claims so accessControl can resolve pk_test (localhost)
  // sessions by email / fail-open for the test issuer when clerk_user_id
  // doesn't match the live Users row.
  const hintEmail = event.headers?.['x-user-email'] || event.headers?.['X-User-Email'] || '';
  const caller = await resolveCaller(actorSub, claims || {}, { hintEmail });

  // Rate limits (skip for internal workers — webhooks / scripts).
  if (caller.kind !== 'internal') {
    const ok = rawPath === '/hydrate' && method === 'POST'
      ? allowHydrate(actorSub)
      : allowGeneral(actorSub);
    if (!ok) {
      logAccess({ actorSub, method, table: rawPath, status: 429 });
      return json(429, {
        error: { type: 'RATE_LIMITED', message: 'Too many requests — slow down and retry shortly' },
      }, origin, event);
    }
  }

  if (rawPath === '/meta/tables' && method === 'GET') {
    return json(200, metaTables(), origin, event);
  }

  // Optum real-time eligibility (270/271). Secrets stay on the Lambda.
  // Deny-by-default: clinical.eligibility_optum_auto (explicit grant only).
  if (rawPath === '/eligibility/optum-check' && method === 'POST') {
    try {
      await assertHasAnyPermission(caller, [
        'clinical.eligibility_optum_auto',
        'clinical.eligibility_batch',
      ]);
      let body = null;
      try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : (event.body || '{}'));
      } catch {
        return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event);
      }
      const result = await runOptumEligibilityCheck(body || {});
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(optum-eligibility)',
        status: result.ok ? 200 : 502,
      });
      return json(result.ok ? 200 : 502, result, origin, event);
    } catch (err) {
      const status = err instanceof AccessDeniedError ? err.status : 500;
      if (status === 500) console.error('[wellbound-api optum]', err);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(optum-eligibility)', status,
      });
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin, event);
    }
  }

  // Clearinghouse eligibility (Availity / Waystar / smart-routed). Same
  // deny-by-default gate as Optum — secrets stay on the Lambda.
  const ELIGIBILITY_ROUTES = {
    '/eligibility/availity-check': { runner: runAvailityEligibilityCheck, tag: '(availity-eligibility)' },
    '/eligibility/waystar-check': { runner: runWaystarEligibilityCheck, tag: '(waystar-eligibility)' },
    '/eligibility/check': { runner: runSmartEligibilityCheck, tag: '(smart-eligibility)' },
  };
  if (ELIGIBILITY_ROUTES[rawPath] && method === 'POST') {
    const { runner, tag } = ELIGIBILITY_ROUTES[rawPath];
    try {
      await assertHasAnyPermission(caller, [
        'clinical.eligibility_optum_auto',
        'clinical.eligibility_batch',
      ]);
      let body = null;
      try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : (event.body || '{}'));
      } catch {
        return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event);
      }
      const result = await runner(body || {});
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: tag,
        status: result.ok ? 200 : 502,
      });
      return json(result.ok ? 200 : 502, result, origin, event);
    } catch (err) {
      const status = err instanceof AccessDeniedError ? err.status : 500;
      if (status === 500) console.error(`[wellbound-api ${tag}]`, err);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: tag, status,
      });
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin, event);
    }
  }

  // HCHB logship duplicate check (hashed → on-prem agent → flags + episode facts).
  // Any authenticated writer can use it (lead / intake / marketer flows).
  if (rawPath === '/hchb-dup/check' && method === 'POST') {
    try {
      assertCanWrite(caller);
      let body = null;
      try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : (event.body || '{}'));
      } catch {
        return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event);
      }
      const result = await runHchbDupCheck(body || {});
      const status = result.ok ? 200 : (result.configured === false ? 503 : 502);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(hchb-dup)',
        status,
      });
      return json(status, result, origin, event);
    } catch (err) {
      const status = err instanceof AccessDeniedError ? err.status : 500;
      if (status === 500) console.error('[wellbound-api hchb-dup]', err);
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin, event);
    }
  }

  // HCHB logship SOC/ROC visit check (hashed scheduled visits → on-prem agent).
  if (rawPath === '/hchb-visit/check' && method === 'POST') {
    try {
      assertCanWrite(caller);
      // Localhost Clerk test keys often have no Users.clerk_user_id match
      // (same fail-open as the rest of the app). Live sessions still need
      // scheduling.soc_complete or module.scheduling.
      if (caller.userId) {
        await assertHasAnyPermission(caller, [
          'scheduling.soc_complete',
          'module.scheduling',
        ]);
      }
      let body = null;
      try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : (event.body || '{}'));
      } catch {
        return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event);
      }
      const result = await runHchbVisitCheck(body || {});
      const status = result.ok ? 200 : (result.configured === false ? 503 : 502);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(hchb-visit)',
        status,
      });
      return json(status, result, origin, event);
    } catch (err) {
      const status = err instanceof AccessDeniedError ? err.status : 500;
      if (status === 500) console.error('[wellbound-api hchb-visit]', err);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(hchb-visit)', status,
      });
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin, event);
    }
  }

  if (rawPath === '/hydrate' && method === 'POST') {
    let hydrateBody = null;
    try { hydrateBody = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
    catch { return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event); }
    try {
      if (caller.revoked) throw new AccessDeniedError('Account revoked');
      const raw = await hydrateTables(hydrateBody?.tables);
      const result = await filterHydrateResult(caller, raw);
      logAccess({
        actorSub, actorUserId: caller.userId, method, table: '(hydrate)',
        rowCount: hydrateBody?.tables?.length, status: 200,
      });
      return json(200, result, origin, event);
    } catch (err) {
      const status = err instanceof AccessDeniedError || err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error('[wellbound-api hydrate]', err);
      return json(status, { error: { type: err.type || 'SERVER_ERROR', message: err.message } }, origin, event);
    }
  }

  const parts = rawPath.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) {
    return json(404, { error: { type: 'NOT_FOUND', message: 'Specify a table' } }, origin, event);
  }
  const [tableName, recId] = parts;
  const qs = event.queryStringParameters || {};
  let body = null;
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
    catch { return json(400, { error: { type: 'INVALID_JSON', message: 'Body is not valid JSON' } }, origin, event); }
  }

  let status = 200;
  let result;
  try {
    if (method === 'GET' && !recId) {
      result = filterReadResult(caller, tableName, await listRecords(tableName, qs));
    } else if (method === 'GET') {
      if (caller.locked && caller.kind !== 'internal'
          && !LOCKED_READ_ALLOWLIST.has(tableName) && !SUPPORT_TABLES.has(tableName)) {
        throw new ApiError(404, 'NOT_FOUND', `Record not found`);
      }
      result = await getRecord(tableName, recId);
      // Self-scope Users / UserPermissions for locked callers.
      if (caller.locked && caller.kind !== 'internal') {
        const filtered = filterReadResult(caller, tableName, { records: [result] });
        if (!filtered.records?.length) throw new ApiError(404, 'NOT_FOUND', 'Record not found');
        result = filtered.records[0];
      }
    } else if (method === 'POST') {
      assertCanWrite(caller, tableName);
      result = await createRecords(tableName, body);
    } else if (method === 'PATCH') {
      assertCanWrite(caller, tableName);
      result = await updateRecords(tableName, recId || null, body);
    } else if (method === 'DELETE' && recId) {
      assertCanWrite(caller, tableName);
      result = await deleteRecord(tableName, recId);
    } else {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Unsupported ${method}`);
    }

    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      invalidateHotCache(tableName);
      const action = method === 'POST' ? 'created' : method === 'PATCH' ? 'updated' : 'deleted';
      const ids = result?.records ? result.records.map((r) => r.id) : [result?.id || recId];
      await publishChanges(ids.map((id) => ({ table: tableName, recId: id, action, actorSub })));
    }
  } catch (err) {
    status = (err instanceof AccessDeniedError || err instanceof ApiError) ? err.status : 500;
    const type = err.type || (err instanceof AccessDeniedError ? 'FORBIDDEN' : 'SERVER_ERROR');
    if (status === 500) console.error('[wellbound-api]', err);
    logAccess({
      actorSub, actorUserId: caller.userId, method, table: tableName, rowRecId: recId,
      querySummary: qs.filterByFormula, status,
    });
    return json(status, { error: { type, message: err.message } }, origin, event);
  }

  logAccess({
    actorSub, actorUserId: caller.userId, method, table: tableName, rowRecId: recId,
    rowCount: result?.records?.length ?? (result?.id ? 1 : null),
    querySummary: qs.filterByFormula, status,
  });
  return json(status, result, origin, event);
}
