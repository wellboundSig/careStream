import aurora from './aurora.js';
const TABLE = 'StageHistory';

export const getStageHistory = (referralId) =>
  aurora.fetchAll(TABLE, {
    filterByFormula: `{referral_id} = "${referralId}"`,
    sort: [{ field: 'timestamp', direction: 'desc' }],
  });

export const createStageHistory = (fields, opts) => aurora.create(TABLE, fields, opts);
