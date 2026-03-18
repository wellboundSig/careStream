import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import palette, { hexToRgba } from '../utils/colors.js';

// ── Curriculum data ────────────────────────────────────────────────────────────

const MODULES = [
  {
    id: 'mod_01',
    color: palette.primaryMagenta.hex,
    title: 'Welcome to CareStream',
    description: 'Get oriented with CareStream CRM interface, and the role you play in delivering exceptional care.',
    sections: [
      { id: 's_01_1', title: 'Navigating the CRM Interface',    duration: '8 min' },
      { id: 's_01_2', title: 'Your Role & Responsibilities',  duration: '10 min' },
      { id: 's_01_3', title: 'Compliance Basics & HIPAA',     duration: '12 min' },
    ],
  },
  {
    id: 'mod_02',
    color: palette.accentBlue.hex,
    title: 'Introduction to CareStream',
    description: 'Understand what CareStream is, how it\'s structured, and how it fits into the clinical intake workflow.',
    sections: [
      { id: 's_02_1', title: 'What is CareStream?',           duration: '6 min' },
      { id: 's_02_2', title: 'Navigating the Dashboard',      duration: '8 min' },
      { id: 's_02_3', title: 'Your Account & Permissions',    duration: '5 min' },
    ],
  },
  {
    id: 'mod_03',
    color: palette.accentGreen.hex,
    title: 'Patient Management',
    description: 'Learn how patient records are created, managed, and kept accurate throughout the care journey.',
    sections: [
      { id: 's_03_1', title: 'Creating a New Patient Record', duration: '10 min' },
      { id: 's_03_2', title: 'Insurance & Eligibility',       duration: '12 min' },
      { id: 's_03_3', title: 'Files, Notes & Documentation',  duration: '9 min' },
    ],
  },
  {
    id: 'mod_04',
    color: palette.accentOrange.hex,
    title: 'The Referral Pipeline',
    description: 'Master the intake pipeline from lead entry through SOC and understand the purpose of every stage.',
    sections: [
      { id: 's_04_1', title: 'Pipeline Overview & Stages',    duration: '14 min' },
      { id: 's_04_2', title: 'Processing a Referral',         duration: '18 min' },
      { id: 's_04_3', title: 'Holds, NTUC & Escalations',     duration: '10 min' },
    ],
  },
  {
    id: 'mod_05',
    color: '#9B6DCC',
    title: 'Clinical Workflow',
    description: 'Understand how triage, clinical review, authorizations, and SOC scheduling connect in CareStream.',
    sections: [
      { id: 's_05_1', title: 'Triage Assessment',             duration: '12 min' },
      { id: 's_05_2', title: 'Authorization & Insurance',     duration: '15 min' },
      { id: 's_05_3', title: 'Pre-SOC & SOC Scheduling',      duration: '10 min' },
    ],
  },
  {
    id: 'mod_06',
    color: palette.highlightYellow.hex,
    title: 'Reporting & Best Practices',
    description: 'Use CareStream\'s reports, manage tasks effectively, and maintain data quality that drives great outcomes.',
    sections: [
      { id: 's_06_1', title: 'Reports & Analytics',           duration: '9 min' },
      { id: 's_06_2', title: 'Task Management',               duration: '7 min' },
      { id: 's_06_3', title: 'Data Quality & Best Practices', duration: '11 min' },
    ],
  },
];

const ALL_SECTIONS = MODULES.flatMap((m) =>
  m.sections.map((s) => ({ ...s, moduleId: m.id }))
);

const STORAGE_KEY = 'cs_training_v1';

// ── Sub-components ─────────────────────────────────────────────────────────────

function VideoPlaceholder() {
  return (
    <div style={{
      width: '100%', aspectRatio: '16/9', maxHeight: 440,
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
    }}>
      <img
        src="/tutorial.png"
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* Darken overlay so play button pops */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        pointerEvents: 'none',
      }} />
      {/* Play button ring */}
      <div style={{
        width: 80, height: 80, borderRadius: '50%', position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,0.12)',
        border: '2px solid rgba(255,255,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        cursor: 'pointer',
        transition: 'transform 0.15s, background 0.15s',
      }}>
        {/* Triangle shifted ~8% left to compensate for circle optical illusion */}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 3 }}>
          <path d="M8 5.14v14l11-7-11-7z" />
        </svg>
      </div>
      {/* Duration badge */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 1,
        padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
        background: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(255,255,255,0.15)',
        backdropFilter: 'blur(4px)',
      }}>
        Video
      </div>
    </div>
  );
}

