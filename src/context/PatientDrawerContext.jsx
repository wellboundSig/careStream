import { createContext, useContext, useState, useCallback } from 'react';
import { mergeEntities } from '../store/careStore.js';
import { normalizeFileRecord } from '../utils/patientFilesFromStore.js';

const PatientDrawerContext = createContext(null);

export function PatientDrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [patient, setPatient] = useState(null);
  const [referral, setReferral] = useState(null);
  const [activeTab, setActiveTab] = useState('demographics');
  /** File open beside the patient snapshot (split workspace). */
  const [sideFile, setSideFile] = useState(null);
  /** Note to scroll to after opening from a mention notification. */
  const [focusNoteId, setFocusNoteId] = useState(null);
  /** Force the whole drawer view-only (e.g. opened from the Patients directory). */
  const [forceReadOnly, setForceReadOnly] = useState(false);

  const open = useCallback((patientObj, referralObj = null, tab = 'demographics', opts = {}) => {
    setPatient(patientObj);
    setReferral(referralObj);
    setActiveTab(tab);
    setSideFile(null);
    setFocusNoteId(opts?.focusNoteId || null);
    setForceReadOnly(opts?.readOnly === true);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setSideFile(null);
    setFocusNoteId(null);
    setForceReadOnly(false);
  }, []);

  const clearFocusNote = useCallback(() => setFocusNoteId(null), []);

  const openFileBeside = useCallback((file, patientObj = null, referralObj = null) => {
    if (patientObj) setPatient(patientObj);
    if (referralObj) setReferral(referralObj);
    setSideFile(file || null);
    const normalized = normalizeFileRecord(file);
    if (normalized?._id) {
      mergeEntities('files', {
        [normalized._id]: {
          ...normalized,
          ...(patientObj?.id && !normalized.patient_id ? { patient_id: patientObj.id } : {}),
          ...(referralObj?.id && !normalized.referral_id ? { referral_id: referralObj.id } : {}),
        },
      });
    }
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
        focusNoteId,
        clearFocusNote,
        forceReadOnly,
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
