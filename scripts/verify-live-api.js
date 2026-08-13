#!/usr/bin/env node
/**
 * Live Aurora API read/write smoke test. Reversible only:
 *  - PATCHes copy existing field values back onto the same row
 *  - CREATE rows are tagged verify_* and DELETED before exit
 * Never mutates patient/referral business state.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
}

const API = process.env.VITE_API_URL.replace(/\/$/, '');
const KEY = process.env.WB_INTERNAL_KEY;
const H = {
  'x-internal-key': KEY,
  'x-internal-caller': 'live-verify',
  'Content-Type': 'application/json',
};

const HYDRATE_TABLES = [
  'Patients', 'Referrals', 'Notes', 'Tasks', 'StageHistory', 'Files',
  'InsuranceChecks', 'Conflicts', 'ConflictCategories', 'Authorizations',
  'DisenrollmentAssistanceFlags', 'Episodes', 'TriageAdult', 'TriagePediatric',
  'CursoryReview', 'ClinicalReview', 'OPWDDEligibilityCases', 'OPWDDCaseChecklistItems',
  'Entities', 'Marketers', 'Users', 'ReferralSources', 'Roles', 'Facilities',
  'Physicians', 'KnownGuardians', 'PatientGuardians', 'Campaigns',
  'MarketerFacilities', 'CampaignMarketers', 'Permissions', 'PermissionPresets',
  'UserPermissions', 'Languages', 'UserLanguages', 'IssueReports',
  'CocNurseFacilities', 'InboundSubmissions', 'InboundSubmissionAttachments',
  'InboundSubmissionEvents', 'NetworkFacilities', 'Departments',
  'DepartmentScopes', 'ActivityLog',
];

const PREVIOUSLY_DROPPED_REFERRAL_FIELDS = [
  'account_manager_info', 'auth_obtained_at', 'auth_obtained_by_id',
  'clinical_review_assigned_at', 'clinical_review_assigned_by_id',
  'clinical_review_assigned_to_id', 'clinical_review_pushed_by_id',
  'coc_nurse_id', 'documentation_cleared_at', 'documentation_cleared_by_id',
  'documentation_deferred', 'documentation_deferred_at', 'documentation_deferred_by_id',
  'documentation_due_date', 'emr_initial_onboarded_at', 'emr_initial_onboarded_by_id',
  'episode_type', 'f2f_date_logged_at', 'f2f_date_logged_by_id',
  'intake_owner_changed_at', 'intake_owner_changed_by_id', 'lead_created_by_id',
  'referral_method', 'urgent_care_type',
];

const fail = [];
const ok = [];
function pass(msg) { ok.push(msg); console.log('  OK  ' + msg); }
function bad(msg) { fail.push(msg); console.log('  FAIL ' + msg); }

async function req(method, path, body) {
  const res = await fetch(API + '/internal' + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

const created = []; // { table, id } to delete on the way out

async function cleanup() {
  for (const row of created.reverse()) {
    const r = await req('DELETE', `/${row.table}/${row.id}`);
    if (r.status !== 200) {
      console.log(`  WARN cleanup DELETE ${row.table}/${row.id} → ${r.status} ${r.text.slice(0, 120)}`);
    }
  }
}

try {
  console.log('1. Boot hydrate (same table list the app loads)');
  const hyd = await req('POST', '/hydrate', { tables: HYDRATE_TABLES });
  if (hyd.status !== 200) {
    bad(`hydrate HTTP ${hyd.status}: ${hyd.text.slice(0, 200)}`);
  } else {
    const tables = hyd.json.tables || hyd.json;
    const missing = HYDRATE_TABLES.filter((t) => !tables[t]);
    if (missing.length) bad('hydrate missing tables: ' + missing.join(', '));
    else {
      const patients = tables.Patients?.records?.length ?? 0;
      const referrals = tables.Referrals?.records?.length ?? 0;
      pass(`hydrate 200 — Patients=${patients} Referrals=${referrals} tables=${HYDRATE_TABLES.length}`);
      if (patients === 0) bad('Patients count is 0 — names would show as IDs');
      if (referrals === 0) bad('Referrals count is 0 — pipeline would look empty');
    }

    const refRec = tables.Referrals?.records?.[0];
    if (refRec) {
      const present = PREVIOUSLY_DROPPED_REFERRAL_FIELDS.filter((f) => f in (refRec.fields || {}));
      pass(`sample referral exposes ${present.length} of the previously-dropped fields when populated`);
      if (!('episode_type' in (refRec.fields || {})) && !refRec.fields?.episode_type) {
        // episode_type may simply be empty on this row — not a failure
      }
    }
  }

  console.log('\n2. Per-table GET (every hydrate table + Notifications)');
  for (const t of [...HYDRATE_TABLES, 'Notifications']) {
    const r = await req('GET', `/${t}?maxRecords=1`);
    if (r.status !== 200) bad(`GET ${t} → HTTP ${r.status} ${r.text.slice(0, 140)}`);
    else pass(`GET ${t}`);
  }

  console.log('\n3. Referral write — PATCH previously-dropped fields with THEIR CURRENT values (no-op)');
  const list = await req('GET', '/Referrals?maxRecords=5');
  if (list.status !== 200 || !list.json.records?.length) {
    bad('could not load a referral for write probe');
  } else {
    const rec = list.json.records.find((r) => r.fields?.episode_type) || list.json.records[0];
    const fields = {};
    for (const f of PREVIOUSLY_DROPPED_REFERRAL_FIELDS) {
      if (rec.fields[f] !== undefined) fields[f] = rec.fields[f];
    }
    fields.intake_owner_changed_at = rec.fields.intake_owner_changed_at || rec.fields.updated_at || rec.createdTime;
    fields.intake_owner_changed_by_id = rec.fields.intake_owner_changed_by_id || rec.fields.intake_owner_id || rec.fields.lead_created_by_id || 'verify_noop';
    // Revert the two we may have invented if they were not already set
    const inventedAt = !rec.fields.intake_owner_changed_at;
    const inventedBy = !rec.fields.intake_owner_changed_by_id;

    const patch = await req('PATCH', `/Referrals/${rec.id}`, { fields });
    if (patch.status !== 200) {
      bad(`PATCH Referrals dropped-fields → HTTP ${patch.status} ${patch.text.slice(0, 200)}`);
    } else {
      pass(`PATCH Referrals accepted ${Object.keys(fields).length} previously-dropped fields`);
      if (inventedAt || inventedBy) {
        const revert = {};
        if (inventedAt) revert.intake_owner_changed_at = null;
        if (inventedBy) revert.intake_owner_changed_by_id = null;
        const back = await req('PATCH', `/Referrals/${rec.id}`, { fields: revert });
        if (back.status !== 200) bad(`revert invented owner-change stamps → ${back.status} ${back.text.slice(0, 160)}`);
        else pass('reverted invented intake_owner_changed_* stamps to null');
      }
    }
  }

  console.log('\n4. IssueReports create → read → delete');
  const issId = `iss_verify_${Date.now()}`;
  const iss = await req('POST', '/IssueReports', {
    fields: {
      id: issId,
      user_id: 'verify_script',
      report_type: 'bug',
      description: 'LIVE VERIFY — delete immediately. Not a real ticket.',
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
  if (iss.status !== 200 || !iss.json?.id) {
    bad(`POST IssueReports → HTTP ${iss.status} ${iss.text.slice(0, 200)}`);
  } else {
    created.push({ table: 'IssueReports', id: iss.json.id });
    pass(`POST IssueReports ${iss.json.id}`);
    const got = await req('GET', `/IssueReports/${iss.json.id}`);
    if (got.status !== 200) bad(`GET created IssueReport → ${got.status}`);
    else pass('GET created IssueReport');
  }

  console.log('\n5. ReferralSources create (with method) → read → delete');
  const srcBiz = `src_verify_${Date.now()}`;
  const src = await req('POST', '/ReferralSources', {
    fields: {
      id: srcBiz,
      name: 'VERIFY DELETE ME',
      type: 'Other',
      method: 'Word of Mouth',
      is_active: 'true',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
  if (src.status !== 200 || !src.json?.id) {
    bad(`POST ReferralSources → HTTP ${src.status} ${src.text.slice(0, 200)}`);
  } else {
    created.push({ table: 'ReferralSources', id: src.json.id });
    pass(`POST ReferralSources ${src.json.id} method=${src.json.fields?.method}`);
    if (src.json.fields?.method !== 'Word of Mouth') {
      bad('created source did not persist method');
    }
    const got = await req('GET', `/ReferralSources/${src.json.id}`);
    if (got.status !== 200) bad(`GET created ReferralSource → ${got.status}`);
    else pass('GET created ReferralSource');
  }

  console.log('\n6. Files archive-field write (null no-op) then confirm still unarchived');
  const files = await req('GET', '/Files?maxRecords=1');
  if (files.status !== 200 || !files.json.records?.length) {
    bad('could not load a file for archive-field probe');
  } else {
    const f = files.json.records[0];
    const wasArchived = !!f.fields.archived_at;
    const patch = await req('PATCH', `/Files/${f.id}`, {
      fields: {
        archived_at: f.fields.archived_at || null,
        archived_by_id: f.fields.archived_by_id || null,
        archived_reason: f.fields.archived_reason || null,
      },
    });
    if (patch.status !== 200) {
      bad(`PATCH Files archive fields → HTTP ${patch.status} ${patch.text.slice(0, 200)}`);
    } else {
      const still = !!patch.json.fields?.archived_at;
      if (still !== wasArchived) bad('file archive state changed unexpectedly');
      else pass(`PATCH Files archive fields accepted (archived stayed ${wasArchived})`);
    }
  }

  console.log('\n7. Patients read — names present');
  const pats = await req('GET', '/Patients?maxRecords=3');
  if (pats.status !== 200) bad(`GET Patients → ${pats.status} ${pats.text.slice(0, 160)}`);
  else {
    const named = (pats.json.records || []).filter((r) => r.fields?.first_name || r.fields?.last_name);
    if (!named.length) bad('Patients returned but no first/last names on sample');
    else pass(`Patients names ok e.g. ${named[0].fields.first_name} ${named[0].fields.last_name}`);
  }
} catch (err) {
  bad('script error: ' + err.message);
} finally {
  console.log('\n8. Cleanup created verify rows');
  await cleanup();
  const leftover = [];
  for (const row of created) {
    const r = await req('GET', `/${row.table}/${row.id}`);
    if (r.status === 200) leftover.push(`${row.table}/${row.id}`);
  }
  if (leftover.length) bad('cleanup leftover: ' + leftover.join(', '));
  else pass('all verify rows deleted');
}

console.log('\n==========');
console.log(`PASS ${ok.length}   FAIL ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log('  • ' + f);
  process.exit(1);
}
console.log('Live read/write verified. Staff can continue working.');
