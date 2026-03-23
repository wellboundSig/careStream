import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import CommandPalette from '../search/CommandPalette.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// TopBar sits on the brand plum background — text/icons must stay near-white
// in all themes. Never derive these from palette.backgroundLight.
const NAV_TEXT = '#F7F7FA';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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

// ── Notification bell ──────────────────────────────────────────────────────────
function NotificationBell() {
  const navigate        = useNavigate();
  const { appUserId }   = useCurrentAppUser();
  const [open, setOpen] = useState(false);
  const wrapperRef      = useRef(null);

  const storeTasks   = useCareStore((s) => s.tasks);
  const storePatients = useCareStore((s) => s.patients);

  const { tasks, patientNames } = useMemo(() => {
    if (!appUserId) return { tasks: [], patientNames: {} };
    const myTasks = Object.values(storeTasks)
      .filter((t) => t.assigned_to === appUserId && t.status !== 'Completed' && t.status !== 'Cancelled')
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 5);

    const nameMap = {};
    for (const t of myTasks) {
      if (!t.patient_id) continue;
      const p = Object.values(storePatients).find((pt) => pt.id === t.patient_id);
      if (p) nameMap[t.patient_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    }
    return { tasks: myTasks, patientNames: nameMap };
  }, [appUserId, storeTasks, storePatients]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadCount = tasks.length;

  const TASK_TYPE_COLORS = {
    'Insurance Barrier': palette.primaryMagenta.hex,
    'Missing Document':  palette.accentOrange.hex,
    'Auth Needed':       palette.accentBlue.hex,
    'Escalation':        palette.primaryMagenta.hex,
    'Staffing':          palette.accentGreen.hex,
    'Scheduling':        palette.accentGreen.hex,
    'Follow-Up':         hexToRgba(palette.backgroundDark.hex, 0.45),
    'Other':             hexToRgba(palette.backgroundDark.hex, 0.35),
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 34, height: 34, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open
            ? hexToRgba(NAV_TEXT, 0.15)
            : hexToRgba(NAV_TEXT, 0.08),
          border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
          position: 'relative',
          color: hexToRgba(NAV_TEXT, 0.8),
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.15))}
        onMouseLeave={(e) => !open && (e.currentTarget.style.background = hexToRgba(NAV_TEXT, 0.08))}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Badge */}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, borderRadius: 8,
            background: palette.primaryMagenta.hex,
            border: `2px solid ${palette.primaryDeepPlum.hex}`,
            fontSize: 9, fontWeight: 700,
            color: NAV_TEXT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 310,
          background: NAV_TEXT,
          borderRadius: 12,
          boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
          border: `1px solid var(--color-border)`,
          overflow: 'hidden',
          zIndex: 500,
        }}>
          {/* Header */}
          <div style={{
            padding: '11px 14px 10px',
            borderBottom: `1px solid var(--color-border)`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <span style={{
                fontSize: 10.5, fontWeight: 650,
                color: palette.primaryMagenta.hex,
                background: hexToRgba(palette.primaryMagenta.hex, 0.08),
                borderRadius: 10, padding: '2px 8px',
              }}>
                {unreadCount} open
              </span>
            )}
          </div>

          {/* Task cards */}
          {tasks.length === 0 && (
            <div style={{ padding: '22px 14px', textAlign: 'center' }}>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>No open tasks assigned to you.</p>
            </div>
          )}

          {tasks.map((task) => {
            const patientName = patientNames[task.patient_id] || null;
            const typeColor   = TASK_TYPE_COLORS[task.type] || hexToRgba(palette.backgroundDark.hex, 0.35);
            return (
              <div
                key={task._id}
                onClick={() => { setOpen(false); navigate('/tasks'); }}
                style={{
                  padding: '10px 14px',
                  borderBottom: `1px solid var(--color-border)`,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03))}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Task type badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                      color: typeColor,
                      display: 'block', marginBottom: 3,
                    }}>
                      {task.type || 'Task'} assigned to you
                    </span>

                    {/* Task title */}
                    <p style={{
                      fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex,
                      margin: 0, lineHeight: 1.4,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {task.title || '(No title)'}
                    </p>

                    {/* Patient name */}
                    {patientName && (
                      <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '2px 0 0' }}>
                        Re: {patientName}
                      </p>
                    )}
                  </div>

                  <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), flexShrink: 0, marginTop: 2 }}>
                    {timeAgo(task.created_at)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Footer */}
          <div
            onClick={() => { setOpen(false); navigate('/tasks'); }}
            style={{
              padding: '10px 14px',
              cursor: 'pointer',
              textAlign: 'center',
              fontSize: 12, fontWeight: 650,
              color: palette.accentBlue.hex,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentBlue.hex, 0.05))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            View all tasks →
          </div>
        </div>
      )}
    </div>
  );
}
