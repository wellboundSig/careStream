#!/usr/bin/env node
/**
 * Aurora-only: purge patient/referral transactional data, then seed 12 mock patients.
 *
 * SAFETY
 *  - Allowlisted DELETE/TRUNCATE tables only (patients + peripherals).
 *  - NEVER touches physicians, facilities, users, marketers, sources, entities,
 *    departments, teams, categories, conflict_categories, tickets, etc.
 *  - Dry-run by default. Pass --confirm to write.
 *
 * Usage:
 *   node scripts/aurora-reset-mock-patients.js                 # dry-run
 *   node scripts/aurora-reset-mock-patients.js --confirm       # purge + seed
 *   node scripts/aurora-reset-mock-patients.js --confirm --purge-only  # wipe only
 *
 * Env: WB_CLUSTER_ARN, WB_SECRET_ARN, WB_DATABASE (default wellbound), AWS creds.
 * Mock PDFs expected at /tmp/wb-mock-files/ (downloaded beforehand) OR
 * MOCK_F2F_PATH / MOCK_FACESHEET_PATH.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* no .env */ }
}
loadEnv();

const CONFIRM = process.argv.includes('--confirm');
const PURGE_ONLY = process.argv.includes('--purge-only');
const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
const region = process.env.AWS_REGION || 'us-east-2';
const bucket = process.env.WB_BUCKET || 'wellbound-prod-store';

if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const rds = new RDSDataClient({ region });
const s3 = new S3Client({ region });

/** Tables we may wipe — patient/referral graph only. */
const PURGE_TABLES = [
  'opwdd_case_checklist_items',
  'opwdd_eligibility_cases',
  'eligibility_verifications',
  'patient_insurances',
  'patient_insurance_plans',
  'files',
  'notes',
  'stage_history',
  'tasks',
  'calls',
  'activity_log',
  'conflicts',
  'authorizations',
  'episodes',
  'insurance_checks',
  'disenrollment_assistance_flags',
  'cursory_review',
  'clinical_review',
  'triage_adult',
  'triage_pediatric',
  'triage_alf',
  'soc_reschedule_log',
  'inbound_submission_events',
  'inbound_submission_attachments',
  'inbound_submissions',
  'referrals',
  'patients',
];

const NUMBERS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function rand(n = 4) {
  return Math.random().toString(36).slice(2, 2 + n);
}

function makeIds(prefix) {
  const stamp = Date.now();
  const biz = `${prefix}_${stamp}_${rand(4)}`;
  const rec = `rec${stamp.toString(16)}${rand(6)}`;
  return { biz, rec };
}

async function exec(sql) {
  return rds.send(new ExecuteStatementCommand({ resourceArn, secretArn, database, sql }));
}

async function query(sql) {
  const res = await rds.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, includeResultMetadata: true,
  }));
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
    });
    return o;
  });
}

async function count(table) {
  try {
    const rows = await query(`SELECT count(*)::int AS n FROM "${table}"`);
    return rows[0]?.n ?? 0;
  } catch {
    return -1; // table missing
  }
}

async function pickRefs() {
  const marketers = await query(`
    SELECT trim(both E'\\n' FROM id) AS id, first_name, last_name, division
    FROM marketers WHERE status = 'Active' ORDER BY id`);
  const sources = await query(`
    SELECT trim(both E'\\n' FROM id) AS id, name
    FROM referral_sources
    WHERE coalesce(trim(both E'\\n' FROM is_active), 'TRUE') ILIKE 'TRUE%'
    ORDER BY id LIMIT 20`);
  const facilities = await query(`
    SELECT id, name FROM facilities
    WHERE type ILIKE '%ASSISTED LIVING%' AND coalesce(is_active,'TRUE') ILIKE 'TRUE%'
    ORDER BY name LIMIT 20`);
  const entities = await query(`SELECT id, entity_name FROM entities ORDER BY id`);
  const users = await query(`SELECT id FROM users WHERE id IS NOT NULL LIMIT 5`);

  const mktAlf = marketers.find((m) => /ALF/i.test(m.division || '')) || marketers[0];
  const mktSn = marketers.find((m) => /SN|Special/i.test(m.division || '')) || marketers[1] || marketers[0];
  if (!mktAlf || !mktSn || !sources[0] || !facilities[0]) {
    throw new Error('Missing marketers / referral sources / ALF facilities — aborting seed');
  }
  const entityWb = entities.find((e) => e.entity_name === 'WB' || e.id === 'ent_001')?.id || entities[0]?.id || null;
  return {
    mktAlf: mktAlf.id,
    mktSn: mktSn.id,
    sourceId: sources[0].id,
    facilityId: facilities[0].id,
    facilityName: facilities[0].name,
    entityId: entityWb,
    userId: users[0]?.id || null,
  };
}

