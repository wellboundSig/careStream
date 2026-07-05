#!/usr/bin/env node
/**
 * export-airtable.js — Phase 5 step 1: dump every Airtable table to NDJSON.
 *
 * Paginates each table at ≤5 requests/second (Airtable's per-base limit,
 * shared with any live app traffic — run during quiet hours or the
 * write-freeze). Output: db/export/{Table}.ndjson, one Airtable record per
 * line ({ id, createdTime, fields }), plus db/export/_manifest.json with
 * per-table counts for the reconciliation gate.
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat… AIRTABLE_BASE_ID=app… node db/export-airtable.js
 *   # or rely on careStream/.env (VITE_-prefixed vars work too)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env fallback (same pattern as scripts/check-invariants.js)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
} catch { /* no .env */ }

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN / AIRTABLE_BASE_ID');
  process.exit(1);
}

const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/registry.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'db/export');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exportTable(tableName) {
  const rows = [];
  let offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429) { await sleep(1500); continue; }
    if (res.status === 404) return null; // table not in this base (e.g. drift-only ConflictCategories pre-apply)
    if (!res.ok) throw new Error(`${tableName}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    rows.push(...data.records);
    offset = data.offset || null;
    await sleep(220); // ≤5 rps with headroom
  } while (offset);
  return rows;
}

const manifest = { exportedAt: new Date().toISOString(), baseId: BASE_ID, tables: {} };

for (const tableName of Object.keys(REGISTRY)) {
  process.stdout.write(`Exporting ${tableName} … `);
  const rows = await exportTable(tableName);
  if (rows === null) { console.log('SKIP (404 — not in base)'); manifest.tables[tableName] = { count: null, skipped: true }; continue; }
  const file = path.join(OUT_DIR, `${tableName}.ndjson`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  manifest.tables[tableName] = { count: rows.length };
  console.log(`${rows.length} rows`);
}

fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nDone. Manifest: db/export/_manifest.json`);
console.log('NOTE: db/export/ contains live data — do NOT commit it (gitignored).');
