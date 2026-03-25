import { createContext, useContext, useState, useCallback } from 'react';

const PatientDrawerContext = createContext(null);

export function PatientDrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [patient, setPatient] = useState(null);
  const [referral, setReferral] = useState(null);
  const [activeTab, setActiveTab] = useState('demographics');

  const open = useCallback((patientObj, referralObj = null, tab = 'demographics') => {
    setPatient(patientObj);
    setReferral(referralObj);
    setActiveTab(tab);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updatePatientLocal = useCallback((updates) => {
    setPatient((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const updateReferralLocal = useCallback((updates) => {
    setReferral((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  return (
    <PatientDrawerContext.Provider
      value={{ isOpen, patient, referral, activeTab, setActiveTab, open, close, updatePatientLocal, updateReferralLocal }}
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
