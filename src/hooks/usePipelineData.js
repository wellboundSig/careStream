import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';
import { resolveStageEnteredAt, daysBetween, daysInPipeline } from '../utils/referralMetrics.js';

export function usePipelineData() {
  const patients     = useCareStore((s) => s.patients);
  const referrals    = useCareStore((s) => s.referrals);
  const stageHistory = useCareStore((s) => s.stageHistory);
  const hydrated     = useCareStore((s) => s.hydrated);

  const data = useMemo(() => {
    const refs = Object.values(referrals);
    if (!refs.length) return [];

    // Build two lookup paths: by custom id (pat_007) AND by Airtable record id (recXXX)
    const patientByCustomId = {};
    const patientByRecordId = {};
    Object.values(patients).forEach((p) => {
      if (p.id)  patientByCustomId[p.id]  = p;
      if (p._id) patientByRecordId[p._id] = p;
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
      const patient = patientByCustomId[ref.patient_id]
        || patientByRecordId[ref.patient_id]
        || null;
      const refHistory = historyByReferral[ref.id] || [];
      const stageEnteredAt = resolveStageEnteredAt(ref, refHistory);
      return {
        ...ref,
        patientName: patient
          ? `${patient.first_name} ${patient.last_name}`
          : ref.patient_id || 'Unknown',
        patientDob: patient?.dob || null,
        patient: patient || null,
        // Computed time metrics (single source of truth — see referralMetrics.js)
        _stage_entered_at: stageEnteredAt,
        _days_in_stage:    daysBetween(stageEnteredAt),
        _days_in_pipeline: daysInPipeline(ref),
      };
    });
  }, [referrals, patients, stageHistory]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
