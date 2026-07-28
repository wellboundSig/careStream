#!/usr/bin/env node
/**
 * Seed primary caregiver contact from patient demographics.
 *
 * Ops truth: patients are not contacted directly. Historical phone_primary,
 * phone_secondary, and email on the patient record were taken down for the
 * primary caregiver — not the patient. This backfill fills empty
 * primary_contact_* mirrors + known_guardians / patient_guardians links.
 *
 * Name rule: when primary name is missing, if the caregiver phone AND email
 * match the emergency contact (phones both present and equal; emails equal
 * after normalize, including both blank), use the emergency contact’s name
 * (and relationship if primary relationship is empty).
 *
 * Fill-only — never overwrites non-empty primary_contact_* fields.
 * Does not clear phone_primary / email / phone_secondary.
 *
 * Usage:
 *   node scripts/migrate-primary-from-demographics.js              # dry-run
 *   node scripts/migrate-primary-from-demographics.js --confirm    # apply
 *   node scripts/migrate-primary-from-demographics.js --limit=40
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (reads careStream/.env if present).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';
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

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
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

/** Phone+email identify the same person as emergency (emails may both be blank). */
function matchesEmergency(phone, email, emergencyPhone, emergencyEmail) {
  if (!phone || phone.length < 10) return false;
  if (phone !== emergencyPhone) return false;
  return normEmail(email) === normEmail(emergencyEmail);
}

/**
 * Build the primary-caregiver seed for one patient.
 * Returns null when there is nothing useful to fill.
 */
function buildPrimarySeed(p) {
  const existingPhone = digits(p.primary_contact_phone);
  const existingEmail = String(p.primary_contact_email || '').trim();
  const existingName = String(p.primary_contact_name || '').trim();
  const existingRel = String(p.primary_contact_relationship || '').trim();

  const demoPhone = digits(p.phone_primary) || digits(p.phone_secondary);
  const demoEmail = String(p.email || '').trim();
  const demoSecondary = digits(p.phone_secondary);

  const phone = existingPhone || demoPhone;
  const email = existingEmail || demoEmail;

  if (!phone && !email && !existingName) return null;

  // Nothing left to fill into empty primary mirrors?
  const needsPhone = !existingPhone && !!demoPhone;
  const needsEmail = !existingEmail && !!demoEmail;
  const needsName = !existingName;
  const needsRel = !existingRel;
  if (!needsPhone && !needsEmail && !needsName && !needsRel && existingPhone) {
    // Primary already populated; still may need guardian link — keep going
    // only if we have a contact identity.
  }

  let nameSource = existingName ? 'existing_primary' : null;
  let name = existingName;
  let relationship = existingRel;

  if (!name) {
    const ecPhone = digits(p.emergency_contact_phone);
    const ecEmail = p.emergency_contact_email;
    if (
      matchesEmergency(phone || demoPhone, email || demoEmail, ecPhone, ecEmail)
      && p.emergency_contact_name
    ) {
      const parsed = parseContact(
        p.emergency_contact_name,
        phone || demoPhone,
        email || demoEmail,
        p.emergency_contact_relationship,
      );
      name = parsed.display_name;
      if (!relationship) relationship = parsed.relationship;
      nameSource = 'emergency_match';
    } else {
      nameSource = 'none';
    }
  }

  const contact = parseContact(name, phone, email, relationship);
  // Preserve secondary as note only in dry-run; phone field uses primary then secondary.
  const willFillPhone = !existingPhone && !!contact.phone;
  const willFillEmail = !existingEmail && !!contact.email;
  const willFillName = !existingName && !!contact.display_name;
  const willFillRel = !existingRel && !!contact.relationship;

  if (!willFillPhone && !willFillEmail && !willFillName && !willFillRel && !contact.phone && !contact.display_name) {
    return null;
  }

  // Skip patients with zero demographics to seed and nothing to link
  if (!demoPhone && !demoEmail && !existingPhone && !existingName) return null;

  return {
    patient_id: p.id,
    contact,
    nameSource,
    demo: {
      phone_primary: digits(p.phone_primary),
      phone_secondary: demoSecondary,
      email: demoEmail,
    },
    fills: {
      phone: willFillPhone,
      email: willFillEmail,
      name: willFillName,
      relationship: willFillRel,
    },
    sameAsEmergency: matchesEmergency(
      contact.phone,
      contact.email,
      digits(p.emergency_contact_phone),
      p.emergency_contact_email,
    ),
  };
}

const guardianCache = new Map();

