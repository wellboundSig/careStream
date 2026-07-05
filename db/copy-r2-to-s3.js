#!/usr/bin/env node
/**
 * copy-r2-to-s3.js — Phase 6: copy every object referenced by Files.r2_key and
 * Attachments.r2_object_key from R2 (public dev URL) to S3, PRESERVING KEYS.
 *
 * Uses the export NDJSON as the manifest (the DB is the source of truth for
 * which objects matter — R2 may hold unreferenced clutter we don't migrate).
 * Idempotent: objects already in S3 with matching byte size are skipped.
 *
 * Writes a verification report to db/export/_storage-verification.txt.
 * (Once the bucket's public URL is disabled this script stops working — the
 *  rclone runbook in docs/MIGRATION-STORAGE-R2-TO-S3.md is the credentialed
 *  alternative for the final delta.)
 *
 * Env: R2_PUBLIC_BASE (default: the pub-… URL from .env), WB_BUCKET, AWS creds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R2_BASE = (process.env.R2_PUBLIC_BASE || 'https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev').replace(/\/$/, '');
const BUCKET = process.env.WB_BUCKET || 'wellbound-prod-store';
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

function readKeys(file, field) {
  const p = path.join(ROOT, 'db/export', file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l).fields?.[field]).filter(Boolean);
}

// Prefixes that STAY on Cloudflare R2 (public, non-PHI by design — see
// docs/MIGRATION-STORAGE-R2-TO-S3.md). Excluded from the S3 copy.
const STAYS_ON_R2 = /^(Support\/|files\/|signature-photos\/|index-oasis\/)/;

const allKeys = [...new Set([
  ...readKeys('Files.ndjson', 'r2_key'),
  ...readKeys('Attachments.ndjson', 'r2_object_key'),
])];
const keys = allKeys.filter((k) => !STAYS_ON_R2.test(k));
const excluded = allKeys.length - keys.length;

console.log(`${allKeys.length} referenced keys; migrating ${keys.length} (${excluded} stay on public R2).`);
const report = [`Storage verification — ${new Date().toISOString()}`, `Source: ${R2_BASE}`, `Dest: s3://${BUCKET}`, ''];
let copied = 0, skipped = 0, failed = 0;

for (const key of keys) {
  // Keys are stored unencoded; encode each path segment for the URL. Some
  // legacy keys are stored pre-encoded — fall back to the raw string.
  const encoded = `${R2_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const raw = `${R2_BASE}/${key}`;
  try {
    let res = await fetch(encoded);
    if (res.status === 404 && raw !== encoded) res = await fetch(raw);
    if (!res.ok) throw new Error(`R2 fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';

    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      if (head.ContentLength === buf.byteLength) {
        skipped++;
        report.push(`SKIP (exists, ${buf.byteLength}B) ${key}`);
        continue;
      }
    } catch { /* not present yet */ }

    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: contentType }));
    copied++;
    report.push(`COPY (${buf.byteLength}B, ${contentType}) ${key}`);
    console.log(`✓ ${key} (${buf.byteLength}B)`);
  } catch (err) {
    failed++;
    report.push(`FAIL ${key} — ${err.message}`);
    console.error(`✗ ${key} — ${err.message}`);
  }
}

report.push('', `copied=${copied} skipped=${skipped} failed=${failed} total=${keys.length}`);
fs.writeFileSync(path.join(ROOT, 'db/export/_storage-verification.txt'), report.join('\n'));
console.log(`\ncopied=${copied} skipped=${skipped} failed=${failed} → db/export/_storage-verification.txt`);
process.exit(failed ? 1 : 0);
