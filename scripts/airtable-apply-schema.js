#!/usr/bin/env node
/**
 * Airtable Schema Apply Script (idempotent)
 *
 * Reads current schema from the Meta API, diffs against DESIRED_PLAN,
 * and applies only what's missing:
 *   - Creates tables that don't exist
 *   - Adds fields that don't exist on existing tables
 *   - Adds new choices to existing singleSelect fields (never removes)
 *   - Seeds Permissions rows whose `key` doesn't already exist
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-apply-schema.js
 *   # or just rely on careStream/.env and run `npm run schema:apply`
 *
 * Dry run (no writes, just prints plan):
 *   node scripts/airtable-apply-schema.js --dry-run
 *
 * Requires PAT scopes: schema.bases:read, schema.bases:write, data.records:read, data.records:write
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
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

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
const DRY_RUN = process.argv.includes('--dry-run');

if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID');
  process.exit(1);
}

// ---------- HTTP helpers ----------
const META = `https://api.airtable.com/v0/meta/bases/${BASE_ID}`;
const DATA = `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, url, body) {
  if (DRY_RUN && method !== 'GET') {
    console.log(`[dry-run] ${method} ${url}`);
    if (body) console.log(`           body: ${JSON.stringify(body).slice(0, 300)}`);
    return { __dryRun: true };
  }
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  await sleep(220); // keep under 5 req/sec
  return text ? JSON.parse(text) : {};
}

// ---------- Field helpers ----------
const DT_OPTS = {
  dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
  timeFormat: { name: '24hour', format: 'HH:mm' },
  timeZone: 'client',
};
const CHECK_OPTS = { icon: 'check', color: 'greenBright' };

const t = {
  text: (name) => ({ name, type: 'singleLineText' }),
  longText: (name) => ({ name, type: 'multilineText' }),
  email: (name) => ({ name, type: 'email' }),
  phone: (name) => ({ name, type: 'phoneNumber' }),
  dateTime: (name) => ({ name, type: 'dateTime', options: DT_OPTS }),
  check: (name) => ({ name, type: 'checkbox', options: CHECK_OPTS }),
  int: (name) => ({ name, type: 'number', options: { precision: 0 } }),
  single: (name, choices) => ({
    name,
    type: 'singleSelect',
    options: { choices: choices.map((c) => ({ name: c })) },
  }),
  multi: (name, choices) => ({
    name,
    type: 'multipleSelects',
    options: { choices: choices.map((c) => ({ name: c })) },
  }),
  // multipleRecordLinks. `linkedTableName` is resolved to a table id at apply
  // time so we don't have to hard-code Airtable's tblXXX values into source.
  // `singleLink` mirrors `prefersSingleRecordLink` for parity with how the
  // UI surfaces the field (true ⇒ one chip / link per row).
  // NOTE on the Meta-API quirks for multipleRecordLinks on field creation:
  // The endpoint accepts ONLY `linkedTableId` in `options` — every other
  // option (`isReversed`, `prefersSingleRecordLink`, `inverseLinkFieldId`)
  // triggers `INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE`. Airtable will manage
  // those internally; if a single-link preference is needed, set it via
  // the UI (the API does not expose it on create or patch as of 2026-05).
  // We keep the `singleLink` arg in the signature so callers can document
  // intent at the call site even though it's not applied at creation.
  // eslint-disable-next-line no-unused-vars
  link: (name, linkedTableName, { singleLink = true } = {}) => ({
    name,
    type: 'multipleRecordLinks',
    __linkedTableName: linkedTableName,
    options: {},
  }),
};

// ---------- Enums / constants ----------
const OPWDD_CASE_STATUS = [
  'not_started',
  'outreach_in_progress',
  'awaiting_initial_docs',
  'evaluations_pending',
  'packet_ready',
  'submitted_to_cco',
  'eligibility_determined',
  'monitoring_code_95',
  'code_95_received',
  'converted_to_intake',
  'closed',
  'cancelled',
];

const OPWDD_SUB_STATUS = [
  'pcg_not_interested',
  'aba_only_referral',
  'docs_incomplete',
  'awaiting_psych_eval',
  'awaiting_psychosocial',
  'awaiting_notice_letter',
  'awaiting_code_95',
  'none',
];

const OPWDD_CLOSED_REASON = [
  'converted_to_intake',
  'pcg_declined',
  'aba_only',
  'duplicate',
  'not_eligible',
  'lost_to_follow_up',
  'withdrawn',
  'other',
];

const EVAL_STATUS = ['not_needed', 'needed', 'scheduled', 'received', 'expired', 'accepted'];

const SUBMISSION_METHOD = ['email', 'portal', 'fax', 'other'];
const ELIGIBILITY_DETERMINATION = ['pending', 'eligible', 'ineligible', 'unknown'];
const NOTICE_METHOD = ['mail', 'email', 'upload', 'verbal', 'unknown'];

const SERVICE_TYPES_OPWDD = ['HHA', 'OT', 'PT', 'ST', 'SN'];

const REQUIREMENT_KEYS = [
  'previous_psychological_evaluation',
  'social_history_report',
  'iep_latest',
  'iep_prior',
  'early_intervention_documents',
  'specialist_letter',
  'medical_form',
  'insurance_card',
  'social_security_card',
  'birth_certificate',
  'passport',
  'state_id',
  'updated_psychological_evaluation',
  'updated_psychosocial_evaluation',
  'eligibility_notice_letter',
];

const CHECKLIST_STATUS = [
  'missing',
  'requested',
  'received',
  'under_review',
  'accepted',
  'rejected',
  'expired',
  'waived',
];

const OPWDD_HANDOFF_STATUS = ['not_applicable', 'in_progress', 'ready_for_intake', 'handed_off'];

const OPWDD_FILE_CATEGORIES = [
  'OPWDD',
  'OPWDD Evaluation',
  'OPWDD Identity',
  'OPWDD Insurance',
  'OPWDD Notice',
];

const OPWDD_TASK_TYPES = [
  'OPWDD Outreach',
  'OPWDD Missing Document',
  'OPWDD Evaluation',
  'OPWDD Submission',
  'OPWDD Code 95 Monitoring',
];

// ── Triage v2 (2026-05-27) ──────────────────────────────────────────────────
// Triage forms rebuild per careStream/triage_forms_spec.md. OPWDD on the form
// now has THREE states (not the old Yes/No code_95). OPWDD Pending is the
// state that routes a referral into the OPWDD Enrollment module — the other
// two stay in the normal pipeline.
const OPWDD_TRIAGE_STATUS = ['OPWDD Eligible', 'OPWDD Pending', 'Non-OPWDD'];

const CCO_NAMES = [
  'Advance Care Alliance (ACA/NY)',
  'Care Design NY',
  'Tri-County Care',
];

// Adult triage's existing `services_needed` multi-select needs HHA added per
// the new spec. SN remains in the choice list for historical records but is
// no longer offered in the new UI.
const ADULT_SERVICES_NEEDED_NEW = ['HHA'];

// ── IT Ticketing (support.wellboundcarestream.com) ──────────────────────────
// New ticketing system sharing this base + the existing `Users` table. See
// Support/support/spec-guide.MD. Routing (Categories → Teams) is data, not
// code, so adding/re-routing a category is an Airtable row edit, not a deploy.
const TICKET_STATUS = ['Unaddressed', 'In Progress', 'Resolved'];
const TICKET_PARTICIPANT_RELATIONSHIP = ['manager', 'supervisor', 'subordinate', 'other'];
const EMAIL_LOG_STATUS = ['queued', 'sent', 'failed'];

// ---------- Desired plan ----------
const DESIRED_TABLES = [
  {
    // Admin-managed conflict category list (the structured reasons staff pick
    // when routing a referral to Conflict). The app falls back to built-in
    // defaults when this table is empty, so creating it is safe & additive.
    name: 'ConflictCategories',
    description: 'Editable list of conflict categories surfaced in the conflict pickers. Managed in Admin → Conflict Categories.',
    fields: [
      t.text('id'), // primary — e.g. cc_<timestamp>
      t.text('value'), // stable snake_case code stored on Conflicts.type
      t.text('label'), // human-facing label
      t.int('sort_order'),
      t.check('is_active'),
      t.dateTime('created_at'),
      t.dateTime('updated_at'),
    ],
  },
  {
    name: 'OPWDDEligibilityCases',
    description: 'One row per OPWDD eligibility attempt for a referral.',
    fields: [
      t.longText('id'), // primary
      t.text('patient_id'),
      t.text('referral_id'),
      t.single('status', OPWDD_CASE_STATUS),
      t.single('sub_status', OPWDD_SUB_STATUS),
      t.text('assigned_enrollment_specialist_id'),
      t.dateTime('opened_at'),
      t.dateTime('closed_at'),
      t.single('closed_reason', OPWDD_CLOSED_REASON),
      t.text('pcg_contact_name'),
      t.phone('pcg_contact_phone'),
      t.email('pcg_contact_email'),
      t.text('pcg_relationship_to_patient'),
      t.check('pcg_willing_to_apply'),
      t.check('pcg_interested_in_wellbound_services'),
      t.multi('interested_services', SERVICE_TYPES_OPWDD),
      t.check('aba_only_referral'),
      t.text('article16_clinic_name'),
      t.check('psychological_eval_required'),
      t.single('psychological_eval_status', EVAL_STATUS),
      t.dateTime('psychological_eval_scheduled_for'),
      t.dateTime('psychological_eval_received_at'),
      t.dateTime('psychological_eval_valid_through'),
      t.check('psychosocial_required'),
      t.single('psychosocial_status', EVAL_STATUS),
      t.dateTime('psychosocial_scheduled_for'),
      t.dateTime('psychosocial_received_at'),
      t.dateTime('psychosocial_valid_through'),
      t.text('cco_id'),
      t.text('cco_name_snapshot'),
      t.dateTime('submission_sent_at'),
      t.text('submission_sent_by_id'),
      t.single('submission_method', SUBMISSION_METHOD),
      t.text('submission_confirmation_number'),
      t.single('eligibility_determination', ELIGIBILITY_DETERMINATION),
      t.dateTime('eligibility_determined_at'),
      t.dateTime('notice_received_at'),
      t.single('notice_received_method', NOTICE_METHOD),
      t.dateTime('code_95_monitoring_started_at'),
      t.dateTime('expected_code_95_window_start'),
      t.dateTime('expected_code_95_window_end'),
      t.dateTime('code_95_received_at'),
      t.dateTime('converted_to_intake_at'),
      t.text('converted_by_id'),
      t.longText('intake_handoff_note'),
      t.single('latest_blocker', OPWDD_SUB_STATUS),
      t.longText('latest_blocker_note'),
      t.dateTime('created_at'),
      t.dateTime('updated_at'),
    ],
  },
  {
    name: 'OPWDDCaseChecklistItems',
    description: 'Per-requirement checklist rows for an OPWDD eligibility case.',
    fields: [
      t.longText('id'), // primary
      t.text('opwdd_case_id'),
      t.text('patient_id'),
      t.text('referral_id'),
      t.single('requirement_key', REQUIREMENT_KEYS),
      t.text('requirement_label'),
      t.check('is_required'),
      t.single('status', CHECKLIST_STATUS),
      t.dateTime('requested_at'),
      t.text('requested_by_id'),
      t.dateTime('received_at'),
      t.text('received_by_id'),
      t.dateTime('reviewed_at'),
      t.text('reviewed_by_id'),
      t.dateTime('expires_at'),
      t.check('is_current'),
      t.text('satisfying_file_id'),
      t.longText('notes'),
      t.int('sort_order'),
      t.dateTime('created_at'),
      t.dateTime('updated_at'),
    ],
  },
  // ── ClinicalReview (2026-05-27) ───────────────────────────────────────────
  // One row per referral capturing the Clinical Intake RN's pre-confirmation
  // checklist responses + working decision/auth-required state. The final
  // immutable accept/conditional decision still lives on
  // `Referrals.clinical_review_decision`; this table holds the in-progress
  // working state so a user can step away and resume without losing work.
  // Column names mirror the UI keys in src/data/clinicalChecklist.js — keep
  // the two in lock-step.
  {
    name: 'ClinicalReview',
    description: 'Per-referral RN checklist responses + working decision state.',
    fields: [
      t.text('id'), // primary
      t.link('referral_id', 'Referrals'),
      t.longText('reviewed_by'),
      t.single('decision', ['accept', 'conditional']),
      t.check('auth_required'),
      // Checklist columns — must stay in sync with CLINICAL_CHECKLIST in
      // src/data/clinicalChecklist.js. Adding a new item: add it there with
      // a matching dbField, append the corresponding t.check below, and
      // re-run `npm run schema:apply`.
      t.check('dx_reviewed'),
      t.check('comorbidities'),
      t.check('hospitalization'),
      t.check('skilled_need'),
      t.check('homebound'),
      t.check('physician_cert'),
      t.check('medical_necessity'),
      t.check('med_list'),
      t.check('high_risk_meds'),
      t.check('allergies'),
      t.check('safety_risks'),
      t.check('loc_sn'),
      t.check('loc_pt'),
      t.check('loc_ot'),
      t.check('loc_st'),
      t.check('loc_hha'),
      t.check('risk_high'),
      t.check('risk_moderate'),
      t.check('risk_low'),
      t.check('soc_timeframe'),
      t.check('scheduling_needs'),
      t.check('clinician_match'),
    ],
  },

  // ── IT Ticketing tables (support.wellboundcarestream.com) ──────────────────
  // Single-base reuse: these live alongside CareStream and reference the
  // existing `Users` table via real Airtable links. Per spec-guide §1, routing
  // is modeled as data (Teams + Categories) rather than hardcoded.
  {
    name: 'Teams',
    description: 'Ticket routing destinations (In-house IT, ID Tech, HR, Dataphone) and their email rules. Seed once.',
    fields: [
      t.text('id'), // primary — app-generated (e.g. team_001)
      t.text('name'),
      t.email('primary_email'),
      t.check('cc_support'),       // also CC support@wellboundhc.com?
      t.check('active'),
    ],
  },
  {
    name: 'Categories',
    description: 'Create-ticket dropdown options; each links to a Team. Add/rename/re-route = edit a row (no deploy).',
    fields: [
      t.text('id'), // primary — app-generated (e.g. cat_001)
      t.text('name'),
      t.link('team_id', 'Teams'),   // routing destination
      t.int('sort_order'),
      t.check('active'),
    ],
  },
  {
    name: 'Tickets',
    // Design rule: the DB stores values, it does not compute them. So
    // `ticket_number` is a plain number the APP increments (mirroring the
    // worker's getNextUserId usr_xxx pattern) rather than an Airtable
    // Autonumber, and every timestamp is a plain dateTime the app writes on
    // insert rather than a Created-time field. No Meta-API limitations either,
    // since none of these are computed Airtable field types.
    description: 'IT support tickets. ticket_number + timestamps are generated by the app/UI and stored here as plain values.',
    fields: [
      t.text('id'), // primary — app-generated (e.g. tkt_0001)
      t.int('ticket_number'),      // app-incremented human key (e.g. 42 -> display WB-00042)
      t.link('requester_id', 'Users'),
      t.link('category_id', 'Categories'),
      t.longText('details'),
      t.text('contact_number'),    // extension or cell (text, not phone, to allow extensions)
      t.single('status', TICKET_STATUS),  // default Unaddressed on create
      t.dateTime('created_at'),
      t.dateTime('resolved_at'),
      t.dateTime('last_activity_at'),
    ],
  },
  {
    name: 'TicketParticipants',
    description: 'Join table: extra people added to a ticket (manager/supervisor/etc.). Feeds the email CC list.',
    fields: [
      t.text('id'), // primary
      t.link('ticket_id', 'Tickets'),
      t.link('user_id', 'Users'),
      t.single('relationship', TICKET_PARTICIPANT_RELATIONSHIP),
      t.link('added_by_id', 'Users'),
      t.dateTime('added_at'),
    ],
  },
  {
    name: 'TicketAssignments',
    description: 'Join table: which support staff are working a ticket (insert a row on status -> In Progress).',
    fields: [
      t.text('id'), // primary
      t.link('ticket_id', 'Tickets'),
      t.link('user_id', 'Users'),   // support staff
      t.dateTime('assigned_at'),
    ],
  },
  {
    name: 'Posts',
    description: 'Messages / follow-ups on a ticket. Each insert fires email routing and bumps Tickets.last_activity_at.',
    fields: [
      t.text('id'), // primary
      t.link('ticket_id', 'Tickets'),
      t.link('author_id', 'Users'),
      t.longText('body'),
      t.dateTime('created_at'),
    ],
  },
  {
    name: 'Attachments',
    // Store the R2 object KEY, not the URL (Airtable richText mangles URLs —
    // the CareStream lesson). Reconstruct pub-...r2.dev/{key} at read time.
    // R2 key prefix: Tickets/{ticket_number}/...
    description: 'Ticket screenshots/files in R2. Stores the object key (not URL); reconstruct the public URL client-side.',
    fields: [
      t.text('id'), // primary
      t.link('ticket_id', 'Tickets'),     // required
      t.link('post_id', 'Posts'),         // nullable — set when it arrived on a follow-up
      t.text('r2_object_key'),
      t.text('file_name'),
      t.text('content_type'),
      t.int('size_bytes'),
      t.link('uploaded_by_id', 'Users'),
      t.dateTime('uploaded_at'),
    ],
  },
  {
    name: 'EmailLog',
    description: 'One row per outbound ticket email — deliverability debugging, resend, and audit trail.',
    fields: [
      t.text('id'), // primary
      t.link('ticket_id', 'Tickets'),
      t.link('post_id', 'Posts'),         // nullable
      t.longText('to_addrs'),
      t.longText('cc_addrs'),
      t.text('subject'),
      t.single('status', EMAIL_LOG_STATUS),
      t.text('provider_message_id'),
      t.dateTime('created_at'),
    ],
  },
];

const DESIRED_NEW_FIELDS = {
  // ── IT Ticketing (support.wellboundcarestream.com) ────────────────────────
  // One new flag on the shared Users table — true = sees the staff console,
  // can change ticket status and self-assign. Intentionally NOT overloading
  // CareStream's role_id (spec-guide §3 / §9).
  Users: [
    t.check('is_support_staff'),
  ],
  Referrals: [
    t.text('active_opwdd_case_id'),
    t.dateTime('opwdd_route_started_at'),
    t.text('opwdd_route_started_by_id'),
    t.check('opwdd_conversion_ready'),
    t.single('opwdd_handoff_status', OPWDD_HANDOFF_STATUS),

    // ── Stage workflow overhaul (2026-05-20) ────────────────────────────────
    // Concurrent presence in Clinical Intake RN Review while still in Intake.
    t.check('in_clinical_review'),
    t.dateTime('clinical_review_pushed_at'),
    t.dateTime('clinical_review_completed_at'),
    t.text('clinical_review_completed_by_id'),
    // Concurrent presence: Eligibility completion timestamp; participates in
    // the LIFO trigger that flips current_stage to Staffing Feasibility when
    // BOTH clinical and eligibility have completed.
    t.dateTime('eligibility_completed_at'),
    t.text('eligibility_completed_by_id'),
    // Eligibility → Intake send-back (with required note flag).
    t.dateTime('eligibility_returned_to_intake_at'),
    t.longText('eligibility_returned_to_intake_note'),
    t.text('eligibility_returned_to_intake_by_id'),
    // Urgent care / pre-assessment indicator.
    t.check('requires_urgent_care'),
    t.dateTime('urgent_care_marked_at'),
    t.text('urgent_care_marked_by_id'),
    t.longText('urgent_care_note'),
  ],
  Conflicts: [
    // Captured at creation so resolve actions know which module to return to.
    t.longText('source_stage'),
  ],
  Files: [
    t.text('opwdd_case_id'),
    t.single('document_subtype', REQUIREMENT_KEYS),
    t.dateTime('document_date'),
    t.dateTime('document_valid_through'),
    t.text('verified_current_by_id'),
    t.dateTime('verified_current_at'),
    // Link an uploaded auth letter to a specific Authorizations row.
    t.text('authorization_id'),
  ],
  Tasks: [
    t.text('opwdd_case_id'),
    // Optional physician association for the new universal TaskComposer.
    // Stored as a free-text business id (mirrors the patient_id / referral_id
    // pattern on this table) so we don't have to introduce a multipleRecordLink
    // here. The id matches Physicians.id (e.g. `phy_xxx`).
    t.text('physician_id'),
  ],
  ActivityLog: [
    t.text('opwdd_case_id'),
  ],

  // ── Triage v2 (2026-05-27) ────────────────────────────────────────────────
  // All triage tables are extended in place; the existing columns
  // (caregiver_name, homecare_hours/days, is_diabetic, etc.) stay so existing
  // records remain readable. The new form writes the new columns going
  // forward — see src/components/patient/tabs/TriageTab.jsx and
  // src/utils/triageCompleteness.js.
  TriageAdult: [
    t.single('opwdd_status', OPWDD_TRIAGE_STATUS),
    t.text('insurance_plan_name'),
    t.text('medicaid_number'),
    t.text('patient_name'),
    t.dateTime('dob'),
    t.longText('address'),
    t.email('email'),
    t.text('add_secondary_caregiver'),
    t.text('secondary_caregiver_name'),
    t.text('secondary_caregiver_phone'),
    t.text('has_smoking'),
    t.longText('homecare_hours_days'),
    t.text('has_in_home_therapies'),
    t.longText('current_therapy_services'),
    t.longText('hha_hours_frequency'),
    t.longText('health_conditions'),
    t.text('pcp_npi_number'),
    // Link the PCP picked in triage back to the Physicians directory record so
    // the physician is universalized across referral → triage → snapshot.
    t.text('pcp_physician_id'),
    t.single('cco_name', CCO_NAMES),
    t.text('cm_fax'),
    t.email('cm_email'),
  ],
  TriagePediatric: [
    t.single('opwdd_status', OPWDD_TRIAGE_STATUS),
    t.text('medicaid_number'),
    t.text('primary_caregiver_name'),
    t.text('primary_caregiver_phone'),
    t.text('add_secondary_caregiver'),
    t.text('secondary_caregiver_name'),
    t.text('secondary_caregiver_phone'),
    t.text('emergency_same_as_primary'),
    t.text('emergency_contact_name'),
    t.text('emergency_contact_phone'),
    t.email('email'),
    t.text('patient_name'),
    t.dateTime('dob'),
    t.longText('address'),
    t.text('has_smoking'),
    t.longText('homecare_hours_days'),
    t.longText('health_conditions'),
    // Link the PCP picked in triage back to the Physicians directory record.
    t.text('pcp_physician_id'),
    t.single('cco_name', CCO_NAMES),
    t.text('cm_fax'),
    t.email('cm_email'),
  ],

  // ── Physician verification (NPI / PECOS / Order & Referring) ─────────────
  // `npi`, `is_pecos_enrolled`, `is_opra_enrolled`, `pecos_last_checked` already
  // exist; these add the NPI status, OPRA timestamp, and audit metadata written
  // in one shot by the one-click verification (see src/api/cms.js).
  Physicians: [
    t.single('npi_status', ['active', 'deactivated', 'not_found']),
    t.dateTime('npi_checked_at'),
    t.text('npi_provider_name'),
    t.longText('npi_details'),           // JSON: NPPES basic record (expandable detail panel)
    t.dateTime('opra_last_checked'),
    t.longText('order_refer_flags'),     // JSON: { PARTB, DME, HHA, HOSPICE, PMD }
    t.dateTime('verification_last_run_at'),
    t.text('verification_checked_by_id'),
  ],

  // ── EligibilityVerifications.insurance_id repair (2026-05-27) ────────────
  // The legacy `insurance_id` multipleRecordLinks field on this table was
  // wired to `PatientInsurancePlans` (an older catalog table), but every
  // caller now writes from `PatientInsurances` (the canonical patient
  // insurance table). Airtable rejects those writes with:
  //   Record ID rec... belongs to table tblg7s0UuWsN99367,
  //   but the field links to table tblBGbuHgt54oaDbS
  // We can't relink an existing field via the Meta API, so we add a NEW
  // canonical link field — `patient_insurance_id` → PatientInsurances —
  // and switch all reads/writes to it. The old field is left in place so
  // any historical rows referenced from the legacy table remain readable;
  // new writes ignore it.
  EligibilityVerifications: [
    t.link('patient_insurance_id', 'PatientInsurances'),
  ],

  // ── Authorization redesign (2026-06) ─────────────────────────────────────
  // One Authorizations row per insurance "response". Per-service decisions and
  // the follow-up log are stored as JSON so a single row carries multiple
  // disciplines (PT approved, ST denied) without a child table. The existing
  // status/unit columns remain for back-compat + the module-queue rollup.
  Authorizations: [
    t.longText('service_lines'),          // JSON: [{ service, decision, visit_limit, unit_type, approval_received_date, note }]
    t.single('coverage_status', ['active', 'inactive']),
    t.text('payer_type'),                 // staff-confirmed INSURANCE_CATEGORY value
    t.single('payer_order', ['primary', 'secondary', 'tertiary', 'informational']),
    t.longText('sources_checked'),        // JSON array of verification source codes
    t.dateTime('request_initial_date'),   // Initial Date Requested
    t.text('request_requested_from'),     // Requested from
    t.check('request_docs_sent'),         // Sent requested documentation to entity
    t.longText('follow_ups'),             // JSON: [{ date, actions_taken, notes, type }]
  ],
};

// NOTE: Airtable's Meta API does NOT allow updating singleSelect choices via PATCH
// (only `name` and `description` are mutable on existing fields). To add choices
// to an already-existing singleSelect, we use the "typecast trick": create a
// placeholder record with the new choice value and `typecast: true` (which
// auto-registers the new choice), then immediately delete the placeholder.
// For Permissions.category = 'OPWDD' we skip this because the real permission
// inserts below use typecast:true and will auto-create the choice on first use.
const DESIRED_CHOICE_EXTENSIONS = {
  Files: { category: OPWDD_FILE_CATEGORIES },
  Tasks: {
    type: OPWDD_TASK_TYPES,
    route_to_role: ['Enrollment'],
    // UI exposes Low priority but the existing singleSelect only carries
    // Normal/High/Urgent. Adding the choice via the typecast trick keeps
    // legacy writes valid while letting the new TaskComposer surface Low.
    priority: ['Low'],
  },
  // New writes default Conflicts.status to "Open"; legacy "Unaddressed" rows
  // are treated as Open in the UI mapping (see conflictFlagging.js).
  Conflicts: { status: ['Open'] },
  // Adult triage gains HHA in services_needed for the new spec. Pediatric
  // (ABA + PT/OT/ST) now also offers HHA per the updated requested-services
  // spec — the careStream write path does NOT send typecast, so the choice
  // must be registered on the field before the UI can persist it.
  TriageAdult: { services_needed: ADULT_SERVICES_NEEDED_NEW },
  TriagePediatric: { services_needed: ['HHA'] },
  // "Informational" payer order added to the Eligibility + Authorization
  // staff-confirmed order pickers (2026-06 spec).
  EligibilityVerifications: { staff_confirmed_order_rank: ['informational'] },
  PatientInsurances: { order_rank: ['informational'] },
};

const DESIRED_PERMISSIONS = [
  { id: 'perm_opwdd_case_view',          key: 'opwdd.case.view',           label: 'View OPWDD Case',                category: 'OPWDD', sort_order: 1,  description: 'See OPWDD eligibility cases and their progress.' },
  { id: 'perm_opwdd_case_create',        key: 'opwdd.case.create',         label: 'Create OPWDD Case',              category: 'OPWDD', sort_order: 2,  description: 'Open a new OPWDD eligibility case from a referral.' },
  { id: 'perm_opwdd_case_edit',          key: 'opwdd.case.edit',           label: 'Edit OPWDD Case',                category: 'OPWDD', sort_order: 3,  description: 'Modify OPWDD case fields and status.' },
  { id: 'perm_opwdd_case_assign',        key: 'opwdd.case.assign',         label: 'Assign OPWDD Case',              category: 'OPWDD', sort_order: 4,  description: 'Assign or reassign the enrollment specialist on an OPWDD case.' },
  { id: 'perm_opwdd_checklist_edit',     key: 'opwdd.checklist.edit',      label: 'Edit OPWDD Checklist',           category: 'OPWDD', sort_order: 5,  description: 'Update OPWDD case checklist item statuses.' },
  { id: 'perm_opwdd_file_upload',        key: 'opwdd.file.upload',         label: 'Upload OPWDD File',              category: 'OPWDD', sort_order: 6,  description: 'Upload documents to an OPWDD case.' },
  { id: 'perm_opwdd_file_verify',        key: 'opwdd.file.verify_current', label: 'Verify OPWDD Document Currency', category: 'OPWDD', sort_order: 7,  description: 'Verify an OPWDD document is current / not expired.' },
  { id: 'perm_opwdd_submit_packet',      key: 'opwdd.submit_packet',       label: 'Submit OPWDD Packet',            category: 'OPWDD', sort_order: 8,  description: 'Record submission of an OPWDD packet to the CCO.' },
  { id: 'perm_opwdd_record_notice',      key: 'opwdd.record_notice',       label: 'Record OPWDD Notice',            category: 'OPWDD', sort_order: 9,  description: 'Record receipt of the OPWDD eligibility notice letter.' },
  { id: 'perm_opwdd_mark_code95',        key: 'opwdd.mark_code95_received',label: 'Mark Code 95 Received',          category: 'OPWDD', sort_order: 10, description: 'Mark the OPWDD case as having received code 95.' },
  { id: 'perm_opwdd_convert_to_intake',  key: 'opwdd.convert_to_intake',   label: 'Convert OPWDD to Intake',        category: 'OPWDD', sort_order: 11, description: 'Hand an OPWDD case back to intake after code 95.' },
  { id: 'perm_opwdd_close_case',         key: 'opwdd.close_case',          label: 'Close OPWDD Case',               category: 'OPWDD', sort_order: 12, description: 'Close an OPWDD eligibility case.' },

  // Urgent care / pre-assessment indicator (2026-05-20).
  { id: 'perm_referral_flag_urgent',     key: 'referral.flag_urgent_care', label: 'Flag urgent care / pre-assessment', category: 'Referrals', sort_order: 17, description: 'Mark a patient as requiring urgent pre-SOC care. Adds a red first-aid indicator on every module surface.' },
];

// ---------- Operations ----------
async function fetchSchema() {
  const res = await fetch(`${META}/tables`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Fetch schema failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createTable(def, byNameSnapshot) {
  // Strip / resolve any link fields the same way `createField` does so that
  // link columns declared in the initial table definition aren't sent with
  // an unresolved `__linkedTableName` (Airtable rejects with INVALID_REQUEST).
  // Also remove any fields where the linked table doesn't exist YET — those
  // will be re-attempted in the "Adding fields" step after every base table
  // has been created.
  const resolvedFields = [];
  for (const f of def.fields) {
    if (f.__linkedTableName) {
      const linked = byNameSnapshot?.[f.__linkedTableName];
      if (!linked) {
        // Defer: linked table doesn't exist yet, add later via createField.
        continue;
      }
      // eslint-disable-next-line no-unused-vars
      const { __linkedTableName, ...rest } = f;
      resolvedFields.push({
        ...rest,
        options: { ...(rest.options || {}), linkedTableId: linked.id },
      });
    } else {
      resolvedFields.push(f);
    }
  }
  const body = { ...def, fields: resolvedFields };
  console.log(`  + creating table: ${def.name}`);
  return api('POST', `${META}/tables`, body);
}

async function createField(tableId, def, byNameSnapshot) {
  // Resolve `__linkedTableName` → `options.linkedTableId` from the current
  // schema snapshot. Done here (not at definition time) so we don't have
  // to hard-code Airtable tblXXX ids into source. Internal fields prefixed
  // with `__` are stripped from the outgoing body.
  let body = def;
  if (def.__linkedTableName) {
    const linkedTable = byNameSnapshot?.[def.__linkedTableName];
    if (!linkedTable) {
      throw new Error(
        `createField: linkedTableName="${def.__linkedTableName}" not found for ${def.name}`,
      );
    }
    // eslint-disable-next-line no-unused-vars
    const { __linkedTableName, ...rest } = def;
    body = {
      ...rest,
      options: { ...(rest.options || {}), linkedTableId: linkedTable.id },
    };
  }
  console.log(`    + adding field: ${body.name} (${body.type})`);
  return api('POST', `${META}/tables/${tableId}/fields`, body);
}

/**
 * Extends a singleSelect field's choices by creating placeholder records with
 * `typecast: true` (which auto-creates missing select options), then deleting
 * the placeholders. This is the only reliable way to add options to an
 * existing singleSelect field via the Airtable API.
 */
