#!/usr/bin/env node
/**
 * generate-ddl.js — Airtable schema-snapshot → PostgreSQL DDL + adapter registry.
 *
 * Reads:  scripts/schema-snapshot.json  (51 Airtable tables, fetched via Meta API)
 *         + the inline DRIFT spec below (fields/tables created after the snapshot
 *           was taken — kept in sync with scripts/airtable-apply-schema.js)
 * Writes: db/migrations/0001_init.sql   (idempotent CREATE TABLE ... IF NOT EXISTS)
 *         db/registry.json              (table/column whitelist + wire-type map
 *                                        consumed by services/wellbound-api)
 *
 * Conventions (see docs/MIGRATION-PHASE0-COMPLIANCE.md + the migration plan):
 *   - rec_id TEXT PRIMARY KEY — plays the role of the Airtable record id on the
 *     wire (client stores it as `_id` and uses it for PATCH/DELETE). Generated
 *     server-side for new rows; carries the original Airtable rec id for
 *     migrated rows (reconciliation bridge).
 *   - Business `id` stays a plain indexed TEXT column (NOT the PK: Airtable
 *     neither requires nor de-duplicates it — e.g. EligibilityVerifications
 *     rows are created without one).
 *   - Airtable "inverse" link fields (auto-created backlinks named after the
 *     target table, e.g. Users.Tickets) are derived relationships → skipped.
 *   - JSON-in-text fields → jsonb, but flagged `jsonString` in the registry so
 *     the API returns them as strings (client JSON.parse stays intact).
 *   - multipleSelects → text[]; checkbox → boolean; dateTime → timestamptz;
 *     date → date; number → bigint/double precision (Data API returns real
 *     numbers, matching Airtable's wire behavior).
 *   - created_at/updated_at added where missing; updated_at maintained by
 *     trigger (feeds the client's IS_AFTER incremental sync).
 *
 * Usage: node db/generate-ddl.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/schema-snapshot.json'), 'utf8'));

// ── Drift spec ────────────────────────────────────────────────────────────────
// Tables/fields defined in scripts/airtable-apply-schema.js after the snapshot
// was last refreshed. Merged into the generated DDL (added only when absent).
const DRIFT_TABLES = [
  {
    name: 'ConflictCategories',
    fields: [
      { name: 'id', type: 'singleLineText' },
      { name: 'value', type: 'singleLineText' },
      { name: 'label', type: 'singleLineText' },
      { name: 'sort_order', type: 'number', options: { precision: 0 } },
      { name: 'is_active', type: 'checkbox' },
      { name: 'created_at', type: 'dateTime' },
      { name: 'updated_at', type: 'dateTime' },
    ],
  },
  // Field-support clinician roster (upserted from Esper on every field ticket).
  // Created after the schema snapshot was taken — see worker-field-support.js.
  {
    name: 'Clinicians',
    fields: [
      { name: 'id', type: 'singleLineText' },
      { name: 'esper_id', type: 'singleLineText' },
      { name: 'first_name', type: 'singleLineText' },
      { name: 'last_name', type: 'singleLineText' },
      { name: 'name', type: 'singleLineText' },
      { name: 'discipline', type: 'singleLineText' },
      { name: 'worker_id', type: 'singleLineText' },
      { name: 'device_serial', type: 'singleLineText' },
      { name: 'device_name', type: 'singleLineText' },
      { name: 'email', type: 'email' },
      { name: 'last_seen_at', type: 'dateTime' },
      { name: 'created_at', type: 'dateTime' },
    ],
  },
];

const DRIFT_FIELDS = {
  Users: [['is_support_staff', 'checkbox']],
  // IT-ticketing fields created live after the snapshot (see Meta API diff).
  Categories: [['field_topic', 'checkbox']],
  Tickets: [
    ['source', 'singleSelect'],
    ['wifi_connected', 'checkbox'],
    ['facility_id', 'multipleRecordLinks'],
    ['clinician_id', 'multipleRecordLinks'],
  ],
  Referrals: [
    ['active_opwdd_case_id', 'singleLineText'], ['opwdd_route_started_at', 'dateTime'],
    ['opwdd_route_started_by_id', 'singleLineText'], ['opwdd_conversion_ready', 'checkbox'],
    ['opwdd_handoff_status', 'singleSelect'], ['in_clinical_review', 'checkbox'],
    ['clinical_review_pushed_at', 'dateTime'], ['clinical_review_completed_at', 'dateTime'],
    ['clinical_review_completed_by_id', 'singleLineText'], ['eligibility_completed_at', 'dateTime'],
    ['eligibility_completed_by_id', 'singleLineText'], ['eligibility_returned_to_intake_at', 'dateTime'],
    ['eligibility_returned_to_intake_note', 'multilineText'], ['eligibility_returned_to_intake_by_id', 'singleLineText'],
    ['requires_urgent_care', 'checkbox'], ['urgent_care_marked_at', 'dateTime'],
    ['urgent_care_marked_by_id', 'singleLineText'], ['urgent_care_note', 'multilineText'],
  ],
  Conflicts: [['source_stage', 'multilineText']],
  Files: [
    ['opwdd_case_id', 'singleLineText'], ['document_subtype', 'singleSelect'],
    ['document_date', 'dateTime'], ['document_valid_through', 'dateTime'],
    ['verified_current_by_id', 'singleLineText'], ['verified_current_at', 'dateTime'],
    ['authorization_id', 'singleLineText'],
  ],
  Tasks: [['opwdd_case_id', 'singleLineText'], ['physician_id', 'singleLineText']],
  ActivityLog: [['opwdd_case_id', 'singleLineText']],
  TriageAdult: [
    ['opwdd_status', 'singleSelect'], ['insurance_plan_name', 'singleLineText'],
    ['medicaid_number', 'singleLineText'], ['patient_name', 'singleLineText'],
    ['dob', 'dateTime'], ['address', 'multilineText'], ['email', 'email'],
    ['add_secondary_caregiver', 'singleLineText'], ['secondary_caregiver_name', 'singleLineText'],
    ['secondary_caregiver_phone', 'singleLineText'], ['has_smoking', 'singleLineText'],
    ['homecare_hours_days', 'multilineText'], ['has_in_home_therapies', 'singleLineText'],
    ['current_therapy_services', 'multilineText'], ['hha_hours_frequency', 'multilineText'],
    ['health_conditions', 'multilineText'], ['pcp_npi_number', 'singleLineText'],
    ['pcp_physician_id', 'singleLineText'], ['cco_name', 'singleSelect'],
    ['cm_fax', 'singleLineText'], ['cm_email', 'email'],
  ],
  TriagePediatric: [
    ['opwdd_status', 'singleSelect'], ['medicaid_number', 'singleLineText'],
    ['primary_caregiver_name', 'singleLineText'], ['primary_caregiver_phone', 'singleLineText'],
    ['add_secondary_caregiver', 'singleLineText'], ['secondary_caregiver_name', 'singleLineText'],
    ['secondary_caregiver_phone', 'singleLineText'], ['emergency_same_as_primary', 'singleLineText'],
    ['emergency_contact_name', 'singleLineText'], ['emergency_contact_phone', 'singleLineText'],
    ['email', 'email'], ['patient_name', 'singleLineText'], ['dob', 'dateTime'],
    ['address', 'multilineText'], ['has_smoking', 'singleLineText'],
    ['homecare_hours_days', 'multilineText'], ['health_conditions', 'multilineText'],
    ['pcp_physician_id', 'singleLineText'], ['cco_name', 'singleSelect'],
    ['cm_fax', 'singleLineText'], ['cm_email', 'email'],
  ],
  Physicians: [
    ['npi_status', 'singleSelect'], ['npi_checked_at', 'dateTime'],
    ['npi_provider_name', 'singleLineText'], ['npi_details', 'multilineText'],
    ['opra_last_checked', 'dateTime'], ['order_refer_flags', 'multilineText'],
    ['verification_last_run_at', 'dateTime'], ['verification_checked_by_id', 'singleLineText'],
  ],
  EligibilityVerifications: [['patient_insurance_id', 'multipleRecordLinks']],
  Authorizations: [
    ['service_lines', 'multilineText'], ['coverage_status', 'singleSelect'],
    ['payer_type', 'singleLineText'], ['payer_order', 'singleSelect'],
    ['sources_checked', 'multilineText'], ['request_initial_date', 'dateTime'],
    ['request_requested_from', 'singleLineText'], ['request_docs_sent', 'checkbox'],
    ['follow_ups', 'multilineText'],
  ],
};

// ── JSON-string fields (stored jsonb, wire = string via JSON.stringify) ──────
const JSON_STRING_FIELDS = new Set([
  'UserPermissions.permissions',
  'UserPermissions.allowed_assignees',
  'PermissionPresets.permissions',
  'Authorizations.service_lines',
  'Authorizations.follow_ups',
  'Authorizations.sources_checked',
  'Physicians.npi_details',
  'Physicians.order_refer_flags',
  'Patients.insurance_plans',
  'Patients.insurance_plan_details',
  'ActivityLog.metadata',
  'StageHistory.metadata',
  'UserPreferences.pinned_pages',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
const snake = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase();

const TABLE_NAMES = new Set(SNAPSHOT.tables.map((t) => t.name).concat(DRIFT_TABLES.map((t) => t.name)));

/** Airtable auto-created inverse/backlink fields: named after the target table
 *  (optionally with " (source_field)" suffix) rather than snake_case. */
