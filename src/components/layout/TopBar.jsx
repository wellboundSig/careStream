import { useState, useEffect } from 'react';
import { UserButton, useUser } from '@clerk/react';
import CommandPalette from '../search/CommandPalette.jsx';
import NotificationBell from './NotificationBell.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// TopBar sits on the brand plum background — text/icons must stay near-white
// in all themes. Never derive these from palette.backgroundLight.
const NAV_TEXT = '#F7F7FA';

export default function TopBar({ breadcrumbs, splitEnabled, onToggleSplit, onPopOut }) {
  const { user }              = useUser();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <header
        style={{
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          background: palette.primaryDeepPlum.hex,
          borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.35)}`,
          flexShrink: 0,
          zIndex: 100,
          position: 'sticky',
          top: 0,
        }}
      >
        {/* Left: logo + breadcrumbs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <img src="/logo-wb.png" alt="Wellbound" style={{ height: 36, objectFit: 'contain' }} />
          {breadcrumbs && (
            <nav style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginLeft: 20, fontSize: 13,
              color: hexToRgba(NAV_TEXT, 0.45),
            }}>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && (
                    <span style={{ opacity: 0.4 }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                  <span style={{
                    color: i === breadcrumbs.length - 1 ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.5),
                    fontWeight: i === breadcrumbs.length - 1 ? 550 : 400,
                  }}>
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          )}
        </div>

        {/* Right: search + view buttons + bell + user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SearchBar onOpen={() => setPaletteOpen(true)} />

          {/* Split screen toggle */}
          {onToggleSplit && (
            <button
              onClick={onToggleSplit}
              title={splitEnabled ? 'Close split view' : 'Split screen'}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: splitEnabled
                  ? hexToRgba(NAV_TEXT, 0.18)
                  : hexToRgba(NAV_TEXT, 0.08),
                border: `1px solid ${hexToRgba(NAV_TEXT, splitEnabled ? 0.25 : 0.15)}`,
                cursor: 'pointer',
                color: splitEnabled ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.6),
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.18))}
              onMouseLeave={(e) => (e.currentTarget.style.background = splitEnabled ? hexToRgba(NAV_TEXT, 0.18) : hexToRgba(NAV_TEXT, 0.08))}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7.5" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                <rect x="13.5" y="3" width="7.5" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          )}

          {/* Pop-out window button */}
          {onPopOut && (
            <button
              onClick={onPopOut}
              title="Open current page in new window"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: hexToRgba(NAV_TEXT, 0.08),
                border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
                cursor: 'pointer',
                color: hexToRgba(NAV_TEXT, 0.6),
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.18))}
              onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.08))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          )}

          <NotificationBell />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {user && (
              <span style={{ fontSize: 13, color: hexToRgba(NAV_TEXT, 0.65), fontWeight: 450 }}>
                {user.firstName} {user.lastName}
              </span>
            )}
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>

        {/* Center: CareStream logo */}
        <img
          src="/logo-cs.png"
          alt="CareStream"
          style={{
            height: 32, objectFit: 'contain',
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        />
      </header>

      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

// ── Search bar (click or ⌘K to open palette) ──────────────────────────────────
function SearchBar({ onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: hexToRgba(NAV_TEXT, 0.08),
        border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
        borderRadius: 8, padding: '0 12px',
        height: 34, width: 220, cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.13))}
      onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.08))}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="8" stroke={hexToRgba(NAV_TEXT, 0.45)} strokeWidth="1.8" />
        <path d="m21 21-4.35-4.35" stroke={hexToRgba(NAV_TEXT, 0.45)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span style={{
        flex: 1, fontSize: 13,
        color: hexToRgba(NAV_TEXT, 0.45),
        userSelect: 'none',
      }}>
        Search…
      </span>
      <kbd style={{
        fontSize: 10, color: hexToRgba(NAV_TEXT, 0.35),
        background: hexToRgba(NAV_TEXT, 0.1),
        border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
        borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit',
      }}>
        ⌘K
      </kbd>
    </div>
  );
}
