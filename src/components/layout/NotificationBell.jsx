import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import {
  markNotificationReadOptimistic,
  markAllNotificationsReadOptimistic,
} from '../../store/mutations.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
import palette, { hexToRgba } from '../../utils/colors.js';

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

/**
 * Shared notification inbox. Desktop: dropdown under the top bar.
 * Mobile (`variant="mobile"`): full-width sheet under the plum header.
 */
export default function NotificationBell({ variant = 'desktop' }) {
  const navigate = useNavigate();
  const { appUserId } = useCurrentAppUser();
  const { open: openPatient } = usePatientDrawer();
  const { resolveUser } = useLookups();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const isMobile = variant === 'mobile';

  const storeNotifications = useCareStore((s) => s.notifications);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);

  const { inbox, unreadCount } = useMemo(() => {
    if (!appUserId) return { inbox: [], unreadCount: 0 };
    const mine = Object.values(storeNotifications || {})
      .filter((n) => n.recipient_user_id === appUserId)
      .sort((a, b) => {
        const ar = a.is_read === true || a.is_read === 'true' ? 1 : 0;
        const br = b.is_read === true || b.is_read === 'true' ? 1 : 0;
        if (ar !== br) return ar - br;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      })
      .slice(0, isMobile ? 24 : 12);

    const unread = mine.filter((n) => !(n.is_read === true || n.is_read === 'true')).length;
    return { inbox: mine, unreadCount: unread };
  }, [appUserId, storeNotifications, isMobile]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
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
      const tab = n.type === 'clinical_review_assigned' ? 'clinical_review' : 'notes';
      openPatient(patient, referral, tab);
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

  const panelStyle = isMobile
    ? {
        position: 'fixed',
        top: 'calc(52px + env(safe-area-inset-top, 0px))',
        left: 0,
        right: 0,
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        width: '100%',
        background: palette.backgroundLight.hex,
        borderRadius: 0,
        boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
        border: 'none',
        borderTop: `1px solid var(--color-border)`,
        overflow: 'hidden',
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 340,
        background: NAV_TEXT,
        borderRadius: 12,
        boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
        border: `1px solid var(--color-border)`,
        overflow: 'hidden',
        zIndex: 500,
      };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: isMobile ? 40 : 34,
          height: isMobile ? 40 : 34,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: open
            ? hexToRgba(NAV_TEXT, 0.15)
            : hexToRgba(NAV_TEXT, 0.08),
          border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
          position: 'relative',
          color: hexToRgba(NAV_TEXT, 0.8),
          cursor: 'pointer',
          transition: 'background 0.15s',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

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

      {open && (
        <div style={panelStyle}>
          <div style={{
            padding: '14px 16px 12px',
            borderBottom: `1px solid var(--color-border)`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 8, flexShrink: 0,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Notifications
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      fontSize: 12, fontWeight: 650, border: 'none', background: 'none',
                      color: palette.accentBlue.hex, cursor: 'pointer', padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    Mark all read
                  </button>
                </>
              )}
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: hexToRgba(palette.backgroundDark.hex, 0.06),
                    color: hexToRgba(palette.backgroundDark.hex, 0.55),
                    fontSize: 16, fontWeight: 700, lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div style={{ flex: isMobile ? 1 : undefined, maxHeight: isMobile ? undefined : 380, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {inbox.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
                  No notifications yet.
                </p>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '8px 0 0', lineHeight: 1.45 }}>
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
                    : n.type === 'clinical_review_assigned'
                      ? 'Clinical'
                      : (n.type || 'Alert');
                return (
                  <button
                    type="button"
                    key={n._id}
                    onClick={() => openNotification(n)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: isMobile ? '14px 16px' : '11px 14px',
                      border: 'none',
                      borderBottom: `1px solid var(--color-border)`,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      background: isRead
                        ? 'transparent'
                        : hexToRgba(palette.accentBlue.hex, 0.05),
                      WebkitTapHighlightColor: 'transparent',
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
                          fontSize: 13, fontWeight: isRead ? 550 : 650,
                          color: palette.backgroundDark.hex,
                          margin: 0, lineHeight: 1.4,
                        }}>
                          {n.title || (actor ? `${actor} mentioned you` : 'New notification')}
                        </p>
                        {n.body && (
                          <p style={{
                            fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55),
                            margin: '4px 0 0', lineHeight: 1.4,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {n.body}
                          </p>
                        )}
                      </div>
                      <span style={{
                        fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35),
                        flexShrink: 0, marginTop: 2,
                      }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
