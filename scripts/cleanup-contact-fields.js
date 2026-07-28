#!/usr/bin/env node
/**
 * Careful live cleanup of patient contact fields + known_guardians.
 *
 * Fixes (fill/clear only — never invents people or overwrites real names):
 *  1. Name field is a phone number → clear name; ensure phone set from it if empty
 *  2. Name field is an email → move to email if empty; clear name
 *  3. Name field is a role only (Mom/Dad/…) → clear name; fill relationship
 *  4. Email field has no @ → clear
 *  5. Primary + emergency share a phone and names don't conflict → merge
 *     empty fields across both (and sync email/phone_primary when empty)
 *  6. known_guardians display_name that is phone/email/role → clear or move
 *
 * Usage:
 *   node scripts/cleanup-contact-fields.js           # dry-run
 *   node scripts/cleanup-contact-fields.js --confirm  # apply
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
  normalizeGuardianRelationship,
  splitContactNameAndRelationship,
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
const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
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

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

function phone10(v) {
  const d = digits(v);
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.slice(0, 10);
}

function isPhoneLike(s) {
  const raw = String(s || '').trim();
  if (!raw) return false;
  const d = digits(raw);
  if (!/^[\d\s().+\-]+$/.test(raw)) return false;
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}

function isEmailLike(s) {
  return /@/.test(String(s || ''));
}

function isRealPersonName(s) {
  const raw = String(s || '').trim();
  if (!raw) return false;
  if (isPhoneLike(raw) || isEmailLike(raw)) return false;
  if (normalizeGuardianRelationship(raw)) return false;
  return true;
}

function pickRealName(...cands) {
  for (const c of cands) {
    const cleaned = splitContactNameAndRelationship(c).cleanName || String(c || '').trim();
    if (isRealPersonName(cleaned)) return normalizeContactName(cleaned);
  }
  return '';
}

function pickEmail(...cands) {
  for (const c of cands) {
    const s = String(c || '').trim();
    if (isEmailLike(s)) return s;
  }
  return '';
}

function pickPhone(...cands) {
  for (const c of cands) {
    if (isPhoneLike(c)) return phone10(c);
    const p = phone10(c);
    if (p.length === 10) return p;
  }
  return '';
}

console.log(`\nContact-field cleanup — ${CONFIRM ? 'CONFIRM (writes)' : 'DRY-RUN'}\n`);

const patients = await query(`
  SELECT id, first_name, last_name,
         primary_contact_name, primary_contact_phone, primary_contact_email, primary_contact_relationship,
         emergency_contact_name, emergency_contact_phone, emergency_contact_email, emergency_contact_relationship,
         phone_primary, phone_secondary, email
  FROM patients
`);

const guardians = await query(`
  SELECT id, display_name, first_name, last_name, phone, email FROM known_guardians
`);
const links = await query(`
  SELECT patient_id, guardian_id, is_primary, is_emergency FROM patient_guardians
`);
const patientById = new Map(patients.map((p) => [p.id, p]));
const linksByGuardian = new Map();
for (const l of links) {
  if (!linksByGuardian.has(l.guardian_id)) linksByGuardian.set(l.guardian_id, []);
  linksByGuardian.get(l.guardian_id).push(l);
}

/** @type {Array<{id:string, patch:Record<string,string>, reasons:string[]}>} */
const patientUpdates = [];
/** @type {Array<{id:string, patch:Record<string,string>, reasons:string[]}>} */
const guardianUpdates = [];

