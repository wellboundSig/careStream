import { useState, useEffect } from 'react';
import { useMarketerData } from '../../hooks/useMarketerData.js';
import MarketerOverviewTab from './tabs/MarketerOverviewTab.jsx';
import MarketerReferralsTab from './tabs/MarketerReferralsTab.jsx';
import MarketerMetricsTab from './tabs/MarketerMetricsTab.jsx';
import MarketerFacilitiesTab from './tabs/MarketerFacilitiesTab.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'referrals',  label: 'Referrals' },
  { id: 'metrics',    label: 'Metrics' },
  { id: 'facilities', label: 'Facilities' },
];

const DIVISION_COLORS = {
  ALF:          { bg: hexToRgba(palette.highlightYellow.hex, 0.28), text: palette.highlightYellow.hex },
  'Special Needs': { bg: hexToRgba(palette.primaryMagenta.hex, 0.28), text: palette.primaryMagenta.hex },
  Both:         { bg: hexToRgba(palette.accentBlue.hex, 0.2),       text: palette.accentBlue.hex },
};

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

export default function MarketerDrawer({ marketer, onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { referrals, facilities, stats, ntucReasons, loading } = useMarketerData(marketer);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (marketer) {
      setActiveTab('overview');
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimated(false);
    }
  }, [marketer?.id]);

  useEffect(() => {
    if (!marketer) return;
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
  }, [marketer, onClose]);

  if (!marketer) return null;

  const divStyle = DIVISION_COLORS[marketer.division] || DIVISION_COLORS.Both;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0), transition: 'background 0.3s', backdropFilter: animated ? 'blur(2px)' : 'none' }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)',
        zIndex: 1001, background: palette.backgroundLight.hex,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
        transform: animated ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Header */}
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.25), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: palette.primaryMagenta.hex }}>
                {initials(marketer.first_name, marketer.last_name)}
              </div>
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 2 }}>{marketer.first_name} {marketer.last_name}</p>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.5) }}>{marketer.email}</p>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {marketer.region && <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(palette.backgroundLight.hex, 0.14), color: hexToRgba(palette.backgroundLight.hex, 0.85) }}>{marketer.region}</span>}
            {marketer.division && <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: divStyle.bg, color: divStyle.text }}>{marketer.division}</span>}
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: marketer.status === 'Active' ? hexToRgba(palette.accentGreen.hex, 0.22) : hexToRgba(palette.backgroundDark.hex, 0.2), color: marketer.status === 'Active' ? palette.accentGreen.hex : hexToRgba(palette.backgroundLight.hex, 0.55) }}>{marketer.status}</span>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, scrollbarWidth: 'none', overflowX: 'auto' }}>
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: '11px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`, fontSize: 12.5, fontWeight: isActive ? 650 : 450, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.15s, border-color 0.15s' }}>
                {tab.label}
                {tab.id === 'referrals' && referrals.length > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>{referrals.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview'   && <MarketerOverviewTab marketer={marketer} stats={stats} />}
          {activeTab === 'referrals'  && <MarketerReferralsTab referrals={referrals} />}
          {activeTab === 'metrics'    && <MarketerMetricsTab stats={stats} ntucReasons={ntucReasons} referrals={referrals} />}
          {activeTab === 'facilities' && <MarketerFacilitiesTab facilities={facilities} loading={loading} />}
        </div>
      </div>
    </>
  );
}
