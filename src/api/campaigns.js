import aurora from './aurora.js';
const TABLE = 'Campaigns';
export const getCampaigns = () => aurora.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }] });
export const getCampaignMarketers = (campaignId) =>
  aurora.fetchAll('CampaignMarketers', { filterByFormula: `{campaign_id} = "${campaignId}"` });
export const createCampaign = (fields) => aurora.create(TABLE, fields);