function isInverseLink(field) {
  if (field.type !== 'multipleRecordLinks') return false;
  const base = field.name.split(' (')[0];
  if (TABLE_NAMES.has(base)) return true;
  return /[A-Z]/.test(field.name) && !/^[a-z0-9_]+$/.test(field.name);
}

// Airtable table-id → table-name map (for resolving link targets).
const TBL_ID_TO_NAME = Object.fromEntries(SNAPSHOT.tables.map((t) => [t.id, t.name]));
// Drift link fields (created after snapshot) — explicit targets.
const DRIFT_LINK_TARGETS = {
  'EligibilityVerifications.patient_insurance_id': 'PatientInsurances',
  'Tickets.facility_id': 'NetworkFacilities',
  'Tickets.clinician_id': 'Clinicians',
};

function pgType(table, field) {
  const key = `${table}.${field.name}`;
  if (JSON_STRING_FIELDS.has(key)) return { pg: 'jsonb', wire: 'jsonString' };
  switch (field.type) {
    case 'multilineText':
    case 'singleLineText':
    case 'richText':
    case 'email':
    case 'url':
    case 'phoneNumber':
    case 'aiText':
    case 'singleSelect':
      return { pg: 'text', wire: 'text' };
    case 'dateTime':
    case 'createdTime':
      return { pg: 'timestamptz', wire: 'timestamp' };
    case 'date':
      return { pg: 'date', wire: 'date' };
    case 'number': {
      const precision = field.options?.precision ?? 0;
      return precision === 0
        ? { pg: 'bigint', wire: 'int' }
        : { pg: 'double precision', wire: 'float' };
    }
    case 'checkbox':
      return { pg: 'boolean', wire: 'checkbox' };
    case 'multipleSelects':
      return { pg: 'text[]', wire: 'textArray' };
    case 'multipleRecordLinks': {
      // Forward links: stored as the referenced row's rec_id (single value —
      // every forward link in this base is written via toLinks() as [id]).
      // Wire shape is a 1-element array, handled by the adapter. `linkTable`
      // lets the FIND/ARRAYJOIN translator resolve the target's business id.
      const target = TBL_ID_TO_NAME[field.options?.linkedTableId] || DRIFT_LINK_TARGETS[key] || null;
      return { pg: 'text', wire: 'linkArray', linkTable: target };
    }
    case 'multipleAttachments':
    case 'singleCollaborator':
      return { pg: 'jsonb', wire: 'jsonRaw' };
    default:
      throw new Error(`Unmapped Airtable type "${field.type}" on ${key}`);
  }
}

