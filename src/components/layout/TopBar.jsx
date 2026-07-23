import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import {
  markNotificationReadOptimistic,
  markAllNotificationsReadOptimistic,
} from '../../store/mutations.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
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
  const navigate = useNavigate();
  const { appUserId } = useCurrentAppUser();
  const { open: openPatient } = usePatientDrawer();
  const { resolveUser } = useLookups();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const storeNotifications = useCareStore((s) => s.notifications);
  const storeTasks = useCareStore((s) => s.tasks);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);

  const { inbox, unreadCount, openTaskCount } = useMemo(() => {
    if (!appUserId) return { inbox: [], unreadCount: 0, openTaskCount: 0 };
    const mine = Object.values(storeNotifications || {})
      .filter((n) => n.recipient_user_id === appUserId)
      .sort((a, b) => {
        const ar = a.is_read === true || a.is_read === 'true' ? 1 : 0;
        const br = b.is_read === true || b.is_read === 'true' ? 1 : 0;
        if (ar !== br) return ar - br;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      })
      .slice(0, 12);

    const unread = mine.filter((n) => !(n.is_read === true || n.is_read === 'true')).length;
    const openTasks = Object.values(storeTasks || {}).filter(
      (t) => t.assigned_to_id === appUserId && t.status !== 'Completed' && t.status !== 'Cancelled',
    ).length;

    return { inbox: mine, unreadCount: unread, openTaskCount: openTasks };
  }, [appUserId, storeNotifications, storeTasks]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function patientFor(id) {
    if (!id) return null;
    return Object.values(storePatients || {}).find((p) => p.id === id) || null;
  }

  function referralFor(patientId, referralId) {
    if (referralId) {
      const byId = Object.values(storeReferrals || {}).find((r) => r.id === referralId);
      if (byId) return byId;
    }
    if (!patientId) return null;
    return Object.values(storeReferrals || {}).find((r) => r.patient_id === patientId) || null;
  }

  function openNotification(n) {
    const isRead = n.is_read === true || n.is_read === 'true';
    if (!isRead && n._id && !String(n._id).startsWith('_pending_')) {
      markNotificationReadOptimistic(n._id).catch(() => {});
    }
    setOpen(false);

    if (n.patient_id) {
      const patient = patientFor(n.patient_id) || {
        id: n.patient_id,
        _id: n.patient_id,
      };
      const referral = referralFor(n.patient_id, n.referral_id);
      openPatient(patient, referral, 'notes');
      return;
    }
    if (n.type === 'task' || n.entity_type === 'task') {
      navigate('/tasks');
    }
  }

  function markAllRead() {
    if (!appUserId || unreadCount === 0) return;
    markAllNotificationsReadOptimistic(appUserId);
  }

  const badgeCount = unreadCount;

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

        {badgeCount > 0 && (
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
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 340,
          background: NAV_TEXT,
          borderRadius: 12,
          boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
          border: `1px solid var(--color-border)`,
          overflow: 'hidden',
          zIndex: 500,
        }}>
          <div style={{
            padding: '11px 14px 10px',
            borderBottom: `1px solid var(--color-border)`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Notifications
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {unreadCount > 0 && (
                <>
                  <span style={{
                    fontSize: 10.5, fontWeight: 650,
                    color: palette.primaryMagenta.hex,
                    background: hexToRgba(palette.primaryMagenta.hex, 0.08),
                    borderRadius: 10, padding: '2px 8px',
                  }}>
                    {unreadCount} new
                  </span>
                  <button
                    type="button"
                    onClick={markAllRead}
                    style={{
                      fontSize: 11, fontWeight: 650, border: 'none', background: 'none',
                      color: palette.accentBlue.hex, cursor: 'pointer', padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    Mark all read
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {inbox.length === 0 ? (
              <div style={{ padding: '22px 14px', textAlign: 'center' }}>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
                  No notifications yet.
                </p>
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '6px 0 0' }}>
                  You’ll be notified when someone @mentions you in a note.
                </p>
              </div>
            ) : (
              inbox.map((n) => {
                const isRead = n.is_read === true || n.is_read === 'true';
                const actor = n.actor_user_id ? resolveUser(n.actor_user_id) : null;
                const typeLabel = n.type === 'mention'
                  ? 'Mention'
                  : n.type === 'intake_owner_assigned'
                    ? 'Ownership'
                    : (n.type || 'Alert');
                return (
                  <div
                    key={n._id}
                    onClick={() => openNotification(n)}
                    style={{
                      padding: '11px 14px',
                      borderBottom: `1px solid var(--color-border)`,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      background: isRead
                        ? 'transparent'
                        : hexToRgba(palette.accentBlue.hex, 0.05),
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04);
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isRead
                        ? 'transparent'
                        : hexToRgba(palette.accentBlue.hex, 0.05);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          {!isRead && (
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: palette.primaryMagenta.hex,
                            }} />
                          )}
                          <span style={{
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                            color: n.type === 'mention'
                              ? palette.accentBlue.hex
                              : hexToRgba(palette.backgroundDark.hex, 0.45),
                          }}>
                            {typeLabel}
                          </span>
                        </div>
                        <p style={{
                          fontSize: 12.5, fontWeight: isRead ? 550 : 650,
                          color: palette.backgroundDark.hex,
                          margin: 0, lineHeight: 1.4,
                        }}>
                          {n.title || (actor ? `${actor} mentioned you` : 'New notification')}
                        </p>
                        {n.body && (
                          <p style={{
                            fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55),
                            margin: '3px 0 0', lineHeight: 1.4,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {n.body}
                          </p>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.35),
                        flexShrink: 0, marginTop: 2,
                      }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div
            onClick={() => { setOpen(false); navigate('/tasks'); }}
            style={{
              padding: '10px 14px',
              cursor: 'pointer',
              textAlign: 'center',
              fontSize: 12, fontWeight: 650,
              color: palette.accentBlue.hex,
              borderTop: `1px solid var(--color-border)`,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentBlue.hex, 0.05))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {openTaskCount > 0
              ? `View tasks (${openTaskCount} open) →`
              : 'View all tasks →'}
          </div>
        </div>
      )}
    </div>
  );
}
