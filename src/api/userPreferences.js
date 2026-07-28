/**
 * UserPreferences — Aurora via wellbound-api (Airtable-compatible wire).
 *
 * Fields:
 *   clerk_user_id        — text
 *   subnav_enabled       — checkbox/boolean
 *   pinned_pages         — JSON array of route path strings
 *   split_screen_enabled — checkbox/boolean
 *   dashboard_mode       — 'executive' | 'caseload'
 *   soc_completed_view   — 'standard' | 'pending_log'
 */
import airtable from './airtable.js';

const TABLE = 'UserPreferences';

export async function fetchPreferences(clerkUserId) {
  const records = await airtable.fetchAll(TABLE, {
    filterByFormula: `{clerk_user_id} = "${clerkUserId}"`,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

export async function createPreferences(clerkUserId, fields) {
  return airtable.create(TABLE, {
    clerk_user_id:        clerkUserId,
    subnav_enabled:       fields.subnavEnabled ?? false,
    pinned_pages:         JSON.stringify(fields.pinnedPages ?? []),
    split_screen_enabled: fields.splitScreenEnabled ?? false,
    dashboard_mode:       fields.dashboardMode ?? 'executive',
    soc_completed_view:   fields.socCompletedView || null,
  });
}

export async function updatePreferences(recordId, fields) {
  const payload = {};
  if (fields.subnavEnabled      !== undefined) payload.subnav_enabled       = fields.subnavEnabled;
  if (fields.pinnedPages        !== undefined) payload.pinned_pages         = JSON.stringify(fields.pinnedPages);
  if (fields.splitScreenEnabled !== undefined) payload.split_screen_enabled = fields.splitScreenEnabled;
  if (fields.dashboardMode      !== undefined) payload.dashboard_mode       = fields.dashboardMode;
  if (fields.socCompletedView   !== undefined) payload.soc_completed_view   = fields.socCompletedView || null;
  return airtable.update(TABLE, recordId, payload);
}
