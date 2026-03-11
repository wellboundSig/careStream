import { useMemo } from 'react';
import { useReferrals } from './useReferrals.js';
import { usePatients } from './usePatients.js';

export function usePipelineData() {
  const { data: referrals, loading: rLoading, error, refetch } = useReferrals();
  const { data: patients, loading: pLoading } = usePatients();

  const data = useMemo(() => {
    if (!referrals.length) return [];

    const patientMap = {};
    patients.forEach((p) => {
      if (p.id) patientMap[p.id] = p;
    });

    return referrals.map((ref) => {
      const patient = patientMap[ref.patient_id];
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

  return { data, loading: rLoading || pLoading, error, refetch };
}
