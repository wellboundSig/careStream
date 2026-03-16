import { useState, useEffect } from 'react';
import { useFacilityData } from '../../hooks/useFacilityData.js';
import { TypeBadge, RegionBadge } from '../../pages/directory/Facilities.jsx';
import FacilityOverviewTab from './tabs/FacilityOverviewTab.jsx';
import FacilityPatientsTab from './tabs/FacilityPatientsTab.jsx';
import FacilityMarketersTab from './tabs/FacilityMarketersTab.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'patients',  label: 'Patients' },
  { id: 'marketers', label: 'Marketers' },
];

export default function FacilityDrawer({ facility, onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [animated, setAnimated] = useState(false);
  const { referrals, marketerLinks, marketerDetails, stats, liaisonMarketer, loading } = useFacilityData(facility);

  useEffect(() => {
    if (facility) {
      setActiveTab('overview');
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimated(false);
    }
  }, [facility?.id]);

  useEffect(() => {
    if (!facility) return;
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
  }, [facility, onClose]);

  if (!facility) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0), transition: 'background 0.3s', backdropFilter: animated ? 'blur(2px)' : 'none' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(540px, 100vw)', zIndex: 1001, background: palette.backgroundLight.hex, display: 'flex', flexDirection: 'column', boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`, transform: animated ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.45), marginBottom: 4 }}>Facility</p>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, lineHeight: 1.2, marginBottom: 4 }}>{facility.name}</h2>
              {facility.address_city && (
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.5) }}>{facility.address_city}, {facility.address_state}</p>
              )}
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            <TypeBadge type={facility.type} size="small" />
            {facility.region && <RegionBadge region={facility.region} />}
            {liaisonMarketer && (
              <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(palette.accentOrange.hex, 0.25), color: palette.accentOrange.hex }}>
                Liaison: {liaisonMarketer.first_name} {liaisonMarketer.last_name}
              </span>
            )}
          </div>

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: 'Total Referrals', value: stats.total, color: palette.backgroundLight.hex },
              { label: 'Active',          value: stats.active, color: palette.primaryMagenta.hex },
              { label: 'Admissions',      value: stats.admitted, color: palette.accentGreen.hex },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', padding: '8px 0', background: hexToRgba(palette.backgroundLight.hex, 0.06), borderRadius: 8 }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundLight.hex, 0.45), marginTop: 3 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            const badge = tab.id === 'patients' ? stats.total : tab.id === 'marketers' ? marketerLinks.length : null;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: '11px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`, fontSize: 12.5, fontWeight: isActive ? 650 : 450, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.15s' }}>
                {tab.label}
                {badge !== null && badge > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview'  && <FacilityOverviewTab facility={facility} />}
          {activeTab === 'patients'  && <FacilityPatientsTab referrals={referrals} loading={loading} />}
          {activeTab === 'marketers' && <FacilityMarketersTab marketerLinks={marketerLinks} marketerDetails={marketerDetails} loading={loading} />}
        </div>
      </div>
    </>
  );
}
