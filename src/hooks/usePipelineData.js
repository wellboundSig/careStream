import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';
import { resolveStageEnteredAt, daysBetween, daysInPipeline, clinicalReviewEnteredAt, staffingEnteredAt } from '../utils/referralMetrics.js';
import { useReferralVisibility } from './useReferralVisibility.js';

/** Unwrap linked-record arrays / trim ids. Kept local — do not import heavy utils here. */
function asId(raw) {
  if (raw == null || raw === '') return '';
  if (Array.isArray(raw)) return raw[0] != null ? String(raw[0]).trim() : '';
  return String(raw).trim();
}

export function usePipelineData() {
  const patients     = useCareStore((s) => s.patients);
  const referrals    = useCareStore((s) => s.referrals);
  const stageHistory = useCareStore((s) => s.stageHistory);
  const hydrated     = useCareStore((s) => s.hydrated);
  const { isVisible } = useReferralVisibility();

  const data = useMemo(() => {
    const refs = Object.values(referrals).filter(isVisible);
    if (!refs.length) return [];

    // Build two lookup paths: by custom id (pat_007) AND by Airtable record id (recXXX)
    const patientByCustomId = {};
    const patientByRecordId = {};
    Object.values(patients).forEach((p) => {
      if (p.id)  patientByCustomId[p.id]  = p;
      if (p._id) patientByRecordId[p._id] = p;
      // Also index trimmed forms
      const cid = asId(p.id);
      const rid = asId(p._id);
      if (cid && !patientByCustomId[cid]) patientByCustomId[cid] = p;
      if (rid && !patientByRecordId[rid]) patientByRecordId[rid] = p;
    });

    // Index StageHistory by referral_id once, so each referral does an O(1)
    // lookup instead of O(N) over the full history list.
    const historyByReferral = {};
    Object.values(stageHistory || {}).forEach((h) => {
      const rid = h?.referral_id;
      if (!rid) return;
      if (!historyByReferral[rid]) historyByReferral[rid] = [];
      historyByReferral[rid].push(h);
    });

    return refs.map((ref) => {
      const pid = asId(ref.patient_id) || ref.patient_id;
      const patient = patientByCustomId[pid]
        || patientByRecordId[pid]
        || patientByCustomId[ref.patient_id]
        || patientByRecordId[ref.patient_id]
        || null;
      const refHistory = historyByReferral[ref.id] || [];
      const stageEnteredAt = resolveStageEnteredAt(ref, refHistory);
      const clinicalEnteredAt = clinicalReviewEnteredAt(ref, stageEnteredAt);
      const staffingAt = staffingEnteredAt(ref, stageEnteredAt);
      const fullName = patient
        ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
        : '';
      return {
        ...ref,
        patientName: fullName || pid || ref.patient_id || 'Unknown',
        patientDob: patient?.dob || null,
        patient: patient || null,
        // Computed time metrics (single source of truth — see referralMetrics.js)
        _stage_entered_at: stageEnteredAt,
        _days_in_stage:    daysBetween(stageEnteredAt),
        _days_in_pipeline: daysInPipeline(ref),
        _clinical_entered_at: clinicalEnteredAt,
        _days_in_clinical: daysBetween(clinicalEnteredAt),
        _staffing_entered_at: staffingAt,
        _days_in_staffing: daysBetween(staffingAt),
      };
    });
  }, [referrals, patients, stageHistory, isVisible]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
