// System table — global flags. Exactly one row.
//
// `live` is a short-text "True"/"False". When "True", the whole site is gated
// behind the "access soon" page (see MaintenanceGate). Reads fail OPEN: a
// network/parse error must never lock everyone out of the app.

import aurora from './aurora.js';

/**
 * @returns {Promise<boolean>} true when the site should be gated (live === "True")
 */
export async function getSystemLive() {
  try {
    const records = await aurora.fetchAll('System', { maxRecords: 1 });
    const val = records?.[0]?.fields?.live;
    return String(val ?? '').trim().toLowerCase() === 'true';
  } catch {
    return false; // fail open
  }
}
