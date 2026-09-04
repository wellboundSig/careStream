/**
 * HomehealthOpwddEntities API — predefined OPWDD packet submission partners
 * (CCOs / Service Access Agencies / LGUs). Read-mostly lookup table that
 * drives the searchable "submitted to" dropdown in the OPWDD workspace.
 *
 * Seeded from scripts/data/opwdd_packet_submission_partners.csv via
 * scripts/seed-homehealth-opwdd-entities.js; managed in the DB thereafter
 * (the dropdown is dynamic — new rows appear without a code change).
 */

// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const TABLE = 'HomehealthOpwddEntities';

export const getAllOpwddEntities = () =>
  airtable.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }] });

export const createOpwddEntity = (fields) => airtable.create(TABLE, fields);

export const updateOpwddEntity = (recordId, fields) =>
  airtable.update(TABLE, recordId, { ...fields, updated_at: new Date().toISOString() });