function DocsPlaceholder() {
  return (
    <div>
      {/* Skeleton reading lines */}
      <div style={{ marginBottom: 28 }}>
        {[90, 75, 85, 60, 80, 70, 88, 55].map((w, i) => (
          <div key={i} style={{
            height: 13, borderRadius: 6, marginBottom: 10,
            width: `${w}%`,
            background: hexToRgba(palette.backgroundDark.hex, 0.07),
          }} />
        ))}
      </div>
    </div>
  );
}

function QuizPlaceholder() {
  const questions = [
    { label: 'Question 1', opts: ['Option A', 'Option B', 'Option C', 'Option D'] },
    { label: 'Question 2', opts: ['Option A', 'Option B', 'Option C', 'Option D'] },
    { label: 'Question 3', opts: ['Option A', 'Option B', 'Option C', 'Option D'] },
  ];
  return (
    <div>
      {questions.map((q, i) => (
        <div key={i} style={{
          marginBottom: 16, padding: '16px 18px', borderRadius: 10,
          background: hexToRgba(palette.backgroundDark.hex, 0.025),
          border: `1px solid var(--color-border)`,
        }}>
          <p style={{ fontSize: 13, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 12 }}>
            {i + 1}. {q.label} will appear here
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.opts.map((o, j) => (
              <label key={j} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'not-allowed', opacity: 0.4 }}>
                <input type="radio" name={`placeholder_q${i}`} disabled style={{ accentColor: palette.primaryMagenta.hex }} />
                <span style={{ fontSize: 13 }}>{o}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <button disabled style={{
        padding: '10px 28px', borderRadius: 8, border: 'none',
        background: hexToRgba(palette.backgroundDark.hex, 0.06),
        color: hexToRgba(palette.backgroundDark.hex, 0.3),
        fontSize: 13, fontWeight: 650, cursor: 'not-allowed',
      }}>
        Submit Answers
      </button>
    </div>
  );
}

// ── Module icon SVGs ───────────────────────────────────────────────────────────

function ModuleIcon({ index, color }) {
  const icons = [
    // Welcome — people
    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.7" strokeLinecap="round"/><circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.7"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth="1.7" strokeLinecap="round"/></>,
    // CareStream — monitor
    <><rect x="2" y="3" width="20" height="14" rx="2" stroke={color} strokeWidth="1.7"/><path d="M8 21h8M12 17v4" stroke={color} strokeWidth="1.7" strokeLinecap="round"/></>,
    // Patient — clipboard
    <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><rect x="8" y="2" width="8" height="4" rx="1" stroke={color} strokeWidth="1.7"/><path d="M9 12h6M9 16h4" stroke={color} strokeWidth="1.7" strokeLinecap="round"/></>,
    // Pipeline — flow
    <><path d="M5 12h14M12 5l7 7-7 7" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></>,
    // Clinical — stethoscope
    <><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" stroke={color} strokeWidth="1.7" strokeLinecap="round"/><path d="M14 13v4a3 3 0 0 0 6 0v-1" stroke={color} strokeWidth="1.7" strokeLinecap="round"/><circle cx="17" cy="16" r="1" fill={color}/></>,
    // Reports — bar chart
    <><line x1="18" y1="20" x2="18" y2="10" stroke={color} strokeWidth="1.7" strokeLinecap="round"/><line x1="12" y1="20" x2="12" y2="4" stroke={color} strokeWidth="1.7" strokeLinecap="round"/><line x1="6" y1="20" x2="6" y2="14" stroke={color} strokeWidth="1.7" strokeLinecap="round"/></>,
  ];
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      {icons[index] || icons[0]}
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Training() {
  const navigate = useNavigate();

  const [completed, setCompleted] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  const [activeModuleId, setActiveModuleId] = useState(MODULES[0].id);
  const [activeSectionId, setActiveSectionId] = useState(MODULES[0].sections[0].id);
  const [activeTab, setActiveTab] = useState('docs');
  const [expandedModules, setExpandedModules] = useState(new Set([MODULES[0].id]));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  }, [completed]);

  function isSectionUnlocked(sectionId) {
    const idx = ALL_SECTIONS.findIndex((s) => s.id === sectionId);
    if (idx === 0) return true;
    return completed.has(ALL_SECTIONS[idx - 1].id);
  }

  function isSectionCurrent(sectionId) { return sectionId === activeSectionId; }

  function isModuleComplete(moduleId) {
    return MODULES.find((m) => m.id === moduleId).sections.every((s) => completed.has(s.id));
  }

  function isModuleAccessible(moduleId) {
    const idx = MODULES.findIndex((m) => m.id === moduleId);
    if (idx === 0) return true;
    return isModuleComplete(MODULES[idx - 1].id);
  }

  function hasModuleStarted(moduleId) {
    return MODULES.find((m) => m.id === moduleId).sections.some((s) => completed.has(s.id));
  }

  function selectSection(moduleId, sectionId) {
    if (!isSectionUnlocked(sectionId)) return;
    setActiveModuleId(moduleId);
    setActiveSectionId(sectionId);
    setActiveTab('docs');
    setExpandedModules((prev) => new Set([...prev, moduleId]));
  }

  function toggleModule(moduleId) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function markComplete() {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(activeSectionId);
      return next;
    });
    const idx = ALL_SECTIONS.findIndex((s) => s.id === activeSectionId);
    if (idx < ALL_SECTIONS.length - 1) {
      const next = ALL_SECTIONS[idx + 1];
      setActiveModuleId(next.moduleId);
      setActiveSectionId(next.id);
      setActiveTab('docs');
      setExpandedModules((prev) => new Set([...prev, next.moduleId]));
    }
  }

  function goToPrev() {
    const idx = ALL_SECTIONS.findIndex((s) => s.id === activeSectionId);
    if (idx > 0) {
      const prev = ALL_SECTIONS[idx - 1];
      setActiveModuleId(prev.moduleId);
      setActiveSectionId(prev.id);
      setActiveTab('docs');
      setExpandedModules((prev2) => new Set([...prev2, prev.moduleId]));
    }
  }

  const activeModule     = MODULES.find((m) => m.id === activeModuleId);
  const activeSection    = activeModule.sections.find((s) => s.id === activeSectionId);
  const sectionGlobalIdx = ALL_SECTIONS.findIndex((s) => s.id === activeSectionId);
  const moduleIdx        = MODULES.findIndex((m) => m.id === activeModuleId);
  const sectionLocalIdx  = activeModule.sections.findIndex((s) => s.id === activeSectionId);
  const isComplete       = completed.has(activeSectionId);
  const isFirst          = sectionGlobalIdx === 0;
  const isLast           = sectionGlobalIdx === ALL_SECTIONS.length - 1;
  const completedCount   = completed.size;
  const totalCount       = ALL_SECTIONS.length;
  const progressPct      = Math.round((completedCount / totalCount) * 100);
  const allDone          = completedCount === totalCount;

  const TABS = [
    { id: 'docs',  label: 'Documentation', icon: 'M9 12h6M9 16h4M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
    { id: 'video', label: 'Video Lesson',   icon: 'M15 10l4.553-2.277A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z' },
    { id: 'quiz',  label: 'Knowledge Check', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#F7F7FA', fontFamily: 'inherit' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        height: 60, flexShrink: 0,
        background: '#fff',
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        display: 'flex', alignItems: 'center',
        padding: '0 24px', gap: 20,
        boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
      }}>
        {/* Logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src="/logo-cs2.png" alt="CareStream" style={{ height: 28, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 24, background: hexToRgba(palette.backgroundDark.hex, 0.1) }} />
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 750, color: palette.backgroundDark.hex, lineHeight: 1.15 }}>Training</p>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 500 }}>Onboarding</p>
          </div>
        </div>

        {/* Progress bar — center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, maxWidth: 380, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              {completedCount} of {totalCount} sections complete
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: progressPct === 100 ? palette.accentGreen.hex : palette.primaryMagenta.hex }}>
              {progressPct}%
            </span>
          </div>
          <div style={{ width: '100%', height: 5, borderRadius: 3, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${progressPct}%`,
              background: progressPct === 100
                ? palette.accentGreen.hex
                : `linear-gradient(90deg, ${palette.primaryMagenta.hex}, ${palette.accentBlue.hex})`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 7, border: `1px solid var(--color-border)`,
            background: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            color: hexToRgba(palette.backgroundDark.hex, 0.6),
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04)}
          onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to CareStream
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left sidebar ───────────────────────────────────────────────────── */}
        <div style={{
          width: 268, flexShrink: 0,
          background: palette.primaryDeepPlum.hex,
          borderRight: `1px solid ${hexToRgba('#fff', 0.07)}`,
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '16px 16px 10px' }}>
            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 3 }}>
              Curriculum
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>
              {MODULES.length} modules · {totalCount} sections
            </p>
          </div>

          <div style={{ padding: '4px 8px 24px' }}>
            {MODULES.map((mod, mIdx) => {
              const accessible  = isModuleAccessible(mod.id);
              const complete    = isModuleComplete(mod.id);
              const expanded    = expandedModules.has(mod.id);
              const isActiveMod = mod.id === activeModuleId;
              // Colors applied directly — never use opacity on containers (causes stacking)
              const modTitleColor  = accessible ? '#fff'                    : 'rgba(255,255,255,0.45)';
              const modLabelColor  = accessible ? hexToRgba(mod.color, 0.9) : 'rgba(255,255,255,0.3)';
              const iconBg         = accessible ? hexToRgba(mod.color, 0.22) : 'rgba(255,255,255,0.06)';
              const iconBorder     = accessible ? hexToRgba(mod.color, 0.55) : 'rgba(255,255,255,0.12)';
              const iconColor      = accessible ? mod.color                  : 'rgba(255,255,255,0.3)';

              return (
                <div key={mod.id} style={{ marginBottom: 2 }}>
                  {/* Module header row — NO opacity on container */}
                  <div
                    onClick={() => { if (accessible) toggleModule(mod.id); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 10px', borderRadius: 8,
                      cursor: accessible ? 'pointer' : 'default',
                      background: isActiveMod ? 'rgba(255,255,255,0.08)' : 'transparent',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => accessible && !isActiveMod && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={(e) => !isActiveMod && (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Module icon badge */}
                    <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: iconBg, border: `1.5px solid ${iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ModuleIcon index={mIdx} color={iconColor} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: modLabelColor, marginBottom: 1 }}>
                        Module {mIdx + 1}
                      </p>
                      <p style={{ fontSize: 12.5, fontWeight: 650, color: modTitleColor, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mod.title}
                      </p>
                    </div>

                    {/* Status icon */}
                    {complete ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" fill={palette.accentGreen.hex} opacity="0.25" />
                        <path d="M8 12l3 3 5-5" stroke={palette.accentGreen.hex} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : !accessible ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <rect x="3" y="11" width="18" height="11" rx="2" stroke="rgba(255,255,255,0.25)" strokeWidth="1.7" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="rgba(255,255,255,0.25)" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* Section rows */}
                  {accessible && expanded && (
                    <div style={{ marginLeft: 8, marginBottom: 4 }}>
                      {mod.sections.map((sec, sIdx) => {
                        const unlocked  = isSectionUnlocked(sec.id);
                        const secDone   = completed.has(sec.id);
                        const isCurrent = isSectionCurrent(sec.id);
                        // Colors applied directly — no opacity on container
                        const secTextColor = isCurrent   ? '#fff'
                                           : secDone     ? 'rgba(255,255,255,0.75)'
                                           : unlocked    ? 'rgba(255,255,255,0.8)'
                                           :               'rgba(255,255,255,0.42)';
                        const durColor     = unlocked ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)';

                        return (
                          <div
                            key={sec.id}
                            onClick={() => selectSection(mod.id, sec.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 10px 7px 12px', borderRadius: 7, marginBottom: 1,
                              cursor: unlocked ? 'pointer' : 'default',
                              background: isCurrent ? hexToRgba(mod.color, 0.2) : 'transparent',
                              borderLeft: isCurrent ? `3px solid ${mod.color}` : '3px solid transparent',
                              transition: 'background 0.12s',
                            }}
                            onMouseEnter={(e) => unlocked && !isCurrent && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                            onMouseLeave={(e) => !isCurrent && (e.currentTarget.style.background = 'transparent')}
                          >
                            {/* Section status icon */}
                            {secDone ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                                <circle cx="12" cy="12" r="9" fill={palette.accentGreen.hex} opacity="0.3" />
                                <path d="M8 12l3 3 5-5" stroke={palette.accentGreen.hex} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : !unlocked ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                                <rect x="3" y="11" width="18" height="11" rx="2" stroke="rgba(255,255,255,0.28)" strokeWidth="1.7" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="rgba(255,255,255,0.28)" strokeWidth="1.7" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isCurrent ? mod.color : 'rgba(255,255,255,0.35)' }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 12, fontWeight: isCurrent ? 650 : 500, color: secTextColor, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {sIdx + 1}. {sec.title}
                              </p>
                            </div>
                            <span style={{ fontSize: 10.5, flexShrink: 0, color: durColor }}>{sec.duration}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Main content ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {allDone ? (
            // ── Completion screen ────────────────────────────────────────────
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
              <div style={{ textAlign: 'center', maxWidth: 520 }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', background: hexToRgba(palette.accentGreen.hex, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke={palette.accentGreen.hex} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: palette.backgroundDark.hex, marginBottom: 12 }}>Training Complete</h1>
                <p style={{ fontSize: 15, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.7, marginBottom: 32 }}>
                  You have completed all {totalCount} sections of the CareStream onboarding curriculum. You are now ready to use CareStream.
                </p>
                <button
                  onClick={() => navigate('/')}
                  style={{ padding: '12px 32px', borderRadius: 9, border: 'none', background: palette.primaryMagenta.hex, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Open CareStream
                </button>
              </div>
            </div>
          ) : (
            // ── Section view ────────────────────────────────────────────────
            <>
              {/* Section header */}
              <div style={{ padding: '28px 36px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}` }}>
                {/* Breadcrumb */}
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 600, marginBottom: 10 }}>
                  <span style={{ color: activeModule.color, fontWeight: 700 }}>Module {moduleIdx + 1}</span>
                  {' '}·{' '}
                  {activeModule.title}
                  {' '}·{' '}
                  Section {sectionLocalIdx + 1} of {activeModule.sections.length}
                </p>

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
                  <div>
                    <h1 style={{ fontSize: 22, fontWeight: 750, color: palette.backgroundDark.hex, lineHeight: 1.25, marginBottom: 6 }}>
                      {activeSection.title}
                    </h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), display: 'flex', alignItems: 'center', gap: 4 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
                          <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                        {activeSection.duration}
                      </span>
                      {isComplete && (
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: hexToRgba(palette.accentGreen.hex, 0.12), color: palette.accentGreen.hex }}>
                          Completed
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Section progress pip row */}
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0, paddingTop: 4 }}>
                    {activeModule.sections.map((s) => (
                      <div key={s.id} style={{ width: 28, height: 4, borderRadius: 2, background: completed.has(s.id) ? activeModule.color : s.id === activeSectionId ? hexToRgba(activeModule.color, 0.4) : hexToRgba(palette.backgroundDark.hex, 0.1) }} />
                    ))}
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
                  {TABS.map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                          fontSize: 13, fontWeight: active ? 700 : 550,
                          color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.45),
                          borderBottom: active ? `2px solid ${palette.primaryMagenta.hex}` : '2px solid transparent',
                          transition: 'color 0.12s',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d={tab.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, padding: '28px 36px', maxWidth: 820 }}>
                {activeTab === 'docs'  && <DocsPlaceholder />}
                {activeTab === 'video' && <VideoPlaceholder />}
                {activeTab === 'quiz'  && <QuizPlaceholder />}
              </div>

              {/* ── Bottom action bar ────────────────────────────────────────── */}
              <div style={{
                flexShrink: 0,
                padding: '16px 36px',
                borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
                background: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                {/* Prev */}
                <button
                  onClick={goToPrev}
                  disabled={isFirst}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '9px 16px', borderRadius: 8,
                    border: `1px solid var(--color-border)`,
                    background: 'none', cursor: isFirst ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 600,
                    color: isFirst ? hexToRgba(palette.backgroundDark.hex, 0.25) : hexToRgba(palette.backgroundDark.hex, 0.6),
                    opacity: isFirst ? 0.5 : 1,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Previous
                </button>

                {/* Center: section indicator */}
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 500 }}>
                  Section {sectionGlobalIdx + 1} of {totalCount}
                </p>

                {/* Mark complete / next */}
                {isComplete ? (
                  <button
                    onClick={() => {
                      if (!isLast) {
                        const next = ALL_SECTIONS[sectionGlobalIdx + 1];
                        setActiveModuleId(next.moduleId);
                        setActiveSectionId(next.id);
                        setActiveTab('docs');
                        setExpandedModules((prev) => new Set([...prev, next.moduleId]));
                      }
                    }}
                    disabled={isLast}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: isLast ? hexToRgba(palette.accentGreen.hex, 0.12) : palette.accentGreen.hex,
                      color: isLast ? palette.accentGreen.hex : '#fff',
                      fontSize: 13, fontWeight: 700, cursor: isLast ? 'default' : 'pointer',
                    }}
                  >
                    {isLast ? 'All Sections Complete' : 'Next Section'}
                    {!isLast && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={markComplete}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: palette.primaryMagenta.hex,
                      color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      boxShadow: `0 4px 14px ${hexToRgba(palette.primaryMagenta.hex, 0.35)}`,
                      transition: 'filter 0.12s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.08)'}
                    onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Mark Section Complete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
