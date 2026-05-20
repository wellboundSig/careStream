import { createContext, useContext, useState, useCallback } from 'react';
import PhysicianDrawer       from '../components/physicians/PhysicianDrawer.jsx';
import FacilityDrawer        from '../components/facilities/FacilityDrawer.jsx';
import MarketerDrawer        from '../components/marketers/MarketerDrawer.jsx';
import ReferralSourceDrawer  from '../components/referralSources/ReferralSourceDrawer.jsx';

const DirectoryDrawerContext = createContext(null);

export function DirectoryDrawerProvider({ children }) {
  const [physician,      setPhysician]      = useState(null);
  const [facility,       setFacility]       = useState(null);
  const [marketer,       setMarketer]       = useState(null);
  const [referralSource, setReferralSource] = useState(null);

  const openPhysician      = useCallback((p) => setPhysician(p), []);
  const openFacility       = useCallback((f) => setFacility(f),  []);
  const openMarketer       = useCallback((m) => setMarketer(m),  []);
  const openReferralSource = useCallback((s) => setReferralSource(s), []);

  return (
    <DirectoryDrawerContext.Provider value={{ openPhysician, openFacility, openMarketer, openReferralSource }}>
      {children}
      <PhysicianDrawer      physician={physician} onClose={() => setPhysician(null)} />
      <FacilityDrawer       facility={facility}   onClose={() => setFacility(null)}  />
      <MarketerDrawer       marketer={marketer}   onClose={() => setMarketer(null)}  />
      <ReferralSourceDrawer source={referralSource} onClose={() => setReferralSource(null)} />
    </DirectoryDrawerContext.Provider>
  );
}

export function useDirectoryDrawer() {
  const ctx = useContext(DirectoryDrawerContext);
  if (!ctx) throw new Error('useDirectoryDrawer must be used inside DirectoryDrawerProvider');
  return ctx;
}