async function extendChoicesViaPlaceholders(tableId, tableName, field, newChoiceNames) {
  const existing = new Set((field.options?.choices || []).map((c) => c.name));
  const toAdd = newChoiceNames.filter((n) => !existing.has(n));
  if (toAdd.length === 0) return;
  console.log(`    ~ extending ${tableName}.${field.name} via typecast placeholders: ${toAdd.join(', ')}`);

  const recordsToCreate = toAdd.map((val) => ({ fields: { [field.name]: val } }));
  const createdIds = [];
  for (let i = 0; i < recordsToCreate.length; i += 10) {
    const batch = recordsToCreate.slice(i, i + 10);
    const res = await api('POST', `${DATA}/${tableId}`, { records: batch, typecast: true });
    if (res && res.records) for (const r of res.records) createdIds.push(r.id);
  }
  if (DRY_RUN) return;
  for (let i = 0; i < createdIds.length; i += 10) {
    const batch = createdIds.slice(i, i + 10);
    const params = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join('&');
    await api('DELETE', `${DATA}/${tableId}?${params}`);
  }
}

async function getPermissionKeys(permissionsTableId) {
  if (DRY_RUN) return new Set();
  const keys = new Set();
  let offset;
  do {
    const url = new URL(`${DATA}/${permissionsTableId}`);
    url.searchParams.set('fields[]', 'key');
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Permissions list failed: ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) if (r.fields?.key) keys.add(r.fields.key);
    offset = data.offset;
    await sleep(220);
  } while (offset);
  return keys;
}

