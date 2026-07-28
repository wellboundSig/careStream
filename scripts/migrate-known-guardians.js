#!/usr/bin/env node
/**
 * Backfill known_guardians + patient_guardians from existing contact text.
 *
 * LIVE DATA — defaults to dry-run. Review carefully before --confirm.
 *
 * Sources (never deletes raw text; only cleans parenthetical roles into
 * relationship and dual-writes mirrors):
 *   1. patients.emergency_contact_*  (+ new primary_* if already set)
 *   2. triage_pediatric primary / secondary / emergency caregivers
 *   3. triage_adult caregiver / secondary
 *
 * Usage:
 *   node scripts/migrate-known-guardians.js                 # dry-run
 *   node scripts/migrate-known-guardians.js --confirm       # apply
 *   node scripts/migrate-known-guardians.js --limit=30
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (reads careStream/.env if present).
 * Apply db/migrations/0028_known_guardians.sql first (npm run db:migrate).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand, BeginTransactionCommand, CommitTransactionCommand, RollbackTransactionCommand } from '@aws-sdk/client-rds-data';
import {
  splitContactNameAndRelationship,
  normalizeGuardianRelationship,
} from '../src/data/guardianRelationships.js';
import { normalizeContactName } from '../src/utils/personName.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* no .env */ }

const CONFIRM = process.argv.includes('--confirm');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const PREVIEW_LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 40) : 40;

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN (or add them to careStream/.env)');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql, parameters, transactionId) {
  return client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, transactionId, includeResultMetadata: true,
  }));
}

async function query(sql, parameters, transactionId) {
  const res = await exec(sql, parameters, transactionId);
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
    });
    return o;
  });
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 10);
}

function splitName(display) {
  const clean = normalizeContactName(display);
  if (!clean) return { first_name: '', last_name: '', display_name: '' };
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: '', last_name: parts[0], display_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' '), display_name: clean };
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseContact(name, phone, email, relationshipHint) {
  const { cleanName, relationship } = splitContactNameAndRelationship(name);
  return {
    display_name: normalizeContactName(cleanName),
    phone: digits(phone),
    email: email ? String(email).trim() : '',
    relationship: normalizeGuardianRelationship(relationshipHint) || relationship || '',
  };
}

/** In-memory dedupe cache for this run: phone|name → guardian id */
const guardianCache = new Map();

