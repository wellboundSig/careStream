import { UserButton, useUser } from '@clerk/react';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function TopBar({ breadcrumbs }) {
  const { user } = useUser();

  return (
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <img
          src="/logo-wb.png"
          alt="Wellbound"
          style={{ height: 36, objectFit: 'contain' }}
        />
        {breadcrumbs && (
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginLeft: 20,
              fontSize: 13,
              color: hexToRgba(palette.backgroundLight.hex, 0.45),
            }}
          >
            {breadcrumbs.map((crumb, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && (
                  <span style={{ opacity: 0.4 }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                <span
                  style={{
                    color: i === breadcrumbs.length - 1
                      ? palette.backgroundLight.hex
                      : hexToRgba(palette.backgroundLight.hex, 0.5),
                    fontWeight: i === breadcrumbs.length - 1 ? 550 : 400,
                  }}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <SearchBar />
        <NotificationBell />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {user && (
            <span
              style={{
                fontSize: 13,
                color: hexToRgba(palette.backgroundLight.hex, 0.65),
                fontWeight: 450,
              }}
            >
              {user.firstName} {user.lastName}
            </span>
          )}
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>

      <img
        src="/logo-cs.png"
        alt="CareStream"
        style={{
          height: 32,
          objectFit: 'contain',
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />
    </header>
  );
}

function SearchBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: hexToRgba(palette.backgroundLight.hex, 0.08),
        border: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.15)}`,
        borderRadius: 8,
        padding: '0 12px',
        height: 34,
        width: 240,
        cursor: 'text',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundLight.hex, 0.45)} strokeWidth="1.8" />
        <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundLight.hex, 0.45)} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        placeholder="Search patients, referrals..."
        style={{
          background: 'none',
          border: 'none',
          outline: 'none',
          fontSize: 13,
          color: palette.backgroundLight.hex,
          width: '100%',
        }}
      />
      <kbd
        style={{
          fontSize: 10,
          color: hexToRgba(palette.backgroundLight.hex, 0.35),
          background: hexToRgba(palette.backgroundLight.hex, 0.1),
          border: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.15)}`,
          borderRadius: 4,
          padding: '1px 5px',
          fontFamily: 'inherit',
        }}
      >
        K
      </kbd>
    </div>
  );
}

function NotificationBell() {
  return (
    <button
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hexToRgba(palette.backgroundLight.hex, 0.08),
        border: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.15)}`,
        position: 'relative',
        color: hexToRgba(palette.backgroundLight.hex, 0.7),
        transition: 'background 0.15s',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13.73 21a2 2 0 0 1-3.46 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: palette.primaryMagenta.hex,
          border: `2px solid ${palette.primaryDeepPlum.hex}`,
        }}
      />
    </button>
  );
}
