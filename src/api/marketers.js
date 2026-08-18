// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const TABLE = 'Marketers';

export const getMarketers = (params) => airtable.fetchAll(TABLE, params);
export const getMarketer = (id) => airtable.fetchOne(TABLE, id);
export const createMarketer = (fields) => airtable.create(TABLE, fields);
export const updateMarketer = (id, fields) => airtable.update(TABLE, id, fields);
