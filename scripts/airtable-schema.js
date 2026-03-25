#!/usr/bin/env node
/**
 * Airtable Schema Introspection Script
 *
 * Reads the Airtable base metadata API and writes a JSON snapshot
 * of all tables, fields, and their types to scripts/schema-snapshot.json.
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-schema.js
 *
 * Or it will read from .env in the careStream directory.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* no .env, rely on environment variables */ }
}

loadEnv();

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;

if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID. Set them as env vars or in .env');
  process.exit(1);
}

async function fetchSchema() {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable meta API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`Fetching schema for base ${BASE_ID}...`);
  const data = await fetchSchema();
  const snapshot = {
    baseId: BASE_ID,
    fetchedAt: new Date().toISOString(),
    tables: data.tables.map((t) => ({
      id: t.id,
      name: t.name,
      primaryFieldId: t.primaryFieldId,
      fields: t.fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
      })),
    })),
  };

  const outPath = resolve(__dirname, 'schema-snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Schema snapshot written to ${outPath}`);
  console.log(`Found ${snapshot.tables.length} tables:`);
  for (const t of snapshot.tables) {
    console.log(`  ${t.name} (${t.fields.length} fields)`);
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
