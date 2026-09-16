import {
  getPendingScheduledLeads,
  updateScheduledLead,
  deleteScheduledLead,
} from '../api/scheduledLeads.js';
import { commitNewLeadFromForm } from './commitNewLeadFromForm.js';
import { useCareStore } from '../store/careStore.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';

function parseFormData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

export async function promoteScheduledLead(rec) {
  const fields = rec?.fields || rec || {};
  const form = parseFormData(fields.form_data);
  const sources = Object.values(useCareStore.getState().referralSources || {});
  const at = fields.go_live_at || new Date().toISOString();
  const result = await commitNewLeadFromForm({
    form,
    appUserId: fields.owner_user_id,
    sources,
    forceStage: fields.force_stage || form._forceStage || null,
    selectedPhysician: form._physician || null,
    at,
  });
  await updateScheduledLead(rec.id, {
    status: 'promoted',
    promoted_at: new Date().toISOString(),
    promoted_referral_id: result.referralCustomId,
  });
  triggerDataRefresh();
  return result;
}

export async function promoteDueScheduledLeads() {
  const rows = await getPendingScheduledLeads({ maxRecords: 200 });
  const now = Date.now();
  const due = (rows || []).filter((rec) => {
    const at = rec.fields?.go_live_at;
    if (!at) return false;
    const t = new Date(at).getTime();
    return Number.isFinite(t) && t <= now;
  });
  let promoted = 0;
  for (const rec of due) {
    try {
      await updateScheduledLead(rec.id, { status: 'promoting' });
      await promoteScheduledLead(rec);
      promoted += 1;
    } catch (err) {
      console.warn('[scheduledLeads] promote failed', rec.id, err);
      try {
        await updateScheduledLead(rec.id, { status: 'pending' });
      } catch { /* leave as promoting so a human can inspect */ }
    }
  }
  return promoted;
}

export async function cancelScheduledLead(rec) {
  if (!rec?.id) return;
  await deleteScheduledLead(rec.id);
}