async function uploadMockFile(patientBizId, localPath, fileName) {
  const key = `CareStream/files/${patientBizId}/${Date.now()}_${rand(6)}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const body = readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/pdf',
  }));
  return { key, size: body.length, fileName };
}

async function purge() {
  console.log('\n── Purge (patient/referral graph only) ──');
  for (const t of PURGE_TABLES) {
    const n = await count(t);
    console.log(`  ${CONFIRM ? 'TRUNCATE' : 'would wipe'} ${t}: ${n < 0 ? '(missing)' : n}`);
  }
  if (!CONFIRM) return;

  // Null inbound conversion links (keep submission rows)
  try {
    await exec(`
      UPDATE inbound_submissions
      SET converted_patient_id = NULL, converted_referral_id = NULL
      WHERE converted_patient_id IS NOT NULL OR converted_referral_id IS NOT NULL`);
    console.log('  cleared inbound_submissions conversion links');
  } catch (e) {
    console.warn('  inbound_submissions update skipped:', e.message?.slice(0, 120));
  }

  // Delete children → parents. Prefer DELETE over TRUNCATE so missing tables don't abort the batch.
  for (const t of PURGE_TABLES) {
    try {
      await exec(`DELETE FROM "${t}"`);
      console.log(`  ✓ cleared ${t}`);
    } catch (e) {
      console.warn(`  ⚠ skip ${t}: ${e.message?.slice(0, 100)}`);
    }
  }
}

function buildPlan(refs) {
  // ALF odds, SN evens — stages as specified.
  const plan = [
    { n: 1, last: 'One', division: 'ALF', stage: 'Lead Entry' },
    { n: 2, last: 'Two', division: 'Special Needs', stage: 'Lead Entry' },
    { n: 3, last: 'Three', division: 'ALF', stage: 'Intake' },
    { n: 4, last: 'Four', division: 'Special Needs', stage: 'Intake' },
    { n: 5, last: 'Five', division: 'ALF', stage: 'Authorization Pending' },
    { n: 6, last: 'Six', division: 'Special Needs', stage: 'Authorization Pending' },
    { n: 7, last: 'Seven', division: 'ALF', stage: 'Clinical Intake RN Review' },
    { n: 8, last: 'Eight', division: 'Special Needs', stage: 'Clinical Intake RN Review' },
    { n: 9, last: 'Nine', division: 'ALF', stage: 'Clinical Intake RN Review' },
    { n: 10, last: 'Ten', division: 'Special Needs', stage: 'Clinical Intake RN Review' },
    { n: 11, last: 'Eleven', division: 'ALF', stage: 'Clinical Intake RN Review' },
    { n: 12, last: 'Twelve', division: 'Special Needs', stage: 'Clinical Intake RN Review' },
  ];
  return plan.map((p) => ({
    ...p,
    marketerId: p.division === 'ALF' ? refs.mktAlf : refs.mktSn,
    facilityId: p.division === 'ALF' ? refs.facilityId : null,
    snAgeGroup: p.division === 'Special Needs' ? 'Adult' : null,
  }));
}

async function seedOne(row, refs, mockPaths, index) {
  const now = new Date().toISOString();
  const pat = makeIds('pat');
  // slight offset so ids differ when looping fast
  await new Promise((r) => setTimeout(r, 3));
  const ref = makeIds('ref');
  const isAlf = row.division === 'ALF';
  const isLead = row.stage === 'Lead Entry';
  const fill = !isLead;

  const dob = isAlf ? `194${index % 10}-0${(index % 8) + 1}-15` : `198${index % 10}-0${(index % 9) + 1}-20`;
  const zip = isAlf ? 11706 : 11219;
  const county = isAlf ? 'Suffolk' : 'Kings';
  const city = isAlf ? 'Bay Shore' : 'Brooklyn';
  const phone = `718-555-${String(1000 + index).slice(-4)}`;

  // Patient
  await exec(`
    INSERT INTO patients (
      rec_id, id, first_name, last_name, division, dob, gender,
      phone_primary, address_street, address_city, address_state, address_zip, county,
      medicaid_number, insurance_plan, insurance_id,
      emergency_contact_name, emergency_contact_phone, emergency_contact_email,
      is_active, created_at, updated_at
    ) VALUES (
      ${esc(pat.rec)}, ${esc(pat.biz)}, 'Test', ${esc(row.last)}, ${esc(row.division)},
      ${fill ? esc(dob) : 'NULL'}, ${fill ? esc(isAlf ? 'Female' : 'Male') : 'NULL'},
      ${fill || row.division === 'Special Needs' ? esc(phone) : 'NULL'},
      ${fill ? esc(`${100 + index} Mock Lane`) : 'NULL'},
      ${fill ? esc(city) : 'NULL'},
      ${fill ? "'NY'" : 'NULL'},
      ${fill ? zip : 'NULL'},
      ${fill || row.division === 'Special Needs' ? esc(county) : 'NULL'},
      ${fill ? esc(`MOCK${String(index).padStart(5, '0')}A`) : 'NULL'},
      ${fill ? esc(isAlf ? 'Fidelis Care' : 'Healthfirst') : 'NULL'},
      ${fill ? esc(`MEM${index}TEST`) : 'NULL'},
      ${fill ? esc('Pat Contact') : 'NULL'},
      ${fill ? esc(phone) : 'NULL'},
      ${fill ? esc(`test.${row.last.toLowerCase()}@example.com`) : 'NULL'},
      'TRUE', ${esc(now)}, ${esc(now)}
    )`);

  const services = isAlf ? '{SN}' : '{SN,PT}';
  const inClinical = row.stage === 'Clinical Intake RN Review';

  await exec(`
    INSERT INTO referrals (
      rec_id, id, patient_id, current_stage, division, priority,
      marketer_id, referral_source_id, facility_id, entity_id,
      sn_age_group, services_requested, code_95,
      referral_date, in_clinical_review,
      clinical_review_pushed_at,
      created_at, updated_at
    ) VALUES (
      ${esc(ref.rec)}, ${esc(ref.biz)}, ${esc(pat.biz)}, ${esc(row.stage)}, ${esc(row.division)}, 'Normal',
      ${esc(row.marketerId)}, ${esc(refs.sourceId)},
      ${row.facilityId ? esc(row.facilityId) : 'NULL'},
      ${refs.entityId ? esc(refs.entityId) : 'NULL'},
      ${row.snAgeGroup ? esc(row.snAgeGroup) : 'NULL'},
      '${services}',
      ${isAlf ? 'NULL' : "'yes'"},
      ${esc(now)},
      ${inClinical ? 'TRUE' : 'FALSE'},
      ${inClinical ? esc(now) : 'NULL'},
      ${esc(now)}, ${esc(now)}
    )`);

  // Stage history
  await exec(`
    INSERT INTO stage_history (rec_id, id, referral_id, from_stage, to_stage, changed_by_id, timestamp, created_at, updated_at)
    VALUES (
      ${esc(`recsh${rand(10)}`)}, ${esc(`sh_${Date.now()}_${rand(4)}`)},
      ${esc(ref.biz)}, NULL, ${esc(row.stage)},
      ${refs.userId ? esc(refs.userId) : 'NULL'},
      ${esc(now)}, ${esc(now)}, ${esc(now)}
    )`);

  if (!fill) {
    return { pat, ref, row };
  }

  // Insurance (patient_id is patient rec_id in this table)
  const ins = makeIds('ins');
  await exec(`
    INSERT INTO patient_insurances (
      rec_id, id, patient_id, payer_display_name, insurance_category, plan_name,
      member_id, order_rank, entered_from, is_active_raw, created_at, updated_at
    ) VALUES (
      ${esc(ins.rec)}, ${esc(ins.biz)}, ${esc(pat.rec)},
      ${esc(isAlf ? 'Fidelis Care' : 'Healthfirst')},
      ${esc(isAlf ? 'medicaid_managed' : 'medicaid')},
      ${esc(isAlf ? 'Fidelis Care' : 'Healthfirst')},
      ${esc(`MEM${index}TEST`)}, 'primary', 'seed', TRUE,
      ${esc(now)}, ${esc(now)}
    )`);

  // Auth pending patients get a pending authorization
  if (row.stage === 'Authorization Pending') {
    const auth = makeIds('auth');
    await exec(`
      INSERT INTO authorizations (
        rec_id, id, referral_id, patient_id, auth_status, status,
        request_initial_date, requested_by_user_id, created_at, updated_at
      ) VALUES (
        ${esc(auth.rec)}, ${esc(auth.biz)}, ${esc(ref.biz)}, ${esc(pat.biz)},
        'pending', 'Pending', ${esc(now)},
        ${refs.userId ? esc(refs.userId) : 'NULL'},
        ${esc(now)}, ${esc(now)}
      )`);
  }

  // SN triage (adult) for non-lead SN patients
  if (!isAlf) {
    const tri = makeIds('tri');
    await exec(`
      INSERT INTO triage_adult (
        rec_id, id, referral_id, filled_by_id, patient_name, dob, address,
        caregiver_name, caregiver_phone, services_needed, insurance_plan_name,
        medicaid_number, pcp_name, pcp_phone, created_at, updated_at
      ) VALUES (
        ${esc(tri.rec)}, ${esc(tri.biz)}, ${esc(ref.biz)},
        ${refs.userId ? esc(refs.userId) : 'NULL'},
        ${esc(`Test ${row.last}`)}, ${esc(dob)},
        ${esc(`${100 + index} Mock Lane, ${city}, NY ${zip}`)},
        'Care Giver', ${esc(phone)}, '{SN,PT}',
        'Healthfirst', ${esc(`MOCK${String(index).padStart(5, '0')}A`)},
        'Dr Mock PCP', '718-555-9999',
        ${esc(now)}, ${esc(now)}
      )`);
  }

  // Files — rotate the two mock PDFs
  if (mockPaths.f2f && mockPaths.facesheet) {
    const f2fUp = await uploadMockFile(pat.biz, mockPaths.f2f, 'mock_f2f_test.pdf');
    const faceUp = await uploadMockFile(pat.biz, mockPaths.facesheet, 'mock_facesheet_test.pdf');
    for (const [up, category] of [[f2fUp, 'F2F'], [faceUp, 'Other']]) {
      const f = makeIds('file');
      await exec(`
        INSERT INTO files (
          rec_id, id, patient_id, referral_id, uploaded_by_id,
          file_name, file_type, file_size, r2_key, category,
          created_at, updated_at
        ) VALUES (
          ${esc(f.rec)}, ${esc(f.biz)}, ${esc(pat.biz)}, ${esc(ref.biz)},
          ${refs.userId ? esc(refs.userId) : 'NULL'},
          ${esc(up.fileName)}, 'application/pdf', ${up.size}, ${esc(up.key)}, ${esc(category)},
          ${esc(now)}, ${esc(now)}
        )`);
    }
  }

  return { pat, ref, row };
}

async function main() {
  console.log(`Aurora mock reset → database=${database}`);
  const mode = !CONFIRM
    ? 'dry-run (no writes)'
    : PURGE_ONLY
      ? 'CONFIRM purge-only (no reseed)'
      : 'CONFIRM purge + seed';
  console.log(`MODE: ${mode}`);

  // Sanity: confirm keep-tables still have data (never wiped by this script).
  const keep = await Promise.all([
    count('users'), count('physicians'), count('referral_sources'),
    count('marketers'), count('facilities'), count('entities'),
  ]);
  console.log('\nKept tables (will NOT be touched):');
  console.log(`  users=${keep[0]} physicians=${keep[1]} referral_sources=${keep[2]} marketers=${keep[3]} facilities=${keep[4]} entities=${keep[5]}`);

  await purge();

  if (PURGE_ONLY) {
    if (!CONFIRM) {
      console.log('\nDry-run complete. Re-run with --confirm --purge-only to wipe patient graph.');
      return;
    }
    const patients = await query('SELECT count(*)::int AS n FROM patients');
    const referrals = await query('SELECT count(*)::int AS n FROM referrals');
    const files = await query('SELECT count(*)::int AS n FROM files');
    const triageA = await query('SELECT count(*)::int AS n FROM triage_adult');
    const triageP = await query('SELECT count(*)::int AS n FROM triage_pediatric');
    const users = await query('SELECT count(*)::int AS n FROM users');
    const physicians = await query('SELECT count(*)::int AS n FROM physicians');
    console.log('\n── Done (purge-only) ──');
    console.log(`  patients=${patients[0].n} referrals=${referrals[0].n} files=${files[0].n}`);
    console.log(`  triage_adult=${triageA[0].n} triage_pediatric=${triageP[0].n}`);
    console.log(`  users=${users[0].n} physicians=${physicians[0].n} (untouched)`);
    return;
  }

  const refs = await pickRefs();
  console.log('\nReference picks (kept intact):');
  console.log(`  ALF marketer: ${refs.mktAlf}`);
  console.log(`  SN marketer:  ${refs.mktSn}`);
  console.log(`  Source:       ${refs.sourceId}`);
  console.log(`  ALF facility: ${refs.facilityId} (${refs.facilityName})`);
  console.log(`  Entity:       ${refs.entityId}`);

  const f2fPath = process.env.MOCK_F2F_PATH
    || '/tmp/wb-mock-files/1784646022654_jgfjl4_mock_20f2f_20test.pdf';
  const facePath = process.env.MOCK_FACESHEET_PATH
    || '/tmp/wb-mock-files/1784646007313_82om7x_mock_facesheet_test.pdf';
  const mockPaths = {
    f2f: existsSync(f2fPath) ? f2fPath : null,
    facesheet: existsSync(facePath) ? facePath : null,
  };
  console.log('\nMock files:');
  console.log(`  F2F:       ${mockPaths.f2f || 'MISSING'}`);
  console.log(`  Facesheet: ${mockPaths.facesheet || 'MISSING'}`);
  if (!mockPaths.f2f || !mockPaths.facesheet) {
    console.warn('  ⚠ Mock PDFs missing — patients will seed without files.');
  }

  const plan = buildPlan(refs);
  console.log('\n── Seed plan (12) ──');
  for (const p of plan) {
    console.log(`  Test ${p.last.padEnd(8)} ${p.division.padEnd(14)} → ${p.stage}`);
  }

  if (!CONFIRM) {
    console.log('\nDry-run complete. Re-run with --confirm to purge + seed.');
    return;
  }

  console.log('\n── Seeding ──');
  const created = [];
  for (let i = 0; i < plan.length; i++) {
    const row = plan[i];
    const out = await seedOne(row, refs, mockPaths, i + 1);
    created.push(out);
    console.log(`  ✓ Test ${row.last} (${row.division}) @ ${row.stage}  ${out.pat.biz}`);
  }

  const patients = await query('SELECT count(*)::int AS n FROM patients');
  const referrals = await query('SELECT count(*)::int AS n FROM referrals');
  const byStage = await query(`
    SELECT current_stage, division, count(*)::int AS n
    FROM referrals GROUP BY 1, 2 ORDER BY 1, 2`);
  console.log('\n── Done ──');
  console.log(`  patients=${patients[0].n} referrals=${referrals[0].n}`);
  for (const r of byStage) console.log(`  ${r.current_stage} / ${r.division}: ${r.n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
