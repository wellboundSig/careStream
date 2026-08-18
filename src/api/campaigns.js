// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'Campaigns';
export const getCampaigns = () => airtable.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }] });
export const getCampaignMarketers = (campaignId) =>
  airtable.fetchAll('CampaignMarketers', { filterByFormula: `{campaign_id} = "${campaignId}"` });
export const createCampaign = (fields) => airtable.create(TABLE, fields);
