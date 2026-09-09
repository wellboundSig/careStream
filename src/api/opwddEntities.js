/**
 * HomehealthOpwddEntities API — predefined OPWDD packet submission partners
 * (CCOs / Service Access Agencies / LGUs). Read-mostly lookup table that
 * drives the searchable "submitted to" dropdown in the OPWDD workspace.
 *
 * Seeded from scripts/data/opwdd_packet_submission_partners.csv via
 * scripts/seed-homehealth-opwdd-entities.js; managed in the DB thereafter
 * (the dropdown is dynamic — new rows appear without a code change).
 */

import aurora from './aurora.js';

const TABLE = 'HomehealthOpwddEntities';

export const getAllOpwddEntities = () =>
  aurora.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }] });

export const createOpwddEntity = (fields) => aurora.create(TABLE, fields);

export const updateOpwddEntity = (recordId, fields) =>
  aurora.update(TABLE, recordId, { ...fields, updated_at: new Date().toISOString() });