for (const p of patients) {
  const patch = {};
  const reasons = [];

  // Work on copies
  let pName = String(p.primary_contact_name || '').trim();
  let eName = String(p.emergency_contact_name || '').trim();
  let pPhone = phone10(p.primary_contact_phone);
  let ePhone = phone10(p.emergency_contact_phone);
  let pEmail = String(p.primary_contact_email || '').trim();
  let eEmail = String(p.emergency_contact_email || '').trim();
  let pRel = String(p.primary_contact_relationship || '').trim();
  let eRel = String(p.emergency_contact_relationship || '').trim();
  let demoPhone = phone10(p.phone_primary);
  let demoEmail = String(p.email || '').trim();

  // 1–3: clean junk names on each slot
  for (const slot of [
    { getName: () => pName, setName: (v) => { pName = v; }, getPhone: () => pPhone, setPhone: (v) => { pPhone = v; }, getEmail: () => pEmail, setEmail: (v) => { pEmail = v; }, getRel: () => pRel, setRel: (v) => { pRel = v; }, label: 'primary' },
    { getName: () => eName, setName: (v) => { eName = v; }, getPhone: () => ePhone, setPhone: (v) => { ePhone = v; }, getEmail: () => eEmail, setEmail: (v) => { eEmail = v; }, getRel: () => eRel, setRel: (v) => { eRel = v; }, label: 'emergency' },
  ]) {
    const name = slot.getName();
    if (!name) continue;

    if (isPhoneLike(name)) {
      if (!slot.getPhone()) {
        slot.setPhone(phone10(name));
        reasons.push(`${slot.label}: phone from name`);
      }
      slot.setName('');
      reasons.push(`${slot.label}: cleared phone-as-name "${name}"`);
      continue;
    }

    if (isEmailLike(name)) {
      if (!slot.getEmail()) {
        slot.setEmail(name);
        reasons.push(`${slot.label}: email from name`);
      }
      slot.setName('');
      reasons.push(`${slot.label}: cleared email-as-name`);
      continue;
    }

    const role = normalizeGuardianRelationship(name);
    if (role) {
      if (!slot.getRel()) {
        slot.setRel(role);
        reasons.push(`${slot.label}: rel ${role} from name`);
      }
      slot.setName('');
      reasons.push(`${slot.label}: cleared role-as-name "${name}"`);
      continue;
    }

    // Parenthetical role in otherwise-real name
    const split = splitContactNameAndRelationship(name);
    if (split.relationship && split.cleanName !== name) {
      slot.setName(split.cleanName);
      if (!slot.getRel()) slot.setRel(split.relationship);
      reasons.push(`${slot.label}: stripped paren role → "${split.cleanName}" / ${split.relationship}`);
    }
  }

  // 4: bad emails
  if (pEmail && !isEmailLike(pEmail)) {
    reasons.push(`primary: cleared non-email "${pEmail}"`);
    pEmail = '';
  }
  if (eEmail && !isEmailLike(eEmail)) {
    reasons.push(`emergency: cleared non-email "${eEmail}"`);
    eEmail = '';
  }
  if (demoEmail && !isEmailLike(demoEmail)) {
    reasons.push(`demo: cleared non-email "${demoEmail}"`);
    demoEmail = '';
  }

  // Seed phones from demos if contact phones empty
  if (!pPhone && demoPhone) {
    pPhone = demoPhone;
    reasons.push('primary: phone from phone_primary');
  }

  // 5: same-phone merge (after junk names cleared)
  const shared = (pPhone.length === 10 && ePhone.length === 10 && pPhone === ePhone)
    || (pPhone.length === 10 && !ePhone)
    || (ePhone.length === 10 && !pPhone);

  if (shared) {
    const phone = pPhone || ePhone;
    const realP = isRealPersonName(pName) ? pName : '';
    const realE = isRealPersonName(eName) ? eName : '';
    const nameConflict = realP && realE && realP.toLowerCase() !== realE.toLowerCase();

    if (!nameConflict) {
      const name = pickRealName(pName, eName);
      const email = pickEmail(pEmail, eEmail, demoEmail);
      const rel = pRel || eRel || '';

      if (phone && pPhone !== phone) { pPhone = phone; reasons.push('primary: phone aligned'); }
      if (phone && ePhone !== phone) { ePhone = phone; reasons.push('emergency: phone aligned'); }
      if (name && pName !== name) { pName = name; reasons.push(`primary: name ← "${name}"`); }
      if (name && eName !== name) { eName = name; reasons.push(`emergency: name ← "${name}"`); }
      if (email && pEmail !== email) { pEmail = email; reasons.push('primary: email filled'); }
      if (email && eEmail !== email) { eEmail = email; reasons.push('emergency: email filled'); }
      if (rel && !pRel) { pRel = rel; reasons.push('primary: rel filled'); }
      if (rel && !eRel) { eRel = rel; reasons.push('emergency: rel filled'); }

      // Sync demos only when empty (never overwrite a different phone_primary)
      if (phone && !demoPhone) {
        demoPhone = phone;
        reasons.push('demo phone_primary filled');
      }
      if (email && !demoEmail) {
        demoEmail = email;
        reasons.push('demo email filled');
      }
    } else {
      reasons.push('skip merge: conflicting real names');
    }
  }

  // Build patch vs original
  const desired = {
    primary_contact_name: pName,
    primary_contact_phone: pPhone,
    primary_contact_email: pEmail,
    primary_contact_relationship: pRel,
    emergency_contact_name: eName,
    emergency_contact_phone: ePhone,
    emergency_contact_email: eEmail,
    emergency_contact_relationship: eRel,
    phone_primary: demoPhone || String(p.phone_primary || ''),
    email: demoEmail,
  };

  const orig = {
    primary_contact_name: String(p.primary_contact_name || '').trim(),
    primary_contact_phone: phone10(p.primary_contact_phone) || String(p.primary_contact_phone || '').trim(),
    primary_contact_email: String(p.primary_contact_email || '').trim(),
    primary_contact_relationship: String(p.primary_contact_relationship || '').trim(),
    emergency_contact_name: String(p.emergency_contact_name || '').trim(),
    emergency_contact_phone: phone10(p.emergency_contact_phone) || String(p.emergency_contact_phone || '').trim(),
    emergency_contact_email: String(p.emergency_contact_email || '').trim(),
    emergency_contact_relationship: String(p.emergency_contact_relationship || '').trim(),
    phone_primary: phone10(p.phone_primary) || String(p.phone_primary || '').trim(),
    email: String(p.email || '').trim(),
  };

  const realPatch = {};
  for (const [k, v] of Object.entries(desired)) {
    const before = orig[k] || '';
    const after = v || '';
    // Normalize phone compare
    if (k.includes('phone') || k === 'phone_primary') {
      if (phone10(before) !== phone10(after) || (after && !before)) {
        // Only write if changed meaningfully
        if (phone10(before) !== phone10(after)) realPatch[k] = after;
      }
    } else if (before !== after) {
      realPatch[k] = after;
    }
  }

  // Drop reasons that didn't produce a patch
  if (Object.keys(realPatch).length === 0) continue;

  // Never blank out a different existing phone_primary with caregiver phone
  // unless phone_primary was empty (already handled). If patch would change
  // phone_primary FROM a different number TO caregiver, remove that key.
  if (
    realPatch.phone_primary
    && phone10(p.phone_primary)
    && phone10(realPatch.phone_primary) !== phone10(p.phone_primary)
  ) {
    delete realPatch.phone_primary;
  }

  if (Object.keys(realPatch).length === 0) continue;

  patientUpdates.push({
    id: p.id,
    label: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    patch: realPatch,
    reasons: [...new Set(reasons)],
  });
}

