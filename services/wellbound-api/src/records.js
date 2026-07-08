/**
 * records.js — the Airtable wire contract, backed by PostgreSQL.
 *
 * Endpoints (identical shapes to api.airtable.com/v0/{base}):
 *   GET    /:table                  list — filterByFormula, sort[i][field],
 *                                   sort[i][direction], maxRecords, fields[]
 *                                   (offset accepted; we return the full set in
 *                                   one page, so the client's do/while ends)
 *   GET    /:table/:recId           single record
 *   POST   /:table                  create ({ fields } or { records: [...] })
 *   PATCH  /:table/:recId           update
 *   PATCH  /:table                  batch update ({ records: [{ id, fields }] })
 *   DELETE /:table/:recId           delete → { deleted: true, id }
 *
 * Record shape: { id: rec_id, createdTime, fields } with Airtable semantics —
 * null/empty fields omitted, false checkboxes omitted, link fields as
 * 1-element arrays, jsonb-stringified fields returned as strings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';
import { compileFormula, FormulaError } from './formula.js';

// registry.json is copied into the bundle root by the build script
// (source of truth: careStream/db/registry.json, generated from the schema).
const REGISTRY = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'registry.json'), 'utf8',
));

class ApiError extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

function tableDef(tableName) {
  const def = REGISTRY[tableName];
  if (!def) throw new ApiError(404, 'TABLE_NOT_FOUND', `Could not find table ${tableName}`);
  // Attach the registry so the formula compiler can resolve link targets.
  return { ...def, registry: REGISTRY };
}

// Normalize Postgres timestamp text to a reliably-parseable ISO form.
// Data API JSON emits 'YYYY-MM-DD HH:MM:SS' (no zone, session TZ = UTC);
// native pg emits 'YYYY-MM-DD HH:MM:SS.mmm+00'. Handle both explicitly —
// V8's Date parser is unreliable for space-separated/short-offset forms.
function parsePgTimestamp(v) {
  if (typeof v === 'string') {
    let s = v.trim().replace(' ', 'T');
    if (/[+-]\d\d$/.test(s)) s += ':00';               // '+00' → '+00:00'
    else if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z'; // no zone → UTC
    return new Date(s);
  }
  return new Date(v);
}

// ── Row → Airtable record ─────────────────────────────────────────────────────
function rowToRecord(row, def, projection = null) {
  const fields = {};
  for (const [airtableName, f] of Object.entries(def.fields)) {
    if (projection && !projection.has(airtableName)) continue;
    let v = row[f.column];
    if (v === null || v === undefined) continue;
    switch (f.wire) {
      case 'checkbox':
        if (v !== true) continue; // Airtable omits unchecked boxes
        fields[airtableName] = true;
        break;
      case 'jsonString':
        fields[airtableName] = typeof v === 'string' ? v : JSON.stringify(v);
        break;
      case 'jsonRaw':
        fields[airtableName] = typeof v === 'string' ? JSON.parse(v) : v;
        break;
      case 'linkArray':
        fields[airtableName] = [v];
        break;
      case 'textArray':
        if (Array.isArray(v)) { if (v.length) fields[airtableName] = v; }
        else if (typeof v === 'string') {
          try { const arr = JSON.parse(v); if (Array.isArray(arr) && arr.length) fields[airtableName] = arr; }
          catch { if (v) fields[airtableName] = [v]; }
        }
        break;
      case 'timestamp':
        fields[airtableName] = parsePgTimestamp(v).toISOString();
        break;
      case 'date':
        fields[airtableName] = typeof v === 'string' ? v.slice(0, 10) : v;
        break;
      case 'int':
      case 'float':
        fields[airtableName] = typeof v === 'string' ? Number(v) : v;
        break;
      default:
        if (typeof v === 'string' && v === '') continue; // Airtable omits empty strings
        fields[airtableName] = v;
    }
  }
  return {
    id: row.rec_id,
    createdTime: row.created_at ? parsePgTimestamp(row.created_at).toISOString() : new Date(0).toISOString(),
    fields,
  };
}

// ── Airtable fields → SQL column assignments ─────────────────────────────────
function buildWriteSets(def, fields, params) {
  const sets = [];
  const P = (v) => { params.push(v); return `$${params.length}`; };

  for (const [airtableName, value] of Object.entries(fields || {})) {
    const f = def.fields[airtableName];
    if (!f) throw new ApiError(422, 'UNKNOWN_FIELD_NAME', `Unknown field name: "${airtableName}"`);
    const colRef = `"${f.column}"`;
    if (value === null || value === undefined) {
      sets.push({ col: colRef, expr: 'NULL' });
      continue;
    }
    switch (f.wire) {
      case 'checkbox':
        sets.push({ col: colRef, expr: value === true || value === 'true' ? 'TRUE' : 'FALSE' });
        break;
      case 'jsonString': {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        sets.push({ col: colRef, expr: `${P(str)}::jsonb` });
        break;
      }
      case 'jsonRaw':
        sets.push({ col: colRef, expr: `${P(JSON.stringify(value))}::jsonb` });
        break;
      case 'linkArray': {
        const first = Array.isArray(value) ? value[0] : value;
        sets.push({ col: colRef, expr: first ? P(String(first)) : 'NULL' });
        break;
      }
      case 'textArray': {
        const arr = Array.isArray(value) ? value : [value];
        sets.push({ col: colRef, expr: `(SELECT coalesce(array_agg(x), '{}') FROM jsonb_array_elements_text(${P(JSON.stringify(arr))}::jsonb) AS t(x))` });
        break;
      }
      case 'timestamp':
        sets.push({ col: colRef, expr: `${P(String(value))}::timestamptz` });
        break;
      case 'date':
        sets.push({ col: colRef, expr: `${P(String(value).slice(0, 10))}::date` });
        break;
      case 'int':
        sets.push({ col: colRef, expr: `${P(String(value))}::bigint` });
        break;
      case 'float':
        sets.push({ col: colRef, expr: `${P(String(value))}::double precision` });
        break;
      default:
        sets.push({ col: colRef, expr: P(String(value)) });
    }
  }
  return sets;
}

// ── Query-string helpers ──────────────────────────────────────────────────────
function parseSort(qs, def) {
  const clauses = [];
  for (let i = 0; ; i++) {
    const field = qs[`sort[${i}][field]`];
    if (!field) break;
    const f = def.fields[field];
    if (!f) throw new ApiError(422, 'UNKNOWN_FIELD_NAME', `Unknown sort field: "${field}"`);
    const dir = (qs[`sort[${i}][direction]`] || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    clauses.push(`"${f.column}" ${dir} NULLS LAST`);
  }
  return clauses;
}

function parseProjection(qs, def) {
  const names = [];
  for (let i = 0; qs[`fields[${i}]`] !== undefined; i++) names.push(qs[`fields[${i}]`]);
  if (!names.length) return null;
  for (const n of names) {
    if (!def.fields[n]) throw new ApiError(422, 'UNKNOWN_FIELD_NAME', `Unknown field: "${n}"`);
  }
  return new Set(names);
}

/**
 * Batched hydrate (Phase 8): fetch many whole tables in ONE round trip.
 * Body: { tables: ["Patients", "Referrals", …] }
 * Response: { tables: { Patients: { records: [...] }, … } }
 * Cuts app boot from ~35 sequential-ish requests to 1.
 */
