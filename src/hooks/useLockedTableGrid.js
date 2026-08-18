import { usePreferences } from '../context/UserPreferencesContext.jsx';
import { isLockedTableScroll } from '../utils/tableScrollMode.js';

/** True when Settings → Locked table grid is on (fixed slots, records flip). */
export function useLockedTableGrid() {
  const { prefs } = usePreferences();
  return isLockedTableScroll(prefs);
}
