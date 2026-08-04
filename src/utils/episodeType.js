/**
 * Referral episode type: SOC (Start of Care) vs ROC (Resumption of Care).
 * Pipeline stages stay SOC Scheduled / SOC Completed in the engine;
 * UI copy and badges use these helpers.
 */

export const EPISODE_TYPES = ['SOC', 'ROC'];

export function normalizeEpisodeType(valueOrReferral) {
  const raw = typeof valueOrReferral === 'string'
    ? valueOrReferral
    : valueOrReferral?.episode_type;
  const v = String(raw || '').trim().toUpperCase();
  return v === 'ROC' ? 'ROC' : 'SOC';
}

export function isRoc(valueOrReferral) {
  return normalizeEpisodeType(valueOrReferral) === 'ROC';
}

export function episodeTypeLabel(valueOrReferral) {
  return normalizeEpisodeType(valueOrReferral);
}

export function episodeTypeLongLabel(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Resumption of Care' : 'Start of Care';
}

/** Module / stage display names (shared queues). */
export function completedModuleDisplayName() {
  return 'SOC/ROC Completed';
}

export function preSocModuleDisplayName() {
  return 'Pre-SOC / Pre-ROC';
}

export function socScheduledModuleDisplayName() {
  return 'SOC/ROC Scheduled';
}

/** Per-referral action verbs. */
export function scheduleVerb(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Schedule ROC' : 'Schedule SOC';
}

export function rescheduleVerb(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Reschedule ROC' : 'Reschedule SOC';
}

export function markCompletedVerb(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Mark ROC Completed' : 'Mark SOC Completed';
}

export function confirmCompletionVerb(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Confirm ROC Completion' : 'Confirm SOC Completion';
}

export function episodeDateLabel(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'ROC Date' : 'SOC Date';
}

export function postDocsLabel() {
  return 'Post-SOC/ROC docs';
}

export function preSocStageLabel(valueOrReferral) {
  return isRoc(valueOrReferral) ? 'Pre-ROC' : 'Pre-SOC';
}
