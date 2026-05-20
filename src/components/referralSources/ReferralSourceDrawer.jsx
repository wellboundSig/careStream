import { useState, useEffect } from 'react';
import { useReferralSourceData } from '../../hooks/useReferralSourceData.js';
import SourceOverviewTab from './tabs/SourceOverviewTab.jsx';
import SourcePatientsTab from './tabs/SourcePatientsTab.jsx';
import SourceMetricsTab  from './tabs/SourceMetricsTab.jsx';
import SourceReportsTab  from './tabs/SourceReportsTab.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'patients', label: 'Patients' },
  { id: 'metrics',  label: 'Metrics'  },
  { id: 'reports',  label: 'Reports'  },
];

// Same palette used in the page; kept local so the drawer header pill
// always matches the table badge.
const TYPE_COLORS = {
  CCO:             { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.18), text: '#fff' },
  Hospital:        { bg: hexToRgba(palette.primaryMagenta.hex, 0.28),  text: '#fff' },
  SNF:             { bg: hexToRgba(palette.accentOrange.hex, 0.22),    text: '#FFE7BF' },
  'PCP / MD':      { bg: hexToRgba(palette.accentGreen.hex, 0.22),     text: '#D5F3E0' },
  ALF:             { bg: hexToRgba(palette.highlightYellow.hex, 0.28), text: '#FFF1A8' },
  'Adult Home':    { bg: hexToRgba(palette.accentBlue.hex, 0.22),      text: '#D6E8FB' },
  'Care Manager':  { bg: hexToRgba(palette.accentBlue.hex, 0.24),      text: '#D6E8FB' },
  'Self-Referral': { bg: hexToRgba(palette.accentGreen.hex, 0.2),      text: '#D5F3E0' },
  Campaign:        { bg: hexToRgba(palette.primaryMagenta.hex, 0.18),  text: '#fff' },
  Other:           { bg: hexToRgba(palette.backgroundLight.hex, 0.14), text: hexToRgba(palette.backgroundLight.hex, 0.8) },
};

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function ReferralSourceDrawer({ source, onClose, onEdit }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [animated, setAnimated] = useState(false);
  const { referrals, marketer, stats, ntucReasons, stageBreakdown, divisionBreakdown, loading } = useReferralSourceData(source);

  useEffect(() => {
    if (source) {
      setActiveTab('overview');
      setAnimated(false);
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    }
    setAnimated(false);
  }, [source?.id]);

  useEffect(() => {
    if (!source) return;
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      const tag = document.activeElement?.tagName;
      const editable = document.activeElement?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      if (e.shiftKey && e.key === 'C') { onClose(); return; }
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
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
  }, [source, onClose]);

  if (!source) return null;

  const typeStyle = TYPE_COLORS[source.type] || TYPE_COLORS.Other;
  const isUnassigned = !source.marketer_id;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0), transition: 'background 0.3s', backdropFilter: animated ? 'blur(2px)' : 'none' }}
      />
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(620px, 100vw)',
          zIndex: 1001,
          background: palette.backgroundLight.hex,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
          transform: animated ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.25), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: palette.primaryMagenta.hex }}>
                {initials(source.name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.45), marginBottom: 3 }}>
                  Referral Source
                </p>
                <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {source.name || 'Unnamed'}
                </p>
                {source.source_entity && (
                  <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.55), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
                    {source.source_entity}
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {onEdit && (
                <button
                  onClick={() => onEdit(source)}
                  title="Edit source"
                  style={{ height: 28, padding: '0 11px', borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.12), border: 'none', color: palette.backgroundLight.hex, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Edit
                </button>
              )}
              <button
                onClick={onClose}
                title="Close (Esc)"
                style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.12), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.85), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {source.type && (
              <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: typeStyle.bg, color: typeStyle.text }}>
                {source.type}
              </span>
            )}
            {marketer ? (
              <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.accentBlue.hex, 0.25), color: '#D6E8FB' }}>
                Marketer: {marketer.first_name} {marketer.last_name}
              </span>
            ) : isUnassigned ? (
              <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.accentOrange.hex, 0.28), color: '#FFE7BF' }}>
                Marketer Unassigned
              </span>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
            {[
              { label: 'Referrals',  value: stats.total,    color: palette.backgroundLight.hex },
              { label: 'Active',     value: stats.active,   color: palette.primaryMagenta.hex },
              { label: 'Admitted',   value: stats.admitted, color: palette.accentGreen.hex },
              { label: 'Conversion', value: stats.total ? `${stats.convRate}%` : '—', color: stats.convRate >= 50 ? palette.accentGreen.hex : stats.convRate >= 25 ? palette.accentOrange.hex : palette.backgroundLight.hex },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', padding: '8px 0', background: hexToRgba(palette.backgroundLight.hex, 0.06), borderRadius: 8 }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 10, color: hexToRgba(palette.backgroundLight.hex, 0.45), marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, scrollbarWidth: 'none', overflowX: 'auto' }}>
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            const badge = tab.id === 'patients' ? stats.total : null;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{ padding: '11px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`, fontSize: 12.5, fontWeight: isActive ? 650 : 450, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.15s, border-color 0.15s' }}
              >
                {tab.label}
                {badge !== null && badge > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview' && <SourceOverviewTab source={source} marketer={marketer} stats={stats} />}
          {activeTab === 'patients' && <SourcePatientsTab referrals={referrals} loading={loading} />}
          {activeTab === 'metrics'  && <SourceMetricsTab stats={stats} stageBreakdown={stageBreakdown} divisionBreakdown={divisionBreakdown} ntucReasons={ntucReasons} />}
          {activeTab === 'reports'  && <SourceReportsTab source={source} referrals={referrals} />}
        </div>
      </div>
    </>
  );
}