export async function hydrateTables(tableNames) {
  if (!Array.isArray(tableNames) || !tableNames.length) {
    throw new ApiError(422, 'INVALID_REQUEST', 'Body must be { tables: [...] }');
  }
  const out = {};
  await Promise.all(tableNames.map(async (name) => {
    out[name] = await listRecords(name, {});
  }));
  return { tables: out };
}

/** Airtable Metadata-API-shaped table list (Support's listTablesAndColumns). */
export function metaTables() {
  return {
    tables: Object.entries(REGISTRY).map(([name, def]) => ({
      id: def.pgTable,
      name,
      fields: Object.entries(def.fields).map(([fname, f]) => ({
        id: f.column, name: fname, type: f.wire,
      })),
    })),
  };
}

// ── Hot-table micro-cache ─────────────────────────────────────────────────────
// Reference tables that everyone reads constantly and nobody edits often.
// Unfiltered list results are cached in container memory for 30s; any write
// to the table clears this container's copy immediately, and other containers
// age out within the TTL. Turns the hottest reads into ~1ms.
const HOT_TABLES = new Set([
  'Roles', 'Permissions', 'RolePermissions', 'PermissionPresets',
  'Departments', 'DepartmentScopes', 'ConflictCategories',
  'Teams', 'Categories', 'Entities', 'NetworkFacilities',
]);
const HOT_TTL_MS = 30_000;
const hotCache = new Map(); // key -> { at, result }

function hotCacheKey(tableName, qs) {
  // Only cache simple full-table reads (no formula) — the common shape.
  if (!HOT_TABLES.has(tableName) || qs.filterByFormula) return null;
  return `${tableName}|${qs.maxRecords || ''}|${qs['sort[0][field]'] || ''}|${qs['sort[0][direction]'] || ''}`;
}

