import { createContext, useContext } from 'react';
import { useUserPreferences } from '../hooks/useUserPreferences.js';

const UserPreferencesCtx = createContext(null);

export function UserPreferencesProvider({ children }) {
  const value = useUserPreferences();
  return <UserPreferencesCtx.Provider value={value}>{children}</UserPreferencesCtx.Provider>;
}

export function usePreferences() {
  const ctx = useContext(UserPreferencesCtx);
  if (!ctx) throw new Error('usePreferences must be used within <UserPreferencesProvider>');
  return ctx;
}
