import { createContext, useContext, useState, useCallback } from 'react';

const PatientDrawerContext = createContext(null);

export function PatientDrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [patient, setPatient] = useState(null);
  const [referral, setReferral] = useState(null);
  const [activeTab, setActiveTab] = useState('demographics');
  /** File open beside the patient snapshot (split workspace). */
  const [sideFile, setSideFile] = useState(null);

  const open = useCallback((patientObj, referralObj = null, tab = 'demographics') => {
    setPatient(patientObj);
    setReferral(referralObj);
    setActiveTab(tab);
    setSideFile(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setSideFile(null);
  }, []);

  const openFileBeside = useCallback((file, patientObj = null, referralObj = null) => {
    if (patientObj) setPatient(patientObj);
    if (referralObj) setReferral(referralObj);
    setSideFile(file || null);
    // Keep staff on a work tab — Overview/Referral is the natural snapshot.
    setActiveTab((prev) => (prev === 'files' ? 'overview' : prev));
    setIsOpen(true);
  }, []);

  const clearSideFile = useCallback(() => {
    setSideFile(null);
  }, []);

  const updatePatientLocal = useCallback((updates) => {
    setPatient((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const updateReferralLocal = useCallback((updates) => {
    setReferral((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  return (
    <PatientDrawerContext.Provider
      value={{
        isOpen,
        patient,
        referral,
        activeTab,
        setActiveTab,
        open,
        close,
        updatePatientLocal,
        updateReferralLocal,
        sideFile,
        openFileBeside,
        clearSideFile,
      }}
    >
      {children}
    </PatientDrawerContext.Provider>
  );
}

export function usePatientDrawer() {
  const ctx = useContext(PatientDrawerContext);
  if (!ctx) throw new Error('usePatientDrawer must be used inside PatientDrawerProvider');
  return ctx;
}
