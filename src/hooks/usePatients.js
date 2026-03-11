import { useAirtable } from './useAirtable.js';
import { getPatients } from '../api/patients.js';

export function usePatients(params) {
  return useAirtable(() => getPatients(params), [JSON.stringify(params)]);
}
