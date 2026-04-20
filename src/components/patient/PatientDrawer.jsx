import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useCareStore } from '../../store/careStore.js';
import DivisionBadge from '../common/DivisionBadge.jsx';
import StageBadge from '../common/StageBadge.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';

import { isTriageComplete } from '../../utils/triageCompleteness.js';
import OverviewTab from './tabs/OverviewTab.jsx';
import ReferralInfoTab from './tabs/ReferralInfoTab.jsx';
import EligibilityTab from './tabs/EligibilityTab.jsx';
import TriageTab from './tabs/TriageTab.jsx';
import F2FTab from './tabs/F2FTab.jsx';
import NotesTab from './tabs/NotesTab.jsx';
import TimelineTab from './tabs/TimelineTab.jsx';
import FilesTab from './tabs/FilesTab.jsx';
import TasksTab from './tabs/TasksTab.jsx';
import AuthorizationsTab from './tabs/AuthorizationsTab.jsx';
import ConflictsTab from './tabs/ConflictsTab.jsx';
import ClinicalReviewTab from './tabs/ClinicalReviewTab.jsx';

const HEADER_TEXT = '#F7F7FA';

export const DRAWER_TABS = [
  { id: 'overview', label: 'Referral' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'triage', label: 'Triage' },
  { id: 'f2f', label: 'Face to Face' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'notes', label: 'Notes' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'files', label: 'Files' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'clinical_review', label: 'Clinical Review' },
  { id: 'authorizations', label: 'Auth' },
  { id: 'conflicts', label: 'Conflicts' },
];

const TAB_EDIT_PERMISSIONS = {
  overview:        PERMISSION_KEYS.SNAPSHOT_EDIT_REFERRAL,
  demographics:    PERMISSION_KEYS.SNAPSHOT_EDIT_DEMOGRAPHICS,
  triage:          PERMISSION_KEYS.SNAPSHOT_EDIT_TRIAGE,
  f2f:             PERMISSION_KEYS.SNAPSHOT_EDIT_F2F,
  eligibility:     PERMISSION_KEYS.SNAPSHOT_EDIT_ELIGIBILITY,
  notes:           PERMISSION_KEYS.SNAPSHOT_EDIT_NOTES,
  timeline:        null,
  files:           PERMISSION_KEYS.SNAPSHOT_EDIT_FILES,
  tasks:           PERMISSION_KEYS.SNAPSHOT_EDIT_TASKS,
  clinical_review: PERMISSION_KEYS.SNAPSHOT_EDIT_CLINICAL_REVIEW,
  authorizations:  PERMISSION_KEYS.SNAPSHOT_EDIT_AUTHORIZATIONS,
  conflicts:       PERMISSION_KEYS.SNAPSHOT_EDIT_CONFLICTS,
};

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

function getF2FStatus(f2fExpiration) {
  if (!f2fExpiration) return null;
  const days = Math.ceil((new Date(f2fExpiration) - Date.now()) / 86400000);
  if (days < 0) return { label: 'F2F Expired', color: palette.primaryMagenta.hex, days };
  if (days <= 7) return { label: `F2F ${days}d`, color: palette.primaryMagenta.hex, days };
  if (days <= 14) return { label: `F2F ${days}d`, color: palette.accentOrange.hex, days };
  if (days <= 30) return { label: `F2F ${days}d`, color: palette.highlightYellow.hex, days };
  return { label: `F2F ${days}d`, color: palette.accentGreen.hex, days };
}

