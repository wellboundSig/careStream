import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PatientList from '../../pages/PatientList.jsx';
import PipelineBoard from '../../pages/PipelineBoard.jsx';
import { KeepAliveActiveContext, PageOutletContext } from '../../context/pageOutletContext.jsx';

const CACHED_PAGES = {
  '/pipeline': PipelineBoard,
  '/patients': PatientList,
};

const FILL = {
  flex: 1,
  minHeight: 0,
  height: '100%',
  flexDirection: 'column',
  overflow: 'auto',
};

/**
 * Keep Patients and Pipeline mounted after first visit so tab switches
 * paint immediately instead of re-committing the census.
 */
export default function KeepAliveOutlet({ context }) {
  const location = useLocation();
  const path = location.pathname;
  const [seen, setSeen] = useState(() => new Set(CACHED_PAGES[path] ? [path] : []));

  useEffect(() => {
    if (!CACHED_PAGES[path]) return;
    setSeen((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, [path]);

  const isCachedRoute = Boolean(CACHED_PAGES[path]);

  return (
    <>
      {[...seen].map((cachedPath) => {
        const Page = CACHED_PAGES[cachedPath];
        const active = path === cachedPath;
        return (
          <KeepAliveActiveContext.Provider key={cachedPath} value={active}>
            <PageOutletContext.Provider value={context}>
              <div
                hidden={!active}
                style={{ ...FILL, display: active ? 'flex' : 'none' }}
                aria-hidden={!active}
              >
                <Page />
              </div>
            </PageOutletContext.Provider>
          </KeepAliveActiveContext.Provider>
        );
      })}
      {!isCachedRoute && <Outlet context={context} />}
    </>
  );
}
