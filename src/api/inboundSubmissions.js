import aurora from './aurora.js';

const SUBMISSIONS = 'InboundSubmissions';
const ATTACHMENTS = 'InboundSubmissionAttachments';
const EVENTS = 'InboundSubmissionEvents';

export const getInboundSubmissions = (params) => aurora.fetchAll(SUBMISSIONS, params);
export const createInboundSubmission = (fields) => aurora.create(SUBMISSIONS, fields);
export const updateInboundSubmission = (id, fields) => aurora.update(SUBMISSIONS, id, fields);

export const getInboundAttachments = (params) => aurora.fetchAll(ATTACHMENTS, params);
export const createInboundAttachment = (fields) => aurora.create(ATTACHMENTS, fields);

export const getInboundEvents = (params) => aurora.fetchAll(EVENTS, params);
export const createInboundEvent = (fields) => aurora.create(EVENTS, fields);

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
