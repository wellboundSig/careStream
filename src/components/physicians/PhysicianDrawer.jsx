import { useState, useEffect } from 'react';
import { usePhysicianData } from '../../hooks/usePhysicianData.js';
import PhysicianOverviewTab from './tabs/PhysicianOverviewTab.jsx';
import PhysicianPatientsTab from './tabs/PhysicianPatientsTab.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'patients', label: 'Patients' }];

export default function PhysicianDrawer({ physician, onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [animated, setAnimated] = useState(false);
  // Only track the fields that can be toggled from inside the drawer.
  // Everything else reads directly from the physician prop so there's no stale-state flash.
  const [enrollmentOverride, setEnrollmentOverride] = useState(null);
  const { referrals, stats, loading } = usePhysicianData(physician);

  useEffect(() => {
    if (physician) {
      setEnrollmentOverride(null); // reset overrides for new physician
      setActiveTab('overview');
      setAnimated(false); // brief reset so the slide-in re-fires
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimated(false);
    }
  }, [physician?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!physician) return;
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
  }, [physician, onClose]);

  if (!physician) return null;

  function handleUpdated(fields) {
    setEnrollmentOverride((prev) => ({ ...(prev || {}), ...fields }));
  }

  const isPecos = (enrollmentOverride?.is_pecos_enrolled ?? physician.is_pecos_enrolled) === true
    || (enrollmentOverride?.is_pecos_enrolled ?? physician.is_pecos_enrolled) === 'true';
  const isOpra  = (enrollmentOverride?.is_opra_enrolled ?? physician.is_opra_enrolled) === true
    || (enrollmentOverride?.is_opra_enrolled ?? physician.is_opra_enrolled) === 'true';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0), transition: 'background 0.3s', backdropFilter: animated ? 'blur(2px)' : 'none' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)', zIndex: 1001, background: palette.backgroundLight.hex, display: 'flex', flexDirection: 'column', boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`, transform: animated ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden' }}>
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.45), marginBottom: 3 }}>Physician</p>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 3 }}>Dr. {physician.first_name} {physician.last_name}</h2>
              {physician.address_city && <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.5) }}>{physician.address_city}, {physician.address_state}</p>}
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {[isPecos && 'PECOS', isOpra && 'OPRA'].filter(Boolean).map((lbl) => (
              <span key={lbl} style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(palette.accentGreen.hex, 0.25), color: palette.accentGreen.hex }}>{lbl} ✓</span>
            ))}
            {!isPecos && <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(palette.primaryMagenta.hex, 0.2), color: palette.primaryMagenta.hex }}>PECOS not enrolled</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[{ label: 'Referrals', value: stats.total }, { label: 'Active', value: stats.active, color: palette.primaryMagenta.hex }, { label: 'Admitted', value: stats.admitted, color: palette.accentGreen.hex }].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', padding: '7px 0', background: hexToRgba(palette.backgroundLight.hex, 0.06), borderRadius: 8 }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: s.color || palette.backgroundLight.hex, lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundLight.hex, 0.45), marginTop: 3 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: '11px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`, fontSize: 12.5, fontWeight: isActive ? 650 : 450, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', flexShrink: 0 }}>
                {tab.label}{tab.id === 'patients' && stats.total > 0 && <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 700 }}>{stats.total}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview' && <div style={{ overflowY: 'auto' }}><PhysicianOverviewTab physician={physician} onUpdated={handleUpdated} /></div>}
          {activeTab === 'patients' && <PhysicianPatientsTab referrals={referrals} loading={loading} />}
        </div>
      </div>
    </>
  );
}
