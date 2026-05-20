import { useState, useEffect, useMemo } from 'react';
import ClinicianProfileTab  from './tabs/ClinicianProfileTab.jsx';
import ClinicianDeviceTab   from './tabs/ClinicianDeviceTab.jsx';
import ClinicianNetworkTab  from './tabs/ClinicianNetworkTab.jsx';
import ClinicianLocationTab from './tabs/ClinicianLocationTab.jsx';
import ClinicianTagsTab     from './tabs/ClinicianTagsTab.jsx';
import { initials, timeAgo, modelLabel } from '../../utils/clinicianInfo.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const TABS = [
  { id: 'profile',  label: 'Profile'  },
  { id: 'device',   label: 'Device'   },
  { id: 'network',  label: 'Network'  },
  { id: 'location', label: 'Location' },
  { id: 'tags',     label: 'Tags'     },
];

const DISC_COLORS = {
  RN: palette.primaryMagenta.hex, LPN: palette.primaryMagenta.hex,
  PT: palette.accentBlue.hex, PTA: hexToRgba(palette.accentBlue.hex, 0.7),
  OT: palette.accentOrange.hex, OTA: hexToRgba(palette.accentOrange.hex, 0.7),
  SLP: palette.accentGreen.hex, ST: palette.accentGreen.hex,
  HHA: palette.highlightYellow.hex, ABA: palette.primaryDeepPlum.hex,
  NP: palette.primaryMagenta.hex, PA: hexToRgba(palette.primaryMagenta.hex, 0.7),
};

export default function ClinicianDrawer({ clinician, onClose }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [animated, setAnimated]   = useState(false);

  useEffect(() => {
    if (clinician) {
      setActiveTab('profile');
      setAnimated(false);
      const t = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(t);
    }
    setAnimated(false);
  }, [clinician?.id]);

  useEffect(() => {
    if (!clinician) return;
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
  }, [clinician, onClose]);

  const device = clinician?.device || {};
  const model = useMemo(() => modelLabel(device.hardware), [device.hardware]);
  const lastSeenLabel = useMemo(() => timeAgo(device.lastSeen || clinician?.location?.lastSeen), [device.lastSeen, clinician?.location?.lastSeen]);
  const battery = device.power?.batteryLevel ?? null;

  if (!clinician) return null;

  const discColor = DISC_COLORS[clinician.discipline] || hexToRgba(palette.backgroundLight.hex, 0.6);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0), transition: 'background 0.3s', backdropFilter: animated ? 'blur(2px)' : 'none' }}
      />
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(560px, 100vw)',
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
              <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.25), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: palette.primaryMagenta.hex }}>
                {initials(clinician.displayName || clinician.name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.45), marginBottom: 3 }}>
                  Clinician
                </p>
                <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clinician.displayName || clinician.name || 'Unnamed'}
                </p>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.55), display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {clinician.workerId && <span>#{clinician.workerId}</span>}
                  {model && <span>· {model}</span>}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              title="Close (Esc)"
              style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.12), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.85), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {clinician.discipline && (
              <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(discColor, 0.28), color: discColor }}>
                {clinician.discipline}
              </span>
            )}
            <span style={{
              fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: clinician.online ? hexToRgba(palette.accentGreen.hex, 0.25) : hexToRgba(palette.backgroundLight.hex, 0.1),
              color: clinician.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundLight.hex, 0.6),
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: clinician.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundLight.hex, 0.3) }} />
              {clinician.online ? 'Online' : 'Offline'}
            </span>
            {lastSeenLabel && (
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.backgroundLight.hex, 0.1), color: hexToRgba(palette.backgroundLight.hex, 0.7) }}>
                Seen {lastSeenLabel}
              </span>
            )}
            {clinician.zip && (
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.backgroundLight.hex, 0.1), color: hexToRgba(palette.backgroundLight.hex, 0.7) }}>
                ZIP {clinician.zip}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
            <HeaderTile label="Battery" value={battery != null ? `${battery}%` : '—'} color={battery == null ? palette.backgroundLight.hex : battery <= 15 ? palette.primaryMagenta.hex : battery <= 35 ? palette.accentOrange.hex : palette.accentGreen.hex} />
            <HeaderTile label="OS" value={device.software?.androidVersion || device.software?.osVersion || '—'} color={palette.backgroundLight.hex} />
            <HeaderTile label="Storage" value={device.hardware?.storageBytes ? formatGb(device.hardware.storageBytes) : '—'} color={palette.backgroundLight.hex} />
            <HeaderTile label="State" value={device.state || (clinician.online ? 'Active' : 'Idle')} color={palette.backgroundLight.hex} />
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, scrollbarWidth: 'none', overflowX: 'auto' }}>
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{ padding: '11px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`, fontSize: 12.5, fontWeight: isActive ? 650 : 450, color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'color 0.15s, border-color 0.15s' }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {activeTab === 'profile'  && <ClinicianProfileTab clinician={clinician} />}
          {activeTab === 'device'   && <ClinicianDeviceTab clinician={clinician} />}
          {activeTab === 'network'  && <ClinicianNetworkTab clinician={clinician} />}
          {activeTab === 'location' && <ClinicianLocationTab clinician={clinician} />}
          {activeTab === 'tags'     && <ClinicianTagsTab clinician={clinician} />}
        </div>
      </div>
    </>
  );
}

function HeaderTile({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '7px 4px', background: hexToRgba(palette.backgroundLight.hex, 0.06), borderRadius: 8 }}>
      <p style={{ fontSize: 14, fontWeight: 700, color, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
      <p style={{ fontSize: 10, color: hexToRgba(palette.backgroundLight.hex, 0.5), marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</p>
    </div>
  );
}

function formatGb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 1e9).toFixed(0)} GB`;
}
