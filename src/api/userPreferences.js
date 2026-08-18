/**
 * UserPreferences — Aurora `user_preferences` via wellbound-api.
 *
 * LEGACY FILENAME: ./airtable.js is the Aurora records client, not Airtable.
 *
 * Fields:
 *   clerk_user_id        — text
 *   subnav_enabled       — checkbox/boolean
 *   pinned_pages         — JSON array of route path strings
 *   split_screen_enabled — checkbox/boolean
 *   dashboard_mode       — 'executive' | 'caseload'
 *   soc_completed_view   — 'standard' | 'pending_log'
 *   table_scroll_mode    — 'full' | 'locked'  (migration 0032 + API redeploy)
 */
// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const TABLE = 'UserPreferences';

/**
 * Live wellbound-api 422s if we PATCH a field the deployed registry
 * does not list. Stay off until a GET actually returns the key.
 */
let scrollModeOnApi = false;

export function notePreferencesRecord(rec) {
  if (rec?.fields && Object.prototype.hasOwnProperty.call(rec.fields, 'table_scroll_mode')) {
    scrollModeOnApi = true;
  }
}

export function canPersistScrollMode() {
  return scrollModeOnApi;
}

function auroraFields(fields) {
  const payload = {
    clerk_user_id:        fields.clerkUserId,
    subnav_enabled:       fields.subnavEnabled ?? false,
    pinned_pages:         JSON.stringify(fields.pinnedPages ?? []),
    split_screen_enabled: fields.splitScreenEnabled ?? false,
    dashboard_mode:       fields.dashboardMode ?? 'executive',
    soc_completed_view:   fields.socCompletedView || null,
  };
  if (scrollModeOnApi && fields.tableScrollMode !== undefined) {
    payload.table_scroll_mode = fields.tableScrollMode || 'full';
  }
  return payload;
}

function patchFields(fields) {
  const payload = {};
  if (fields.subnavEnabled      !== undefined) payload.subnav_enabled       = fields.subnavEnabled;
  if (fields.pinnedPages        !== undefined) payload.pinned_pages         = JSON.stringify(fields.pinnedPages);
  if (fields.splitScreenEnabled !== undefined) payload.split_screen_enabled = fields.splitScreenEnabled;
  if (fields.dashboardMode      !== undefined) payload.dashboard_mode       = fields.dashboardMode;
  if (fields.socCompletedView   !== undefined) payload.soc_completed_view   = fields.socCompletedView || null;
  if (scrollModeOnApi && fields.tableScrollMode !== undefined) {
    payload.table_scroll_mode = fields.tableScrollMode || 'full';
  }
  return payload;
}

export async function fetchPreferences(clerkUserId) {
  const records = await airtable.fetchAll(TABLE, {
    filterByFormula: `{clerk_user_id} = "${clerkUserId}"`,
    maxRecords: 1,
  });
  const rec = records[0] ?? null;
  notePreferencesRecord(rec);
  return rec;
}

export async function createPreferences(clerkUserId, fields) {
  return airtable.create(TABLE, auroraFields({ ...fields, clerkUserId }));
}

export async function updatePreferences(recordId, fields) {
  const payload = patchFields(fields);
  if (Object.keys(payload).length === 0) return { id: recordId, fields: {} };
  return airtable.update(TABLE, recordId, payload);
}