export function invalidateHotCache(tableName) {
  for (const k of hotCache.keys()) {
    if (k.startsWith(`${tableName}|`)) hotCache.delete(k);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────
export async function listRecords(tableName, qs) {
  const hotKey = hotCacheKey(tableName, qs);
  if (hotKey) {
    const hit = hotCache.get(hotKey);
    if (hit && Date.now() - hit.at < HOT_TTL_MS) return hit.result;
  }
  const def = tableDef(tableName);
  const params = [];
  let where = '';
  if (qs.filterByFormula) {
    try {
      const compiled = compileFormula(qs.filterByFormula, def);
      where = ` WHERE ${compiled.sql}`;
      params.push(...compiled.params);
    } catch (err) {
      if (err instanceof FormulaError) {
        throw new ApiError(422, 'INVALID_FILTER_BY_FORMULA', `Cannot translate formula: ${err.message}`);
      }
      throw err;
    }
  }
  const sort = parseSort(qs, def);
  const orderBy = sort.length ? ` ORDER BY ${sort.join(', ')}` : ' ORDER BY "created_at" ASC NULLS LAST, "rec_id" ASC';
  const limit = qs.maxRecords ? ` LIMIT ${Math.max(0, parseInt(qs.maxRecords, 10) || 0)}` : '';
  const projection = parseProjection(qs, def);

  const { rows } = await query(`SELECT * FROM "${def.pgTable}"${where}${orderBy}${limit}`, params);
  const result = { records: rows.map((r) => rowToRecord(r, def, projection)) };
  if (hotKey) hotCache.set(hotKey, { at: Date.now(), result });
  return result;
}

export async function getRecord(tableName, recId) {
  const def = tableDef(tableName);
  const { rows } = await query(`SELECT * FROM "${def.pgTable}" WHERE rec_id = $1`, [recId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', `Record not found: ${recId}`);
  return rowToRecord(rows[0], def);
}

async function createOne(def, fields) {
  const params = [];
  const sets = buildWriteSets(def, fields, params);
  const cols = sets.map((s) => s.col);
  const exprs = sets.map((s) => s.expr);
  const sql = cols.length
    ? `INSERT INTO "${def.pgTable}" (${cols.join(', ')}) VALUES (${exprs.join(', ')}) RETURNING *`
    : `INSERT INTO "${def.pgTable}" DEFAULT VALUES RETURNING *`;
  const { rows } = await query(sql, params);
  return rowToRecord(rows[0], def);
}

export async function createRecords(tableName, body) {
  const def = tableDef(tableName);
  if (Array.isArray(body?.records)) {
    const out = [];
    for (const r of body.records) out.push(await createOne(def, r.fields || {}));
    return { records: out };
  }
  return createOne(def, body?.fields || {});
}

async function updateOne(def, recId, fields) {
  const params = [];
  const sets = buildWriteSets(def, fields, params);
  if (!sets.length) return getRecordByDef(def, recId);
  params.push(recId);
  const assignments = sets.map((s) => `${s.col} = ${s.expr}`).join(', ');
  const { rows } = await query(
    `UPDATE "${def.pgTable}" SET ${assignments} WHERE rec_id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', `Record not found: ${recId}`);
  return rowToRecord(rows[0], def);
}

async function getRecordByDef(def, recId) {
  const { rows } = await query(`SELECT * FROM "${def.pgTable}" WHERE rec_id = $1`, [recId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', `Record not found: ${recId}`);
  return rowToRecord(rows[0], def);
}

export async function updateRecords(tableName, recId, body) {
  const def = tableDef(tableName);
  if (recId) return updateOne(def, recId, body?.fields || {});
  if (Array.isArray(body?.records)) {
    const out = [];
    for (const r of body.records) out.push(await updateOne(def, r.id, r.fields || {}));
    return { records: out };
  }
  throw new ApiError(422, 'INVALID_REQUEST', 'PATCH requires a record id or { records: [...] }');
}

export async function deleteRecord(tableName, recId) {
  const def = tableDef(tableName);
  const { numberOfRecordsUpdated } = await query(
    `DELETE FROM "${def.pgTable}" WHERE rec_id = $1`, [recId],
  );
  if (!numberOfRecordsUpdated) throw new ApiError(404, 'NOT_FOUND', `Record not found: ${recId}`);
  return { deleted: true, id: recId };
}

export { ApiError };
