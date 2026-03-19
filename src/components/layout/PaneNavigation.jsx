import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { PANE_NAV } from '../../data/paneRoutes.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const NAV_TEXT = '#F7F7FA';

function getCurrentLabel(pathname) {
  for (const group of PANE_NAV) {
    for (const item of group.items) {
      if (item.path === pathname) return item.label;
    }
  }
  return 'Dashboard';
}

export default function PaneNavigation({ onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentLabel = getCurrentLabel(location.pathname);

  return (
    <div
      ref={ref}
      style={{
        height: 36,
        flexShrink: 0,
        background: palette.primaryDeepPlum.hex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        borderBottom: `1px solid ${hexToRgba(NAV_TEXT, 0.08)}`,
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Page selector */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: hexToRgba(NAV_TEXT, 0.08),
          border: `1px solid ${hexToRgba(NAV_TEXT, 0.12)}`,
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          color: NAV_TEXT,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        {currentLabel}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Close split button */}
      <button
        onClick={onClose}
        title="Close split view"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: hexToRgba(NAV_TEXT, 0.08),
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hexToRgba(NAV_TEXT, 0.6),
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.15))}
        onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.08))}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 10,
            width: 220,
            background: 'var(--color-bg, #F7F7FA)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
            maxHeight: 380,
            overflowY: 'auto',
            zIndex: 100,
          }}
        >
          {PANE_NAV.map((group) => (
            <div key={group.group}>
              <div
                style={{
                  padding: '8px 12px 4px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: hexToRgba(palette.backgroundDark.hex, 0.35),
                }}
              >
                {group.group}
              </div>
              {group.items.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 12px',
                      background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 12.5,
                      fontWeight: isActive ? 600 : 430,
                      color: isActive ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04);
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
