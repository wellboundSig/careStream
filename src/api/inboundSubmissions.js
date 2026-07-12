import airtable from './airtable.js';

const SUBMISSIONS = 'InboundSubmissions';
const ATTACHMENTS = 'InboundSubmissionAttachments';
const EVENTS = 'InboundSubmissionEvents';

export const getInboundSubmissions = (params) => airtable.fetchAll(SUBMISSIONS, params);
export const createInboundSubmission = (fields) => airtable.create(SUBMISSIONS, fields);
export const updateInboundSubmission = (id, fields) => airtable.update(SUBMISSIONS, id, fields);

export const getInboundAttachments = (params) => airtable.fetchAll(ATTACHMENTS, params);
export const createInboundAttachment = (fields) => airtable.create(ATTACHMENTS, fields);

export const getInboundEvents = (params) => airtable.fetchAll(EVENTS, params);
export const createInboundEvent = (fields) => airtable.create(EVENTS, fields);

export async function logInboundEvent({ submissionId, actorId, action, detail = '', metadata = null }) {
  const now = new Date().toISOString();
  const fields = {
    id: `inev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    inbound_submission_id: submissionId,
    actor_id: actorId || '',
    action,
    detail,
    metadata: metadata || undefined,
    created_at: now,
  };
  return createInboundEvent(fields);
}