async function ensureGuardian(contact, tx) {
  if (!contact.display_name && !contact.phone) return null;
  const cacheKey = `${contact.phone || ''}|${(contact.display_name || '').toLowerCase()}`;
  if (guardianCache.has(cacheKey)) return guardianCache.get(cacheKey);

  let existing = null;
  if (contact.phone.length >= 10) {
    const rows = await query(
      `SELECT id, display_name, phone FROM known_guardians
       WHERE regexp_replace(coalesce(phone,''), '\\D', '', 'g') = :phone LIMIT 1`,
      [{ name: 'phone', value: { stringValue: contact.phone } }],
      tx,
    );
    existing = rows[0] || null;
  }
  if (!existing && contact.display_name) {
    const rows = await query(
      `SELECT id, display_name, phone FROM known_guardians
       WHERE lower(display_name) = lower(:name) LIMIT 1`,
      [{ name: 'name', value: { stringValue: contact.display_name } }],
      tx,
    );
    existing = rows[0] || null;
  }

  if (existing) {
    // Fill empty email on guardian when we have one
    if (CONFIRM && contact.email) {
      await exec(
        `UPDATE known_guardians SET
           email = CASE WHEN coalesce(email,'') = '' THEN :email ELSE email END,
           updated_at = now()
         WHERE id = :id`,
        [
          { name: 'email', value: { stringValue: contact.email } },
          { name: 'id', value: { stringValue: existing.id } },
        ],
        tx,
      );
    }
    guardianCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const id = newId('grd');
  const names = splitName(contact.display_name);
  if (CONFIRM) {
    await exec(
      `INSERT INTO known_guardians
         (id, first_name, last_name, display_name, phone, email, is_active, created_at, updated_at)
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
    `INSERT INTO patient_guardians
       (id, patient_id, guardian_id, relationship, is_primary, is_emergency, source, created_at, updated_at)
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

async function mirrorPrimary(patientId, contact, tx) {
  if (!CONFIRM || !patientId) return;
  // Fill-only: never overwrite non-empty primary_contact_* values.
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
}

async function main() {
  console.log(`\nPrimary-from-demographics seed — ${CONFIRM ? 'CONFIRM (writes)' : 'DRY-RUN'}\n`);

  try {
    await query(`SELECT 1 FROM known_guardians LIMIT 1`);
  } catch (err) {
    console.error('known_guardians table missing. Run: npm run db:migrate');
    console.error(err.message);
    process.exit(1);
  }

  const patients = await query(`
    SELECT id,
           phone_primary, phone_secondary, email,
           primary_contact_name, primary_contact_phone, primary_contact_email, primary_contact_relationship,
           emergency_contact_name, emergency_contact_phone, emergency_contact_email, emergency_contact_relationship
    FROM patients
    WHERE coalesce(phone_primary,'') <> ''
       OR coalesce(phone_secondary,'') <> ''
       OR coalesce(email,'') <> ''
       OR coalesce(primary_contact_phone,'') <> ''
       OR coalesce(primary_contact_name,'') <> ''
  `);

  const plan = [];
  const stats = {
    totalCandidates: patients.length,
    seeded: 0,
    nameFromEmergency: 0,
    nameNone: 0,
    nameExisting: 0,
    fillPhone: 0,
    fillEmail: 0,
    fillName: 0,
    skipped: 0,
  };

  for (const p of patients) {
    const row = buildPrimarySeed(p);
    if (!row) {
      stats.skipped++;
      continue;
    }
    // Only include if we will fill something OR can link a guardian with phone/name
    const anyFill = row.fills.phone || row.fills.email || row.fills.name || row.fills.relationship;
    const canLink = !!(row.contact.phone || row.contact.display_name);
    if (!anyFill && !canLink) {
      stats.skipped++;
      continue;
    }
    plan.push(row);
    stats.seeded++;
    if (row.nameSource === 'emergency_match') stats.nameFromEmergency++;
    else if (row.nameSource === 'existing_primary') stats.nameExisting++;
    else stats.nameNone++;
    if (row.fills.phone) stats.fillPhone++;
    if (row.fills.email) stats.fillEmail++;
    if (row.fills.name) stats.fillName++;
  }

  console.log(`Patients with demo/primary contact data: ${stats.totalCandidates}`);
  console.log(`Seed operations planned:               ${stats.seeded}`);
  console.log(`  fill primary phone:                  ${stats.fillPhone}`);
  console.log(`  fill primary email:                  ${stats.fillEmail}`);
  console.log(`  fill primary name:                   ${stats.fillName}`);
  console.log(`  name from emergency match:           ${stats.nameFromEmergency}`);
  console.log(`  name already on primary:             ${stats.nameExisting}`);
  console.log(`  name still unknown:                  ${stats.nameNone}`);
  console.log(`  skipped (nothing to do):             ${stats.skipped}`);

  console.log('\n── Preview ──');
  plan.slice(0, PREVIEW_LIMIT).forEach((row, i) => {
    const fills = Object.entries(row.fills).filter(([, v]) => v).map(([k]) => k).join(',') || 'link-only';
    console.log(
      `${String(i + 1).padStart(3)}. pat=${row.patient_id}`
      + `  phone=${row.contact.phone || '—'}`
      + `  email=${row.contact.email || '—'}`
      + `  name=${row.contact.display_name || '—'}`
      + `  nameSrc=${row.nameSource}`
      + `  fills=${fills}`
      + (row.demo.phone_secondary && row.demo.phone_secondary !== row.contact.phone
        ? `  secondary=${row.demo.phone_secondary}`
        : ''),
    );
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
      if (gid) {
        await ensureLink(row.patient_id, gid, {
          relationship: row.contact.relationship,
          isPrimary: true,
          isEmergency: row.sameAsEmergency,
          source: 'migration_demographics',
        }, txId);
      }
      await mirrorPrimary(row.patient_id, row.contact, txId);
      n++;
      if (n % 50 === 0) console.log(`  … ${n}/${plan.length}`);
    }
    await client.send(new CommitTransactionCommand({ resourceArn, secretArn, database, transactionId: txId }));
    console.log(`\nCommitted ${n} patient seed operations.`);
  } catch (err) {
    if (txId) {
      await client.send(new RollbackTransactionCommand({
        resourceArn, secretArn, database, transactionId: txId,
      })).catch(() => {});
    }
    console.error('Migration failed — rolled back.', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
