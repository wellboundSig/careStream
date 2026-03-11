import { useAirtable } from './useAirtable.js';
import { getReferrals } from '../api/referrals.js';

export function useReferrals(params) {
  return useAirtable(() => getReferrals(params), [JSON.stringify(params)]);
}
