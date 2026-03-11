import { useState, useEffect } from 'react';
import airtable from '../api/airtable.js';
import { useLookups } from '../hooks/useLookups.js';
import UserProfileDrawer from '../components/users/UserProfileDrawer.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import LoadingState from '../components/common/LoadingState.jsx';

const ROLE_COLORS = {
  'rol_001': palette.primaryMagenta.hex,
  'rol_002': palette.primaryDeepPlum.hex,
  'rol_003': palette.accentBlue.hex,
  'rol_004': palette.accentGreen.hex,
  'rol_005': palette.primaryMagenta.hex,
  'rol_006': palette.accentOrange.hex,
  'rol_007': palette.highlightYellow.hex,
};

const STATUS_DOT = {
  Active:    palette.accentGreen.hex,
  Pending:   palette.highlightYellow.hex,
  Suspended: palette.accentOrange.hex,
  Revoked:   hexToRgba(palette.backgroundDark.hex, 0.3),
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
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function Team() {
  const { resolveRole } = useLookups();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    airtable.fetchAll('Users', { sort: [{ field: 'first_name', direction: 'asc' }] })
      .then((recs) => setUsers(recs.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      resolveRole(u.role_id).toLowerCase().includes(q)
    );
  });

  if (loading) return <LoadingState message="Loading team…" />;

  return (
    <>
      <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Team</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {users.filter((u) => u.status === 'Active').length} active members
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 36, width: 240 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/>
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, role, email…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map((user) => (
            <UserCard
              key={user._id}
              user={user}
              roleName={resolveRole(user.role_id)}
              roleColor={ROLE_COLORS[user.role_id] || palette.accentBlue.hex}
              onOpen={() => setSelectedUser(user)}
            />
          ))}
        </div>
      </div>

      <UserProfileDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />
    </>
  );
}

function UserCard({ user, roleName, roleColor, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const statusColor = STATUS_DOT[user.status] || STATUS_DOT.Active;

  return (
    <div
      onDoubleClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Double-click to view profile"
      style={{
        padding: '18px 18px 16px',
        borderRadius: 12,
        background: palette.backgroundLight.hex,
        border: `1px solid ${hexToRgba(palette.backgroundDark.hex, hovered ? 0.12 : 0.07)}`,
        boxShadow: hovered ? `0 4px 16px ${hexToRgba(palette.backgroundDark.hex, 0.08)}` : `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
        cursor: 'default',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: hexToRgba(roleColor, 0.15),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: roleColor,
        }}>
          {initials(user.first_name, user.last_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: statusColor, display: 'inline-block', flexShrink: 0,
              }}
              title={user.status}
            />
            <p style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.first_name} {user.last_name}
            </p>
          </div>
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(roleColor, 0.15), color: roleColor }}>
          {roleName}
        </span>
        <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
          {timeAgo(user.last_login_at)}
        </span>
      </div>
    </div>
  );
}