async function insertPermissions(permissionsTableId, rows) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    console.log(`  + seeding ${batch.length} permissions (${batch.map((r) => r.key).join(', ')})`);
    await api('POST', `${DATA}/${permissionsTableId}`, {
      records: batch.map((r) => ({ fields: r })),
      typecast: true,
    });
  }
}

// ---------- Main ----------
async function main() {
  console.log(`Target base: ${BASE_ID}`);
  if (DRY_RUN) console.log('(dry run — no writes)');

  let schema = await fetchSchema();
  const byName = () => Object.fromEntries(schema.tables.map((t) => [t.name, t]));

  // 1) Extend singleSelect choices FIRST (so new fields can reference categories if needed)
  console.log('\n== Extending singleSelect choices ==');
  for (const [tableName, fieldMap] of Object.entries(DESIRED_CHOICE_EXTENSIONS)) {
    const table = byName()[tableName];
    if (!table) { console.log(`  ! table not found: ${tableName} (skipping)`); continue; }
    for (const [fieldName, newChoices] of Object.entries(fieldMap)) {
      const field = table.fields.find((f) => f.name === fieldName);
      if (!field) { console.log(`    ! field not found: ${tableName}.${fieldName} (skipping)`); continue; }
      if (field.type !== 'singleSelect' && field.type !== 'multipleSelects') {
        console.log(`    ! ${tableName}.${fieldName} is not a select (type=${field.type}); skipping`);
        continue;
      }
      await extendChoicesViaPlaceholders(table.id, tableName, field, newChoices);
    }
  }

  // Refresh schema after PATCH
  if (!DRY_RUN) schema = await fetchSchema();

  // 2) Create new tables
  console.log('\n== Creating tables ==');
  for (const def of DESIRED_TABLES) {
    const existing = byName()[def.name];
    if (existing) {
      console.log(`  = table exists: ${def.name}`);
      continue;
    }
    await createTable(def, byName());
  }

  if (!DRY_RUN) schema = await fetchSchema();

  // 3) Add missing fields to new tables (in case table existed but fields missing) + to existing tables
  console.log('\n== Adding fields ==');
  const allFieldTargets = {
    ...Object.fromEntries(DESIRED_TABLES.map((d) => [d.name, d.fields.slice(1)])), // skip primary
    ...DESIRED_NEW_FIELDS,
  };
  const nameIndex = byName();
  for (const [tableName, fields] of Object.entries(allFieldTargets)) {
    const table = nameIndex[tableName];
    if (!table) { console.log(`  ! table not found: ${tableName} (skipping)`); continue; }
    const existingNames = new Set(table.fields.map((f) => f.name));
    console.log(`  -> ${tableName}`);
    for (const f of fields) {
      if (existingNames.has(f.name)) continue;
      await createField(table.id, f, nameIndex);
    }
  }

  if (!DRY_RUN) schema = await fetchSchema();

  // 4) Seed Permissions rows (only those with key not already present)
  console.log('\n== Seeding Permissions ==');
  const permsTable = byName()['Permissions'];
  if (!permsTable) {
    console.log('  ! Permissions table not found; skipping seed');
  } else {
    const existingKeys = await getPermissionKeys(permsTable.id);
    const toInsert = DESIRED_PERMISSIONS.filter((p) => !existingKeys.has(p.key));
    if (toInsert.length === 0) {
      console.log('  = all desired permissions already present');
    } else {
      // Fill created_at
      const now = new Date().toISOString();
      await insertPermissions(permsTable.id, toInsert.map((p) => ({ ...p, created_at: now })));
    }
  }

  console.log('\nDone. Run `npm run schema` to refresh the snapshot.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