async function ensureGuardian(contact, tx) {
  if (!contact.display_name && !contact.phone) return null;
  const cacheKey = `${contact.phone || ''}|${(contact.display_name || '').toLowerCase()}`;
  if (guardianCache.has(cacheKey)) return guardianCache.get(cacheKey);

  let existing = null;
  if (contact.phone.length >= 10) {
    const rows = await query(
      `SELECT id, display_name, phone FROM known_guardians WHERE regexp_replace(coalesce(phone,''), '\\D', '', 'g') = :phone LIMIT 1`,
      [{ name: 'phone', value: { stringValue: contact.phone } }],
      tx,
    );
    existing = rows[0] || null;
  }
  if (!existing && contact.display_name) {
    const rows = await query(
      `SELECT id, display_name, phone FROM known_guardians WHERE lower(display_name) = lower(:name) LIMIT 1`,
      [{ name: 'name', value: { stringValue: contact.display_name } }],
      tx,
    );
    existing = rows[0] || null;
  }

  if (existing) {
    guardianCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const id = newId('grd');
  const names = splitName(contact.display_name);
  if (CONFIRM) {
    await exec(
      `INSERT INTO known_guardians (id, first_name, last_name, display_name, phone, email, is_active, created_at, updated_at)
       VALUES (:id, :fn, :ln, :dn, :phone, :email, true, now(), now())`,
      [
        { name: 'id', value: { stringValue: id } },
        { name: 'fn', value: { stringValue: names.first_name || '' } },
        { name: 'ln', value: { stringValue: names.last_name || '' } },
        { name: 'dn', value: { stringValue: names.display_name || contact.display_name || '' } },
        { name: 'phone', value: { stringValue: contact.phone || '' } },
        { name: 'email', value: { stringValue: contact.email || '' } },
      ],
      tx,
    );
  }
  guardianCache.set(cacheKey, id);
  return id;
}

async function ensureLink(patientId, guardianId, { relationship, isPrimary, isEmergency, source }, tx) {
  if (!patientId || !guardianId) return;
  const existing = await query(
    `SELECT id, is_primary, is_emergency, relationship FROM patient_guardians
     WHERE patient_id = :pid AND guardian_id = :gid LIMIT 1`,
    [
      { name: 'pid', value: { stringValue: patientId } },
      { name: 'gid', value: { stringValue: guardianId } },
    ],
    tx,
  );
  if (existing[0]) {
    if (!CONFIRM) return;
    const sets = [
      `relationship = CASE WHEN coalesce(relationship,'') = '' THEN :rel ELSE relationship END`,
      `updated_at = now()`,
    ];
    if (isPrimary) sets.push('is_primary = true');
    if (isEmergency) sets.push('is_emergency = true');
    await exec(
      `UPDATE patient_guardians SET ${sets.join(', ')} WHERE id = :id`,
      [
        { name: 'rel', value: { stringValue: relationship || '' } },
        { name: 'id', value: { stringValue: existing[0].id } },
      ],
      tx,
    );
    return;
  }
  if (!CONFIRM) return;
  await exec(
    `INSERT INTO patient_guardians (id, patient_id, guardian_id, relationship, is_primary, is_emergency, source, created_at, updated_at)
     VALUES (:id, :pid, :gid, :rel, :ip, :ie, :src, now(), now())`,
    [
      { name: 'id', value: { stringValue: newId('pgrd') } },
      { name: 'pid', value: { stringValue: patientId } },
      { name: 'gid', value: { stringValue: guardianId } },
      { name: 'rel', value: { stringValue: relationship || '' } },
      { name: 'ip', value: { booleanValue: !!isPrimary } },
      { name: 'ie', value: { booleanValue: !!isEmergency } },
      { name: 'src', value: { stringValue: source } },
    ],
    tx,
  );
}

async function mirrorPatient(patientId, contact, slot, tx) {
  if (!CONFIRM || !patientId) return;
  if (slot === 'primary') {
    await exec(
      `UPDATE patients SET
         primary_contact_name = CASE WHEN coalesce(primary_contact_name,'') = '' THEN :name ELSE primary_contact_name END,
         primary_contact_phone = CASE WHEN coalesce(primary_contact_phone,'') = '' THEN :phone ELSE primary_contact_phone END,
         primary_contact_email = CASE WHEN coalesce(primary_contact_email,'') = '' THEN :email ELSE primary_contact_email END,
         primary_contact_relationship = CASE WHEN coalesce(primary_contact_relationship,'') = '' THEN :rel ELSE primary_contact_relationship END,
         updated_at = now()
       WHERE id = :pid`,
      [
        { name: 'name', value: { stringValue: contact.display_name || '' } },
        { name: 'phone', value: { stringValue: contact.phone || '' } },
        { name: 'email', value: { stringValue: contact.email || '' } },
        { name: 'rel', value: { stringValue: contact.relationship || '' } },
        { name: 'pid', value: { stringValue: patientId } },
      ],
      tx,
    );
  } else {
    // Clean emergency name (strip paren role) when it still contains the role
    await exec(
      `UPDATE patients SET
         emergency_contact_name = :name,
         emergency_contact_relationship = CASE WHEN coalesce(emergency_contact_relationship,'') = '' THEN :rel ELSE emergency_contact_relationship END,
         updated_at = now()
       WHERE id = :pid`,
      [
        { name: 'name', value: { stringValue: contact.display_name || '' } },
        { name: 'rel', value: { stringValue: contact.relationship || '' } },
        { name: 'pid', value: { stringValue: patientId } },
      ],
      tx,
    );
  }
}

async function main() {
  console.log(`\nKnown guardians migration — ${CONFIRM ? 'CONFIRM (writes)' : 'DRY-RUN'}\n`);

  // Sanity: tables exist
  try {
    await query(`SELECT 1 FROM known_guardians LIMIT 1`);
  } catch (err) {
    console.error('known_guardians table missing. Run: npm run db:migrate');
    console.error(err.message);
    process.exit(1);
  }

  const patients = await query(`
    SELECT id, emergency_contact_name, emergency_contact_phone, emergency_contact_email,
           emergency_contact_relationship, primary_contact_name, primary_contact_phone,
           primary_contact_email, primary_contact_relationship
    FROM patients
    WHERE coalesce(emergency_contact_name,'') <> ''
       OR coalesce(primary_contact_name,'') <> ''
  `);

  const ped = await query(`
    SELECT t.referral_id, r.patient_id,
           t.primary_caregiver_name, t.primary_caregiver_phone,
           t.secondary_caregiver_name, t.secondary_caregiver_phone,
           t.emergency_same_as_primary, t.emergency_contact_name, t.emergency_contact_phone
    FROM triage_pediatric t
    JOIN referrals r ON r.id = t.referral_id
    WHERE coalesce(t.primary_caregiver_name,'') <> ''
       OR coalesce(t.emergency_contact_name,'') <> ''
       OR coalesce(t.secondary_caregiver_name,'') <> ''
  `).catch(() => []);

  const adult = await query(`
    SELECT t.referral_id, r.patient_id,
           t.caregiver_name, t.caregiver_phone, t.caregiver_email,
           t.secondary_caregiver_name, t.secondary_caregiver_phone
    FROM triage_adult t
    JOIN referrals r ON r.id = t.referral_id
    WHERE coalesce(t.caregiver_name,'') <> ''
       OR coalesce(t.secondary_caregiver_name,'') <> ''
  `).catch(() => []);

  console.log(`Patients with contacts: ${patients.length}`);
  console.log(`Pediatric triage rows:  ${ped.length}`);
  console.log(`Adult triage rows:      ${adult.length}`);

  const plan = [];
  for (const p of patients) {
    if (p.emergency_contact_name || p.emergency_contact_phone) {
      const c = parseContact(
        p.emergency_contact_name,
        p.emergency_contact_phone,
        p.emergency_contact_email,
        p.emergency_contact_relationship,
      );
      plan.push({ kind: 'patient_emergency', patient_id: p.id, contact: c, raw: p.emergency_contact_name });
    }
    if (p.primary_contact_name || p.primary_contact_phone) {
      const c = parseContact(
        p.primary_contact_name,
        p.primary_contact_phone,
        p.primary_contact_email,
        p.primary_contact_relationship,
      );
      plan.push({ kind: 'patient_primary', patient_id: p.id, contact: c, raw: p.primary_contact_name });
    }
  }
  for (const t of ped) {
    if (!t.patient_id) continue;
    if (t.primary_caregiver_name || t.primary_caregiver_phone) {
      plan.push({
        kind: 'ped_primary',
        patient_id: t.patient_id,
        contact: parseContact(t.primary_caregiver_name, t.primary_caregiver_phone, '', ''),
        raw: t.primary_caregiver_name,
      });
    }
    const same = String(t.emergency_same_as_primary || '').toLowerCase() === 'yes';
    const ecName = same ? t.primary_caregiver_name : t.emergency_contact_name;
    const ecPhone = same ? t.primary_caregiver_phone : t.emergency_contact_phone;
    if (ecName || ecPhone) {
      plan.push({
        kind: 'ped_emergency',
        patient_id: t.patient_id,
        contact: parseContact(ecName, ecPhone, '', ''),
        raw: ecName,
      });
    }
    if (t.secondary_caregiver_name || t.secondary_caregiver_phone) {
      plan.push({
        kind: 'ped_secondary',
        patient_id: t.patient_id,
        contact: parseContact(t.secondary_caregiver_name, t.secondary_caregiver_phone, '', ''),
        raw: t.secondary_caregiver_name,
      });
    }
  }
  for (const t of adult) {
    if (!t.patient_id) continue;
    if (t.caregiver_name || t.caregiver_phone) {
      plan.push({
        kind: 'adult_primary',
        patient_id: t.patient_id,
        contact: parseContact(t.caregiver_name, t.caregiver_phone, t.caregiver_email, ''),
        raw: t.caregiver_name,
      });
    }
    if (t.secondary_caregiver_name || t.secondary_caregiver_phone) {
      plan.push({
        kind: 'adult_secondary',
        patient_id: t.patient_id,
        contact: parseContact(t.secondary_caregiver_name, t.secondary_caregiver_phone, '', ''),
        raw: t.secondary_caregiver_name,
      });
    }
  }

  console.log(`\nPlanned link operations: ${plan.length}`);
  console.log('── Preview ──');
  plan.slice(0, PREVIEW_LIMIT).forEach((row, i) => {
    const changed = row.raw && row.contact.display_name && row.raw.trim() !== row.contact.display_name
      ? `  name: "${row.raw}" → "${row.contact.display_name}"`
      : '';
    const rel = row.contact.relationship ? `  rel=${row.contact.relationship}` : '';
    console.log(`${String(i + 1).padStart(3)}. ${row.kind.padEnd(18)} pat=${row.patient_id}${rel}${changed}`);
  });
  if (plan.length > PREVIEW_LIMIT) console.log(`… +${plan.length - PREVIEW_LIMIT} more`);

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to apply.');
    return;
  }

  let txId;
  try {
    const begin = await client.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
    txId = begin.transactionId;
    let n = 0;
    for (const row of plan) {
      const gid = await ensureGuardian(row.contact, txId);
      if (!gid) continue;
      const isPrimary = row.kind.includes('primary');
      const isEmergency = row.kind.includes('emergency');
      await ensureLink(row.patient_id, gid, {
        relationship: row.contact.relationship,
        isPrimary,
        isEmergency,
        source: 'migration',
      }, txId);
      if (isPrimary || isEmergency) {
        await mirrorPatient(row.patient_id, row.contact, isPrimary ? 'primary' : 'emergency', txId);
      }
      n++;
      if (n % 50 === 0) console.log(`  … ${n}/${plan.length}`);
    }
    await client.send(new CommitTransactionCommand({ resourceArn, secretArn, database, transactionId: txId }));
    console.log(`\nCommitted ${n} operations.`);
  } catch (err) {
    if (txId) {
      await client.send(new RollbackTransactionCommand({ resourceArn, secretArn, database, transactionId: txId })).catch(() => {});
    }
    console.error('Migration failed — rolled back.', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