// ── Build model ───────────────────────────────────────────────────────────────
const tables = [];
const allSnapshotTables = SNAPSHOT.tables.map((t) => ({ name: t.name, fields: [...t.fields] }));

for (const drift of DRIFT_TABLES) {
  if (!allSnapshotTables.find((t) => t.name === drift.name)) {
    allSnapshotTables.push({ name: drift.name, fields: drift.fields.map((f) => ({ ...f })) });
  }
}
for (const [tableName, fields] of Object.entries(DRIFT_FIELDS)) {
  const t = allSnapshotTables.find((x) => x.name === tableName);
  if (!t) continue;
  for (const [name, type] of fields) {
    if (!t.fields.find((f) => f.name === name)) t.fields.push({ name, type });
  }
}

for (const t of allSnapshotTables) {
  const pgName = snake(t.name);
  const cols = [];
  const registryCols = {};

  for (const f of t.fields) {
    if (isInverseLink(f)) continue;               // derived backlink — skip
    if (f.name === 'rec_id') continue;            // reserved
    const colName = snake(f.name);
    if (cols.find((c) => c.name === colName)) continue; // dedupe post-snake collisions
    const { pg, wire, linkTable } = pgType(t.name, f);
    cols.push({ name: colName, pg, airtableName: f.name });
    registryCols[f.name] = { column: colName, pg, wire, ...(linkTable ? { linkTable } : {}) };
  }

  // Ensure timestamps exist on every table.
  for (const ts of ['created_at', 'updated_at']) {
    if (!cols.find((c) => c.name === ts)) {
      cols.push({ name: ts, pg: 'timestamptz', airtableName: ts });
      registryCols[ts] = { column: ts, pg: 'timestamptz', wire: 'timestamp' };
    }
  }

  tables.push({ airtableName: t.name, pgName, cols, registryCols });
}

