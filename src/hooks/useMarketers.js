import { useAirtable } from './useAirtable.js';
import { getMarketers } from '../api/marketers.js';

export function useMarketers() {
  return useAirtable(() => getMarketers());
}
