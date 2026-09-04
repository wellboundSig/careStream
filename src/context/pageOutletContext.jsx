import { createContext, useContext } from 'react';
import { useOutletContext } from 'react-router-dom';

/** Same shape as AppShell's `<Outlet context>`. Used when pages stay mounted off-route. */
export const PageOutletContext = createContext(null);

/** False while a keep-alive page is hidden so idle hydrate does not steal the active tab. */
export const KeepAliveActiveContext = createContext(true);

export function usePageOutlet() {
  const cached = useContext(PageOutletContext);
  const routed = useOutletContext();
  return cached || routed || { division: 'All' };
}
