/**
 * Airtable table required: "UserPreferences"
 *
 * Fields:
 *   clerk_user_id        — Single line text   (unique per user)
 *   subnav_enabled       — Checkbox
 *   pinned_pages         — Long text          (JSON array of route path strings)
 *   split_screen_enabled — Checkbox
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
  });
}

export async function updatePreferences(recordId, fields) {
  const payload = {};
  if (fields.subnavEnabled    !== undefined) payload.subnav_enabled       = fields.subnavEnabled;
  if (fields.pinnedPages      !== undefined) payload.pinned_pages         = JSON.stringify(fields.pinnedPages);
  if (fields.splitScreenEnabled !== undefined) payload.split_screen_enabled = fields.splitScreenEnabled;
  return airtable.update(TABLE, recordId, payload);
}
