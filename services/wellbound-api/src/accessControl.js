/**
 * Server-side access control for wellbound-api.
 *
 * Design (production-safe, additive):
 *  - Internal key callers are unrestricted (workers / scripts).
 *  - Revoked users → 403.
 *  - Unassigned role (rol_016) → can read a small allowlist of shell tables;
 *    PHI / operational tables return empty on read; writes return 403.
 *  - Everyone else (including users with no UserPermissions row) keeps
 *    today's behavior — no sudden lockouts for existing staff.
 *
 * Local dev (pk_test / *.clerk.accounts.dev):
 *  - Clerk production keys cannot run on localhost, so npm run dev uses the
 *    test instance. Those `sub`s often don't match Users.clerk_user_id (live).
 *  - Resolve by email when possible; otherwise fail OPEN for the test issuer
 *    so staff aren't locked out of prod data while developing.
 *  - Live issuer with no Users row stays locked (waiting room / new signup).
 */

import { query } from './db.js';

export const UNASSIGNED_ROLE_ID = 'rol_016';
const DEV_CLERK_ISSUER_HINT = 'clerk.accounts.dev';

/** Tables a locked (Unassigned) user may still read for the waiting-room shell. */
export const LOCKED_READ_ALLOWLIST = new Set([
  'Roles',
  'Users',
  'UserPermissions',
  'PermissionPresets',
  'Departments',
  'Entities',
]);

export class AccessDeniedError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.status = 403;
    this.type = 'FORBIDDEN';
  }
}

const callerCache = new Map(); // key -> { at, value }
const CALLER_TTL_MS = 15_000;

function cacheKey(actorSub, claims) {
  const email = String(claims?.email || claims?.primary_email_address || '').toLowerCase();
  return `${actorSub || ''}|${email}`;
}

/**
 * @param {string} actorSub
 * @param {object} [claims] - verified JWT payload (iss, email, …)
 */
export async function resolveCaller(actorSub, claims = {}) {
  if (!actorSub) return { kind: 'anonymous' };
  if (actorSub.startsWith('internal:')) return { kind: 'internal', actorSub };

  const key = cacheKey(actorSub, claims);
  const cached = callerCache.get(key);
  if (cached && Date.now() - cached.at < CALLER_TTL_MS) return cached.value;

  const value = await lookupCaller(actorSub, claims || {});
  callerCache.set(key, { at: Date.now(), value });
  return value;
}

function rowToCaller(row, { pending = false } = {}) {
  const status = String(row.status || '').trim();
  const roleId = String(row.role_id || '').trim();
  const revoked = status === 'Revoked';
  const locked = revoked || roleId === UNASSIGNED_ROLE_ID;
  return {
    kind: 'user',
    userId: row.id || null,
    roleId,
    status,
    locked,
    pending,
    revoked,
  };
}

async function lookupCaller(actorSub, claims) {
  try {
    const { rows } = await query(
      `SELECT rec_id, id, role_id, status, clerk_user_id, email
         FROM users
        WHERE TRIM(clerk_user_id) = TRIM($1)
        LIMIT 1`,
      [actorSub],
    );
    let row = rows?.[0];

    // Dev Clerk instance vs live Users.clerk_user_id — match staff by email.
    if (!row) {
      const email = String(claims.email || claims.primary_email_address || '').trim().toLowerCase();
      if (email) {
        const byEmail = await query(
          `SELECT rec_id, id, role_id, status, clerk_user_id, email
             FROM users
            WHERE LOWER(TRIM(email)) = $1
              AND COALESCE(TRIM(status), '') <> 'Revoked'
            LIMIT 1`,
          [email],
        );
        row = byEmail.rows?.[0];
        if (row) {
          console.log('[accessControl] resolved via email (dev/live clerk mismatch)', {
            actorSub: String(actorSub).slice(0, 24),
            userId: row.id,
          });
        }
      }
    }

    if (row) return rowToCaller(row);

    const iss = String(claims.iss || '');
    const isDevIssuer = iss.includes(DEV_CLERK_ISSUER_HINT);
    if (isDevIssuer) {
      // Localhost pk_test against prod API — don't empty the whole app.
      console.log('[accessControl] dev issuer, no Users row — fail open', {
        actorSub: String(actorSub).slice(0, 24),
      });
      return {
        kind: 'user', userId: null, roleId: null, status: null,
        locked: false, pending: true, revoked: false,
      };
    }

    // Live issuer, no row yet (webhook race / brand-new signup) → waiting room.
    return {
      kind: 'user', userId: null, roleId: null, status: null,
      locked: true, pending: true, revoked: false,
    };
  } catch (err) {
    console.error('[accessControl] lookup failed:', err.message);
    // Fail OPEN on infra errors so a transient DB blip does not lock out staff.
    return {
      kind: 'user', userId: null, roleId: null, status: null,
      locked: false, pending: true, revoked: false,
    };
  }
}