export default function PatientDrawer() {
  const { isOpen, patient, referral, activeTab, setActiveTab, close } = usePatientDrawer();
  const [visible, setVisible] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [autoNewTask, setAutoNewTask] = useState(false);

  const handleNewTask = useCallback(() => {
    setActiveTab('tasks');
    setAutoNewTask(true);
  }, [setActiveTab]);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimated(false);
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.shiftKey && e.key === 'C') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
        close();
        return;
      }
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        setActiveTab((current) => {
          const idx = DRAWER_TABS.findIndex((t) => t.id === current);
          const next = e.key === 'ArrowRight' ? (idx + 1) % DRAWER_TABS.length : (idx - 1 + DRAWER_TABS.length) % DRAWER_TABS.length;
          return DRAWER_TABS[next].id;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close, setActiveTab]);

  // Tab completeness — computed from patient + referral + store data
  const storeInsChecks = useCareStore((s) => s.insuranceChecks);
  const storeTriageA = useCareStore((s) => s.triageAdult);
  const storeTriageP = useCareStore((s) => s.triagePediatric);
  const storeAuths = useCareStore((s) => s.authorizations);

  const tabComplete = useMemo(() => {
    if (!patient || !referral) return {};
    const p = patient;
    const r = referral;
    const result = {};

    // Demographics: core fields + emergency contact (name and phone)
    const demoFields = [
      p.first_name, p.last_name, p.phone_primary, p.dob,
      p.address_street, p.address_city, p.address_state, p.address_zip,
      p.emergency_contact_name, p.emergency_contact_phone,
    ];
    result.demographics = demoFields.every((f) => f && String(f).trim());

    // Overview: has owner + marketer + source
    result.overview = !!(r.intake_owner_id && r.marketer_id && r.referral_source_id);

    // Eligibility: at least one check exists AND patient is not currently back in Eligibility stage
    const hasCheck = Object.values(storeInsChecks).some((c) => c.patient_id === p.id);
    const inEligStage = r.current_stage === 'Eligibility Verification';
    result.eligibility = hasCheck && !inEligStage;

    // Triage: ALL fields must be filled with valid data (SN only; ALF is N/A so mark complete)
    if (r.division === 'Special Needs') {
      const triageRecord =
        Object.values(storeTriageA).find((t) => t.referral_id === r.id || (Array.isArray(t.referral_id) && t.referral_id.includes(r.id))) ||
        Object.values(storeTriageP).find((t) => t.referral_id === r.id || (Array.isArray(t.referral_id) && t.referral_id.includes(r.id)));
      if (!triageRecord) {
        result.triage = false;
      } else {
        const age = calcAge(p.dob);
        const type = age !== null && age < 18 ? 'pediatric' : 'adult';
        const check = isTriageComplete(triageRecord, type);
        result.triage = check.complete === true && check.missing.length === 0;
      }
    } else {
      result.triage = true;
    }

    // Clinical Review: decision was made
    result.clinical_review = !!r.clinical_review_decision;

    // Auth: at least one auth record AND not currently in Auth Pending stage
    const hasAuth = Object.values(storeAuths).some((a) => a.referral_id === r.id);
    const inAuthStage = r.current_stage === 'Authorization Pending';
    result.authorizations = hasAuth && !inAuthStage;

    return result;
  }, [patient, referral, storeInsChecks, storeTriageA, storeTriageP, storeAuths]);

  if (!visible) return null;

  const f2f = referral ? getF2FStatus(referral.f2f_expiration) : null;
  const age = patient ? calcAge(patient.dob) : null;

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: animated ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)', zIndex: 1000, transition: 'background 0.3s ease', backdropFilter: animated ? 'blur(2px)' : 'none' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)', background: palette.backgroundLight.hex, zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`, transform: animated ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden' }}>
        <DrawerHeader patient={patient} referral={referral} f2f={f2f} age={age} onClose={close} setActiveTab={setActiveTab} onNewTask={handleNewTask} />
        <ScrollableTabBar tabs={DRAWER_TABS} activeTab={activeTab} setActiveTab={setActiveTab} tabComplete={tabComplete} />
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {patient && <TabContent tab={activeTab} patient={patient} referral={referral} autoNewTask={autoNewTask} onAutoNewTaskConsumed={() => setAutoNewTask(false)} />}
        </div>
      </div>
    </>
  );
}

function DrawerHeader({ patient, referral, f2f, age, onClose, setActiveTab, onNewTask }) {
  const name = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Unknown Patient';
  return (
    <div style={{ background: palette.primaryDeepPlum.hex, padding: '16px 20px 14px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: HEADER_TEXT, lineHeight: 1.2, marginBottom: 4, wordBreak: 'break-word' }}>{name}</h2>
          {patient?.dob && (
            <p style={{ fontSize: 12, color: hexToRgba(HEADER_TEXT, 0.55), marginBottom: 0 }}>
              {new Date(patient.dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {age !== null && ` · Age ${age}`}
              {patient.gender && ` · ${patient.gender}`}
            </p>
          )}
        </div>
        <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: hexToRgba(HEADER_TEXT, 0.1), border: 'none', color: hexToRgba(HEADER_TEXT, 0.7), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, marginLeft: 12, marginTop: 2 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.18))}
          onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.1))}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {patient?.division && (
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: patient.division === 'Special Needs' ? hexToRgba(palette.primaryMagenta.hex, 0.32) : hexToRgba(palette.highlightYellow.hex, 0.32), color: patient.division === 'Special Needs' ? palette.primaryMagenta.hex : palette.highlightYellow.hex }}>
            {patient.division === 'Special Needs' ? 'SPN' : 'ALF'}
          </span>
        )}
        {referral?.current_stage && (
          <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: hexToRgba(HEADER_TEXT, 0.16), color: hexToRgba(HEADER_TEXT, 0.92) }}>{referral.current_stage}</span>
        )}
        {f2f && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: hexToRgba(f2f.color, 0.28), color: f2f.color }}>{f2f.label}</span>}
      </div>
      <div style={{ display: 'flex', gap: 7, marginTop: 14 }}>
        {[{ label: 'Add Note', tab: 'notes' }, { label: 'Files', tab: 'files' }, { label: '+ Task', tab: 'tasks', action: 'new' }].map((a) => (
          <button key={a.tab} onClick={() => a.action === 'new' ? onNewTask() : setActiveTab(a.tab)}
            style={{ height: 28, padding: '0 12px', borderRadius: 7, background: hexToRgba(HEADER_TEXT, 0.1), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(HEADER_TEXT, 0.85), cursor: 'pointer', transition: 'background 0.12s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.35))}
            onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.1))}
          >{a.label}</button>
        ))}
      </div>
    </div>
  );
}

// ── Scrollable TabBar with arrow buttons + click-and-drag scroll ────────────

function ScrollableTabBar({ tabs, activeTab, setActiveTab, tabComplete = {} }) {
  const scrollRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const dragState = useRef({ dragging: false, startX: 0, scrollLeft: 0 });

  function updateArrows() {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 2);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', updateArrows); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector(`[data-tab="${activeTab}"]`);
    if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeTab]);

  function scrollBy(delta) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }

  function onMouseDown(e) {
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = { dragging: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.style.cursor = 'grabbing';
  }
  function onMouseMove(e) {
    if (!dragState.current.dragging) return;
    e.preventDefault();
    const el = scrollRef.current;
    const x = e.pageX - el.offsetLeft;
    el.scrollLeft = dragState.current.scrollLeft - (x - dragState.current.startX);
  }
  function onMouseUp() {
    dragState.current.dragging = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  }

  const arrowStyle = (side) => ({
    position: 'absolute', [side]: 0, top: 0, bottom: 0, width: 28, zIndex: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${palette.backgroundLight.hex} 60%, transparent)`,
    border: 'none', cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5),
    transition: 'opacity 0.15s', padding: 0,
  });

  return (
    <div style={{ position: 'relative', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
      {showLeft && (
        <button data-testid="tab-arrow-left" onClick={() => scrollBy(-120)} style={arrowStyle('left')} title="Scroll tabs left">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {showRight && (
        <button data-testid="tab-arrow-right" onClick={() => scrollBy(120)} style={arrowStyle('right')} title="Scroll tabs right">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div
        ref={scrollRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          display: 'flex', overflowX: 'auto', background: palette.backgroundLight.hex,
          scrollbarWidth: 'none', cursor: 'grab', userSelect: 'none',
          paddingLeft: showLeft ? 28 : 0, paddingRight: showRight ? 28 : 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const isComplete = tabComplete[tab.id] === true;
          const tabColor = isActive ? palette.primaryMagenta.hex : isComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.5);
          return (
            <button key={tab.id} data-tab={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '11px 16px', background: 'none', border: 'none',
                borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
                fontSize: 12.5, fontWeight: isActive ? 650 : isComplete ? 600 : 450,
                color: tabColor,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.15s, border-color 0.15s', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {tab.label}
              {isComplete && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="6" cy="6" r="5.5" fill={palette.accentGreen.hex} />
                  <path d="M3.5 6l2 2 3-3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TabContent({ tab, patient, referral, autoNewTask, onAutoNewTaskConsumed }) {
  const { can } = usePermissions();
  const editPermKey = TAB_EDIT_PERMISSIONS[tab];
  const canEdit = editPermKey ? can(editPermKey) : false;
  const props = { patient, referral, readOnly: !canEdit };

  return (
    <>
      {!canEdit && editPermKey && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 20px', flexShrink: 0,
          background: hexToRgba(palette.highlightYellow.hex, 0.1),
          borderBottom: `1px solid ${hexToRgba(palette.highlightYellow.hex, 0.25)}`,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="#7A5F00" strokeWidth="1.8" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#7A5F00" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7A5F00' }}>View only</span>
        </div>
      )}
      {(() => {
        switch (tab) {
          case 'overview': return <ReferralInfoTab {...props} />;
          case 'demographics': return <OverviewTab {...props} />;
          case 'triage': return <TriageTab {...props} />;
          case 'f2f': return <F2FTab {...props} />;
          case 'eligibility': return <EligibilityTab {...props} />;
          case 'notes': return <NotesTab {...props} />;
          case 'timeline': return <TimelineTab {...props} />;
          case 'files': return <FilesTab {...props} />;
          case 'tasks': return <TasksTab {...props} autoNewTask={!canEdit ? false : autoNewTask} onAutoNewTaskConsumed={onAutoNewTaskConsumed} />;
          case 'clinical_review': return <ClinicalReviewTab {...props} />;
          case 'authorizations': return <AuthorizationsTab {...props} />;
          case 'conflicts': return <ConflictsTab {...props} />;
          default: return null;
        }
      })()}
    </>
  );
}
