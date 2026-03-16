import { useEffect, useState, useCallback } from 'react';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import StageBadge from '../common/StageBadge.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

import OverviewTab from './tabs/OverviewTab.jsx';
import EligibilityTab from './tabs/EligibilityTab.jsx';
import TriageTab from './tabs/TriageTab.jsx';
import NotesTab from './tabs/NotesTab.jsx';
import TimelineTab from './tabs/TimelineTab.jsx';
import FilesTab from './tabs/FilesTab.jsx';
import TasksTab from './tabs/TasksTab.jsx';
import AuthorizationsTab from './tabs/AuthorizationsTab.jsx';
import ConflictsTab from './tabs/ConflictsTab.jsx';

// Always white on the dark-plum header — never inverted by dark mode
const HEADER_TEXT = '#F7F7FA';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'triage', label: 'Triage' },
  { id: 'notes', label: 'Notes' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'files', label: 'Files' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'authorizations', label: 'Auth' },
  { id: 'conflicts', label: 'Conflicts' },
];

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
  const [visible, setVisible]       = useState(false);
  const [animated, setAnimated]     = useState(false);
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

      // Shift+C closes the drawer; skip if focus is inside a text field
      if (e.shiftKey && e.key === 'C') {
        const tag = document.activeElement?.tagName;
        const editable = document.activeElement?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
        close();
        return;
      }

      // Shift+Arrow navigates tabs; skip if focus is inside a text field
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const tag = document.activeElement?.tagName;
        const editable = document.activeElement?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;

        e.preventDefault();
        setActiveTab((current) => {
          const idx = TABS.findIndex((t) => t.id === current);
          const next = e.key === 'ArrowRight'
            ? (idx + 1) % TABS.length
            : (idx - 1 + TABS.length) % TABS.length;
          return TABS[next].id;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close, setActiveTab]);

  if (!visible) return null;

  const f2f = referral ? getF2FStatus(referral.f2f_expiration) : null;
  const age = patient ? calcAge(patient.dob) : null;

  return (
    <>
      <div
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: animated ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
          zIndex: 1000,
          transition: 'background 0.3s ease',
          backdropFilter: animated ? 'blur(2px)' : 'none',
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 100vw)',
          background: palette.backgroundLight.hex,
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
          transform: animated ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        <DrawerHeader
          patient={patient}
          referral={referral}
          f2f={f2f}
          age={age}
          onClose={close}
          setActiveTab={setActiveTab}
          onNewTask={handleNewTask}
        />

        <TabBar tabs={TABS} activeTab={activeTab} setActiveTab={setActiveTab} />

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {patient && (
            <TabContent
              tab={activeTab}
              patient={patient}
              referral={referral}
              autoNewTask={autoNewTask}
              onAutoNewTaskConsumed={() => setAutoNewTask(false)}
            />
          )}
        </div>
      </div>
    </>
  );
}

function DrawerHeader({ patient, referral, f2f, age, onClose, setActiveTab, onNewTask }) {
  const name = patient
    ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
    : 'Unknown Patient';

  return (
    <div
      style={{
        background: palette.primaryDeepPlum.hex,
        padding: '16px 20px 14px',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: HEADER_TEXT,
              lineHeight: 1.2,
              marginBottom: 4,
              wordBreak: 'break-word',
            }}
          >
            {name}
          </h2>
          {patient?.dob && (
            <p style={{ fontSize: 12, color: hexToRgba(HEADER_TEXT, 0.55), marginBottom: 0 }}>
              {new Date(patient.dob).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {age !== null && ` · Age ${age}`}
              {patient.gender && ` · ${patient.gender}`}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: hexToRgba(HEADER_TEXT, 0.1),
            border: 'none',
            color: hexToRgba(HEADER_TEXT, 0.7),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            marginLeft: 12,
            marginTop: 2,
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.18))}
          onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.1))}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {/* Division — solid color, always readable on dark plum */}
        {patient?.division && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
            background: patient.division === 'Special Needs'
              ? hexToRgba(palette.primaryMagenta.hex, 0.32)
              : hexToRgba(palette.highlightYellow.hex, 0.32),
            color: patient.division === 'Special Needs' ? palette.primaryMagenta.hex : palette.highlightYellow.hex,
          }}>
            {patient.division === 'Special Needs' ? 'SN' : 'ALF'}
          </span>
        )}
        {/* Stage — white text on semi-transparent white bg, always readable */}
        {referral?.current_stage && (
          <span style={{
            fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
            background: hexToRgba(HEADER_TEXT, 0.16),
            color: hexToRgba(HEADER_TEXT, 0.92),
          }}>
            {referral.current_stage}
          </span>
        )}
        {/* F2F countdown */}
        {f2f && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
            background: hexToRgba(f2f.color, 0.28),
            color: f2f.color,
          }}>
            {f2f.label}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 14 }}>
        {[
          { label: 'Add Note', tab: 'notes' },
          { label: 'Files', tab: 'files' },
          { label: '+ Task', tab: 'tasks', action: 'new' },
        ].map((a) => (
          <button
            key={a.tab}
            onClick={() => a.action === 'new' ? onNewTask() : setActiveTab(a.tab)}
            style={{
              height: 28,
              padding: '0 12px',
              borderRadius: 7,
              background: hexToRgba(HEADER_TEXT, 0.1),
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              color: hexToRgba(HEADER_TEXT, 0.85),
              cursor: 'pointer',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.35))}
            onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(HEADER_TEXT, 0.1))}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TabBar({ tabs, activeTab, setActiveTab }) {
  return (
    <div
      style={{
        display: 'flex',
        overflowX: 'auto',
        borderBottom: `1px solid var(--color-border)`,
        background: palette.backgroundLight.hex,
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '11px 16px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
              fontSize: 12.5,
              fontWeight: isActive ? 650 : 450,
              color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s, border-color 0.15s',
              flexShrink: 0,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function TabContent({ tab, patient, referral, autoNewTask, onAutoNewTaskConsumed }) {
  const props = { patient, referral };
  switch (tab) {
    case 'overview': return <OverviewTab {...props} />;
    case 'eligibility': return <EligibilityTab {...props} />;
    case 'triage': return <TriageTab {...props} />;
    case 'notes': return <NotesTab {...props} />;
    case 'timeline': return <TimelineTab {...props} />;
    case 'files': return <FilesTab {...props} />;
    case 'tasks': return <TasksTab {...props} autoNewTask={autoNewTask} onAutoNewTaskConsumed={onAutoNewTaskConsumed} />;
    case 'authorizations': return <AuthorizationsTab {...props} />;
    case 'conflicts': return <ConflictsTab {...props} />;
    default: return null;
  }
}
