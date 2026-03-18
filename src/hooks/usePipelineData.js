import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

export function usePipelineData() {
  const patients = useCareStore((s) => s.patients);
  const referrals = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);

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

    return refs.map((ref) => {
      const patient = patientByCustomId[ref.patient_id]
        || patientByRecordId[ref.patient_id]
        || null;
      return {
        ...ref,
        patientName: patient
          ? `${patient.first_name} ${patient.last_name}`
          : ref.patient_id || 'Unknown',
        patientDob: patient?.dob || null,
        patient: patient || null,
      };
    });
  }, [referrals, patients]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
