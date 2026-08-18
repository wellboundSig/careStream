// System table — global flags. Exactly one row.
//
// `live` is a short-text "True"/"False". When "True", the whole site is gated
// behind the "access soon" page (see MaintenanceGate). Reads fail OPEN: a
// network/parse error must never lock everyone out of the app.

// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

/**
 * @returns {Promise<boolean>} true when the site should be gated (live === "True")
 */
export async function getSystemLive() {
  try {
    const records = await airtable.fetchAll('System', { maxRecords: 1 });
    const val = records?.[0]?.fields?.live;
    return String(val ?? '').trim().toLowerCase() === 'true';
  } catch {
    return false; // fail open
  }
}
