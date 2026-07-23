import airtable from './airtable.js';

const TABLE = 'ReferralDrafts';

export const getReferralDraftsByOwner = (ownerUserId, { maxRecords = 100 } = {}) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{owner_user_id} = "${ownerUserId}"`,
    sort: [{ field: 'updated_at', direction: 'desc' }],
    maxRecords,
  });

export const createReferralDraft = (fields) => airtable.create(TABLE, fields);

export const updateReferralDraft = (recordId, fields) =>
  airtable.update(TABLE, recordId, fields);

export const deleteReferralDraft = (recordId) => airtable.remove(TABLE, recordId);