// ── Emit DDL ──────────────────────────────────────────────────────────────────
const lines = [];
lines.push('-- 0001_init.sql — generated by db/generate-ddl.js. Regenerate, do not hand-edit.');
lines.push(`-- Source: scripts/schema-snapshot.json (base ${SNAPSHOT.baseId}, fetched ${SNAPSHOT.fetchedAt}) + drift spec.`);
lines.push('');
lines.push('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
lines.push('');
lines.push(`CREATE OR REPLACE FUNCTION gen_rec_id() RETURNS text AS $$
  SELECT 'rec' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 17)
$$ LANGUAGE sql VOLATILE;`);
lines.push('');
lines.push(`CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`);
lines.push('');

for (const t of tables) {
  lines.push(`-- ── ${t.airtableName} ─────────────────────────────`);
  const colDefs = [
    `  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id()`,
    ...t.cols.map((c) => {
      let def = `  "${c.name}" ${c.pg}`;
      if (c.name === 'created_at') def += ' DEFAULT now()';
      if (c.name === 'updated_at') def += ' DEFAULT now()';
      return def;
    }),
  ];
  lines.push(`CREATE TABLE IF NOT EXISTS "${t.pgName}" (\n${colDefs.join(',\n')}\n);`);

  // Indexes: business id, *_id filter columns, updated_at (incremental sync).
  const indexed = new Set();
  for (const c of t.cols) {
    const idx = c.name === 'id' || c.name.endsWith('_id') || c.name === 'updated_at' || c.name === 'clerk_user_id';
    if (idx && !indexed.has(c.name)) {
      indexed.add(c.name);
      lines.push(`CREATE INDEX IF NOT EXISTS "idx_${t.pgName}_${c.name}" ON "${t.pgName}" ("${c.name}");`);
    }
  }
  lines.push(`DROP TRIGGER IF EXISTS "trg_${t.pgName}_touch" ON "${t.pgName}";`);
  lines.push(`CREATE TRIGGER "trg_${t.pgName}_touch" BEFORE UPDATE ON "${t.pgName}" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  lines.push('');
}

// Server-side HIPAA access log (written by wellbound-api middleware).
lines.push(`-- ── api_access_log (server-side access accounting; not an Airtable table) ──
CREATE TABLE IF NOT EXISTS "api_access_log" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "actor_sub" text,
  "actor_user_id" text,
  "method" text NOT NULL,
  "table_name" text NOT NULL,
  "row_rec_id" text,
  "row_count" integer,
  "query_summary" text,
  "status" integer,
  "at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_api_access_log_at" ON "api_access_log" ("at");
CREATE INDEX IF NOT EXISTS "idx_api_access_log_actor" ON "api_access_log" ("actor_sub");
`);

const outDir = path.join(ROOT, 'db/migrations');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '0001_init.sql'), lines.join('\n'));

// ── Emit registry ─────────────────────────────────────────────────────────────
const registry = {};
for (const t of tables) {
  registry[t.airtableName] = { pgTable: t.pgName, fields: t.registryCols };
}
fs.writeFileSync(path.join(ROOT, 'db/registry.json'), JSON.stringify(registry, null, 2));

console.log(`Generated db/migrations/0001_init.sql (${tables.length} tables) and db/registry.json`);
