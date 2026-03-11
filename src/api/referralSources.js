import airtable from './airtable.js';
// No filter — fetch all sources (is_active checkbox returns no results with formula in this base)
export const getReferralSources = () => airtable.fetchAll('ReferralSources');