for (const g of guardians) {
  const patch = {};
  const reasons = [];
  let name = String(g.display_name || '').trim();
  let phone = phone10(g.phone);
  let email = String(g.email || '').trim();
  let first = String(g.first_name || '').trim();
  let last = String(g.last_name || '').trim();

  if (isPhoneLike(name)) {
    if (!phone) phone = phone10(name);
    name = '';
    first = '';
    last = '';
    reasons.push('cleared phone-as-display_name');
  } else if (isEmailLike(name)) {
    if (!email) email = name;
    name = '';
    first = '';
    last = '';
    reasons.push('cleared email-as-display_name');
  } else if (normalizeGuardianRelationship(name)) {
    name = '';
    first = '';
    last = '';
    reasons.push('cleared role-as-display_name');
  }

  if (email && !isEmailLike(email)) {
    email = '';
    reasons.push('cleared non-email');
  }

  // If display_name empty after junk clear, borrow a real name from linked patient mirrors
  // or another guardian with the same phone.
  if (!name && phone) {
    const linked = linksByGuardian.get(g.id) || [];
    for (const l of linked) {
      const pat = patientById.get(l.patient_id);
      if (!pat) continue;
      const borrowed = pickRealName(pat.primary_contact_name, pat.emergency_contact_name);
      if (borrowed) {
        name = borrowed;
        const parts = borrowed.split(/\s+/);
        first = parts.length > 1 ? parts[0] : '';
        last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        reasons.push(`display_name ← patient ${l.patient_id}`);
        break;
      }
    }
    if (!name) {
      const peer = guardians.find((x) => x.id !== g.id && phone10(x.phone) === phone && isRealPersonName(x.display_name));
      if (peer) {
        name = normalizeContactName(peer.display_name);
        first = String(peer.first_name || '').trim();
        last = String(peer.last_name || '').trim();
        reasons.push(`display_name ← peer guardian ${peer.id}`);
      }
    }
  }

  const desired = {
    display_name: name,
    first_name: first,
    last_name: last,
    phone: phone || String(g.phone || ''),
    email,
  };
  for (const [k, v] of Object.entries(desired)) {
    const before = String(g[k] || '').trim();
    const after = String(v || '').trim();
    if (k === 'phone') {
      if (phone10(before) !== phone10(after)) patch[k] = after;
    } else if (before !== after) {
      patch[k] = after;
    }
  }
  if (Object.keys(patch).length) {
    guardianUpdates.push({ id: g.id, patch, reasons });
  }
}

