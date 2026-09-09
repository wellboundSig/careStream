import aurora from './aurora.js';

const TABLE = 'ReferralDrafts';

export const getReferralDraftsByOwner = (ownerUserId, { maxRecords = 100 } = {}) =>
  aurora.fetchAll(TABLE, {
    filterByFormula: `{owner_user_id} = "${ownerUserId}"`,
    sort: [{ field: 'updated_at', direction: 'desc' }],
    maxRecords,
  });

export const createReferralDraft = (fields) => aurora.create(TABLE, fields);

export const updateReferralDraft = (recordId, fields) =>
  aurora.update(TABLE, recordId, fields);

export const deleteReferralDraft = (recordId) => aurora.remove(TABLE, recordId);
