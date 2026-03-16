import { createContext, useContext, useState, useCallback } from 'react';
import PhysicianDrawer from '../components/physicians/PhysicianDrawer.jsx';
import FacilityDrawer  from '../components/facilities/FacilityDrawer.jsx';
import MarketerDrawer  from '../components/marketers/MarketerDrawer.jsx';

const DirectoryDrawerContext = createContext(null);

export function DirectoryDrawerProvider({ children }) {
  const [physician, setPhysician] = useState(null);
  const [facility,  setFacility]  = useState(null);
  const [marketer,  setMarketer]  = useState(null);

  const openPhysician = useCallback((p) => setPhysician(p), []);
  const openFacility  = useCallback((f) => setFacility(f),  []);
  const openMarketer  = useCallback((m) => setMarketer(m),  []);

  return (
    <DirectoryDrawerContext.Provider value={{ openPhysician, openFacility, openMarketer }}>
      {children}
      <PhysicianDrawer physician={physician} onClose={() => setPhysician(null)} />
      <FacilityDrawer  facility={facility}   onClose={() => setFacility(null)}  />
      <MarketerDrawer  marketer={marketer}   onClose={() => setMarketer(null)}  />
    </DirectoryDrawerContext.Provider>
  );
}

export function useDirectoryDrawer() {
  const ctx = useContext(DirectoryDrawerContext);
  if (!ctx) throw new Error('useDirectoryDrawer must be used inside DirectoryDrawerProvider');
  return ctx;
}
