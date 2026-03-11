import { useState, useEffect } from 'react';
import { getReferrals } from '../../api/referrals.js';
import { useLookups } from '../../hooks/useLookups.js';
import StageBadge from '../common/StageBadge.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import LoadingState from '../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const ROLE_COLORS = {
  'rol_001': palette.primaryMagenta.hex,
  'rol_002': palette.primaryDeepPlum.hex,
  'rol_003': palette.accentBlue.hex,
  'rol_004': palette.accentGreen.hex,
  'rol_005': palette.primaryMagenta.hex,
  'rol_006': palette.accentOrange.hex,
  'rol_007': palette.highlightYellow.hex,
};

const STATUS_STYLES = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.2),       text: palette.accentGreen.hex },
  Pending:   { bg: hexToRgba(palette.highlightYellow.hex, 0.25),  text: '#7A5F00' },
  Suspended: { bg: hexToRgba(palette.accentOrange.hex, 0.2),      text: palette.accentOrange.hex },
  Revoked:   { bg: hexToRgba(palette.backgroundDark.hex, 0.12),   text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function UserProfileDrawer({ user, onClose }) {
  const { resolveRole, resolveSource } = useLookups();
  const [referrals, setReferrals] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const isOpen = !!user;
  const roleColor = ROLE_COLORS[user?.role_id] || palette.accentBlue.hex;
  const statusStyle = STATUS_STYLES[user?.status] || STATUS_STYLES.Active;
  const roleName = resolveRole(user?.role_id);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    setLoadingRefs(true);
    getReferrals({ filterByFormula: `{intake_owner_id} = "${user.id}"` })
      .then((recs) => setReferrals(recs.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoadingRefs(false));
  }, [user?.id]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const active = referrals.filter((r) => r.current_stage !== 'SOC Completed' && r.current_stage !== 'NTUC');
  const ntuc   = referrals.filter((r) => r.current_stage === 'NTUC');
  const completed = referrals.filter((r) => r.current_stage === 'SOC Completed');

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: hexToRgba(palette.backgroundDark.hex, 0.3) }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(480px, 100vw)', zIndex: 1001,
        background: palette.backgroundLight.hex,
        display: 'flex', flexDirection: 'column',
        boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
        transform: 'translateX(0)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {user.clerk_image_url ? (
              <img src={user.clerk_image_url} alt={`${user.first_name} ${user.last_name}`} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                background: hexToRgba(roleColor, 0.3),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 800, color: roleColor,
              }}>
                {initials(user.first_name, user.last_name)}
              </div>
            )}
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 3 }}>
                  {user.first_name} {user.last_name}
                </p>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.55) }}>{user.email}</p>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.65), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(roleColor, 0.25), color: roleColor }}>
              {roleName}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: statusStyle.bg, color: statusStyle.text }}>
              {user.status}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.primaryMagenta.hex, 0.25), color: palette.primaryMagenta.hex }}>
              {user.scope}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
            {[
              { label: 'Active Cases', value: active.length, color: palette.primaryMagenta.hex },
              { label: 'SOC Completed', value: completed.length, color: palette.accentGreen.hex },
              { label: 'NTUC', value: ntuc.length, color: hexToRgba(palette.backgroundDark.hex, 0.45) },
            ].map((s) => (
              <div key={s.label} style={{ padding: '14px 12px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), textAlign: 'center' }}>
                <p style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Meta */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>Account Info</p>
            {[
              { label: 'User ID', value: user.id },
              { label: 'Last Login', value: timeAgo(user.last_login_at) },
              { label: 'Member Since', value: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
                <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{row.label}</span>
                <span style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex }}>{row.value || '—'}</span>
              </div>
            ))}
          </div>

          {/* Assigned cases */}
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
              Assigned Cases ({active.length} active)
            </p>
            {loadingRefs ? (
              <LoadingState message="Loading cases…" size="small" />
            ) : active.length === 0 ? (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', padding: '16px 0' }}>No active cases assigned.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {active.slice(0, 12).map((ref) => (
                  <div key={ref._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.03) }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <DivisionBadge division={ref.division} size="small" />
                      <span style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{ref.patient_id}</span>
                    </div>
                    <StageBadge stage={ref.current_stage} size="small" />
                  </div>
                ))}
                {active.length > 12 && (
                  <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', paddingTop: 6 }}>
                    +{active.length - 12} more
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
