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

/**
 * Support-portal tables (support.wellboundcarestream.com / field-support).
 *
 * The support desk is a SEPARATE product from CareStream and is meant for EVERY
 * Wellbound staff member — including people who have no CareStream role (rol_016
 * "Unassigned") or whose Users row hasn't synced yet. None of these tables hold
 * CareStream PHI, so they are exempt from the "locked user → empty read / no
 * write" lockdown that protects the clinical tables.
 *
 * Effect: locked-but-NOT-revoked users get normal read+write on these tables.
 * Revoked users stay fully blocked. CareStream PHI tables are untouched.
 */
export const SUPPORT_TABLES = new Set([
  'Teams',
  'Categories',
  'Tickets',
  'TicketParticipants',
  'TicketAssignments',
  'Posts',
  'Attachments',
  'EmailLog',
  'NetworkFacilities',
  'Clinicians',
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

/** Signed JWT email, or a localhost hint when the test Clerk token has no email. */
export function extractEmail(claims = {}, hintEmail = '') {
  const fromClaims = [
    claims.email,
    claims.primary_email_address,
    claims.email_address,
    claims.primaryEmailAddress,
    Array.isArray(claims.emails) ? claims.emails[0] : null,
  ];
  for (const v of fromClaims) {
    const email = normalizeEmail(v);
    if (email) return email;
  }
  const iss = String(claims.iss || '');
  if (iss.includes(DEV_CLERK_ISSUER_HINT)) return normalizeEmail(hintEmail);
  return '';
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function parsePermissionKeys(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'object') return [];
  try {
    let v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { /* keep string */ }
    }
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function cacheKey(actorSub, claims, hintEmail) {
  return `${actorSub || ''}|${extractEmail(claims, hintEmail)}`;
}

/**
 * @param {string} actorSub
 * @param {object} [claims] - verified JWT payload (iss, email, …)
 * @param {{ hintEmail?: string }} [extras] - unsigned email, used only for *.clerk.accounts.dev
 */
export async function resolveCaller(actorSub, claims = {}, extras = {}) {
  if (!actorSub) return { kind: 'anonymous' };
  if (actorSub.startsWith('internal:')) return { kind: 'internal', actorSub };

  const hintEmail = extras.hintEmail || '';
  const key = cacheKey(actorSub, claims, hintEmail);
  const cached = callerCache.get(key);
  if (cached && Date.now() - cached.at < CALLER_TTL_MS) return cached.value;

  const value = await lookupCaller(actorSub, claims || {}, hintEmail);
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

async function lookupCaller(actorSub, claims, hintEmail = '') {
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
    // Local session JWTs often have no email claim; the SPA sends X-User-Email
    // for that issuer only (see extractEmail).
    if (!row) {
      const email = extractEmail(claims, hintEmail);
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

export function assertCanWrite(caller, tableName = null) {
  if (!caller || caller.kind === 'internal') return;
  if (caller.revoked) throw new AccessDeniedError('Account revoked');
  // Support-desk tables are open to any authenticated (non-revoked) user, even
  // if they have no CareStream role — the support portal serves all staff.
  if (tableName && SUPPORT_TABLES.has(tableName)) return;
  if (caller.locked) throw new AccessDeniedError('Account pending setup — contact your manager');
}

/**
 * Feature-key check against user_permissions.permissions (JSON array).
 * Internal callers pass. Missing userId / missing row / missing key → 403.
 * Used for deny-by-default tools (e.g. Optum Auto Check) that must not be
 * reachable via the API without an explicit grant.
 */
export async function assertHasPermission(caller, permissionKey) {
  return assertHasAnyPermission(caller, [permissionKey]);
}

export async function assertHasAnyPermission(caller, permissionKeys) {
  const keysWanted = (Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys])
    .map(String)
    .filter(Boolean);
  const label = keysWanted[0] || 'unknown';
  if (!caller || caller.kind === 'internal') return;
  assertCanWrite(caller);
  if (!caller.userId) {
    throw new AccessDeniedError(
      `Could not match your login to a CareStream user (needed ${label})`,
    );
  }
  try {
    const { rows } = await query(
      `SELECT permissions::text AS permissions
         FROM user_permissions
        WHERE user_id = $1
        LIMIT 1`,
      [caller.userId],
    );
    const keys = parsePermissionKeys(rows?.[0]?.permissions);
    if (!keysWanted.some((k) => keys.includes(k))) {
      throw new AccessDeniedError(`Missing permission: ${label}`);
    }
  } catch (err) {
    if (err instanceof AccessDeniedError) throw err;
    console.error('[accessControl] permission lookup failed:', err.message);
    throw new AccessDeniedError(`Missing permission: ${label}`);
  }
}

export function filterReadResult(caller, tableName, result) {
  if (!caller || caller.kind === 'internal' || !caller.locked) return result;
  if (caller.revoked) throw new AccessDeniedError('Account revoked');
  // Support-desk tables (non-PHI) are readable by all authenticated users so the
  // support portal works for staff with no CareStream role.
  if (SUPPORT_TABLES.has(tableName)) return result;
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