console.log(`Patient updates:  ${patientUpdates.length}`);
console.log(`Guardian updates: ${guardianUpdates.length}\n`);

patientUpdates.forEach((u, i) => {
  console.log(`${String(i + 1).padStart(3)}. ${u.id}  ${u.label}`);
  console.log(`     reasons: ${u.reasons.join('; ') || '(field sync)'}`);
  console.log(`     patch:   ${JSON.stringify(u.patch)}`);
});
if (guardianUpdates.length) {
  console.log('\nGuardians:');
  guardianUpdates.forEach((u, i) => {
    console.log(`${i + 1}. ${u.id}  ${u.reasons.join('; ')}  ${JSON.stringify(u.patch)}`);
  });
}

if (!CONFIRM) {
  console.log('\nDry-run only. Re-run with --confirm to apply.');
  process.exit(0);
}

let txId;
try {
  const begin = await client.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
  txId = begin.transactionId;

  for (const u of patientUpdates) {
    const sets = Object.keys(u.patch).map((k) => `${k} = :${k}`);
    sets.push('updated_at = now()');
    const params = Object.entries(u.patch).map(([k, v]) => ({
      name: k,
      value: { stringValue: v == null ? '' : String(v) },
    }));
    params.push({ name: 'pid', value: { stringValue: u.id } });
    await exec(
      `UPDATE patients SET ${sets.join(', ')} WHERE id = :pid`,
      params,
      txId,
    );
  }

  for (const u of guardianUpdates) {
    const sets = Object.keys(u.patch).map((k) => `${k} = :${k}`);
    sets.push('updated_at = now()');
    const params = Object.entries(u.patch).map(([k, v]) => ({
      name: k,
      value: { stringValue: v == null ? '' : String(v) },
    }));
    params.push({ name: 'gid', value: { stringValue: u.id } });
    await exec(
      `UPDATE known_guardians SET ${sets.join(', ')} WHERE id = :gid`,
      params,
      txId,
    );
  }

  await client.send(new CommitTransactionCommand({
    resourceArn, secretArn, database, transactionId: txId,
  }));
  console.log(`\nCommitted ${patientUpdates.length} patient + ${guardianUpdates.length} guardian updates.`);
} catch (err) {
  if (txId) {
    await client.send(new RollbackTransactionCommand({
      resourceArn, secretArn, database, transactionId: txId,
    })).catch(() => {});
  }
  console.error('Cleanup failed — rolled back.', err);
  process.exit(1);
}

// Verify James + re-audit counts
const james = await query(`
  SELECT primary_contact_name, primary_contact_phone, primary_contact_email,
         emergency_contact_name, emergency_contact_phone, emergency_contact_email,
         phone_primary, email
  FROM patients WHERE id = 'pat_1784753852157_z3sr'
`);
console.log('\nJames Migliara after:', james[0]);

const leftoverPhoneNames = await query(`
  SELECT id, primary_contact_name, emergency_contact_name FROM patients
  WHERE regexp_replace(coalesce(primary_contact_name,''), '\\D', '', 'g') ~ '^[0-9]{10,11}$'
     OR regexp_replace(coalesce(emergency_contact_name,''), '\\D', '', 'g') ~ '^[0-9]{10,11}$'
`);
console.log(`Remaining phone-as-name patients: ${leftoverPhoneNames.length}`);