export function assertCanWrite(caller) {
  if (!caller || caller.kind === 'internal') return;
  if (caller.revoked) throw new AccessDeniedError('Account revoked');
  if (caller.locked) throw new AccessDeniedError('Account pending setup — contact your manager');
}

/**
 * Feature-key check against user_permissions.permissions (JSON array).
 * Internal callers pass. Missing userId / missing row / missing key → 403.
 * Used for deny-by-default tools (e.g. Optum Auto Check) that must not be
 * reachable via the API without an explicit grant.
 */
export async function assertHasPermission(caller, permissionKey) {
  if (!caller || caller.kind === 'internal') return;
  assertCanWrite(caller);
  if (!caller.userId) {
    throw new AccessDeniedError(`Missing permission: ${permissionKey}`);
  }
  try {
    const { rows } = await query(
      `SELECT permissions::text AS permissions
         FROM user_permissions
        WHERE user_id = $1
        LIMIT 1`,
      [caller.userId],
    );
    const raw = rows?.[0]?.permissions;
    let keys = [];
    if (typeof raw === 'string') {
      try { keys = JSON.parse(raw); } catch { keys = []; }
    } else if (Array.isArray(raw)) {
      keys = raw;
    }
    if (!Array.isArray(keys) || !keys.includes(permissionKey)) {
      throw new AccessDeniedError(`Missing permission: ${permissionKey}`);
    }
  } catch (err) {
    if (err instanceof AccessDeniedError) throw err;
    console.error('[accessControl] permission lookup failed:', err.message);
    throw new AccessDeniedError(`Missing permission: ${permissionKey}`);
  }
}

export function filterReadResult(caller, tableName, result) {
  if (!caller || caller.kind === 'internal' || !caller.locked) return result;
  if (caller.revoked) throw new AccessDeniedError('Account revoked');
  if (LOCKED_READ_ALLOWLIST.has(tableName)) {
    if (tableName === 'Users' && caller.userId && result?.records) {
      return {
        ...result,
        records: result.records.filter((r) => (r.fields?.id || r.id) === caller.userId),
      };
    }
    if (tableName === 'UserPermissions' && caller.userId && result?.records) {
      return {
        ...result,
        records: result.records.filter((r) => r.fields?.user_id === caller.userId),
      };
    }
    return result;
  }
  // PHI / operational tables — empty set (keeps client hydrate shape intact).
  return { records: [] };
}

export async function filterHydrateResult(caller, hydrateResult) {
  if (!caller || caller.kind === 'internal' || !caller.locked) return hydrateResult;
  if (caller.revoked) throw new AccessDeniedError('Account revoked');
  const tables = hydrateResult?.tables || {};
  const out = {};
  for (const [name, payload] of Object.entries(tables)) {
    out[name] = filterReadResult(caller, name, payload);
  }
  return { tables: out };
}
