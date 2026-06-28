import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUser } from '@clerk/react';
import { useCareStore } from '../store/careStore.js';
import { useLookups } from '../hooks/useLookups.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import UserProfileDrawer from '../components/users/UserProfileDrawer.jsx';
import TaskComposer from '../components/tasks/TaskComposer.jsx';
import { SkeletonRect } from '../components/common/Skeleton.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

// Classify a role by its NAME — no hardcoded IDs.
// New roles automatically fall to 'admin' unless their name matches a pattern.
//   "Scheduler" / "Intake Coordinator" → intake
//   "Billing" / "CEO" / "Admin" / "Developer" / anything else → admin
function classifyRole(roleName) {
  const n = (roleName || '').toLowerCase();
  if (/market/.test(n))                    return 'marketers';
  if (/intake|schedul/.test(n))            return 'intake';
  if (/clinical|nurse|\brn\b|\blpn\b/.test(n)) return 'clinical';
  return 'admin';
}

// Color cycle — works for any number of roles regardless of ID
const ROLE_COLOR_CYCLE = [
  palette.primaryMagenta.hex, palette.primaryDeepPlum.hex,
  palette.accentBlue.hex,     palette.accentGreen.hex,
  palette.accentOrange.hex,   palette.highlightYellow.hex,
  '#9B59B6',
];
function getRoleColor(roleId) {
  const num = parseInt((roleId || '').replace(/\D/g, ''), 10);
  return ROLE_COLOR_CYCLE[isNaN(num) ? 0 : (num - 1) % ROLE_COLOR_CYCLE.length];
}

// Numeric suffix of a role id (e.g. "rol_003" → 3) for stable creation-order
// sorting of the dynamically-generated sections.
function roleNum(roleId) {
  const n = parseInt((roleId || '').replace(/\D/g, ''), 10);
  return Number.isNaN(n) ? 9999 : n;
}

// Distinguish a real uploaded photo from Clerk's auto-generated default avatar.
// Clerk default avatars encode `{"type":"default",...}` in the URL, whose
// base64 prefix is `eyJ0eXBlIjoiZGVmYXVsdCI`; gravatar defaults also count as
// "no real photo". In those cases we render the member's initials instead.
function isUploadedPhoto(url) {
  if (!url) return false;
  if (url.includes('eyJ0eXBlIjoiZGVmYXVsdCI')) return false;
  if (/gravatar\.com\/avatar/i.test(url)) return false;
  return true;
}

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
  const { user: clerkUser }        = useUser();
  const { resolveRole, roleMap }   = useLookups();
  const { appUser, appUserId }     = useCurrentAppUser();
  const storeUsers = useCareStore((s) => s.users);
  const storeRoles = useCareStore((s) => s.roles);
  const hydrated   = useCareStore((s) => s.hydrated);

  const users = useMemo(() =>
    Object.values(storeUsers).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')),
  [storeUsers]);

  const [selected, setSelected] = useState(null);
  const [search, setSearch]     = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);

  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.TASK_ASSIGN);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [contextMenu]);

  const filtered = search.trim()
    ? users.filter((u) =>
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
        resolveRole(u.role_id).toLowerCase().includes(search.toLowerCase())
      )
    : users;

  // Dynamic sections — one per role, straight from the Roles table. Add a role
  // there and it automatically gets its own section here (ordered by role id /
  // creation order). Members with an unknown/missing role fall into "Unassigned".
  const groups = useMemo(() => {
    const byRole = new Map();
    filtered.forEach((u) => {
      const rid = u.role_id && roleMap[u.role_id] ? u.role_id : '_unassigned';
      if (!byRole.has(rid)) byRole.set(rid, []);
      byRole.get(rid).push(u);
    });

    const out = Object.values(storeRoles || {})
      .filter((r) => r.id && byRole.has(r.id))
      .sort((a, b) => roleNum(a.id) - roleNum(b.id) || (a.name || '').localeCompare(b.name || ''))
      .map((r) => ({ id: r.id, label: r.name || r.id, color: getRoleColor(r.id), members: byRole.get(r.id) }));

    if (byRole.has('_unassigned')) {
      out.push({ id: '_unassigned', label: 'Unassigned', color: hexToRgba(palette.backgroundDark.hex, 0.4), members: byRole.get('_unassigned') });
    }
    return out;
  }, [filtered, storeRoles, roleMap]);

  function handleRightClick(e, user) {
    if (!isAdmin) return;
    if (user.id === appUserId) return;
    if (classifyRole(roleMap[user.role_id] || '') === 'admin') return;
    e.preventDefault();
    // Keep menu within viewport
    const x = Math.min(e.clientX, window.innerWidth  - 180);
    const y = Math.min(e.clientY, window.innerHeight - 80);
    setContextMenu({ x, y, user });
  }

  return (
    <>
      <div style={{ padding: '36px 44px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Team</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {users.filter((u) => u.status === 'Active').length} active · {users.length} total
              {isAdmin && (
                <span style={{ marginLeft: 8, fontSize: 11.5, color: hexToRgba(palette.primaryMagenta.hex, 0.7), fontWeight: 600 }}>
                  · Right-click any member to assign a task
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 36, width: 240 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/>
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, role, email…"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }}
            />
          </div>
        </div>

        {!hydrated ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 18 }}>
            {Array.from({ length: 8 }).map((_, i) => <SkeletonRect key={i} height={96} borderRadius={14} />)}
          </div>
        ) : groups.length === 0 ? (
          <p style={{ fontSize: 14, color: hexToRgba(palette.backgroundDark.hex, 0.35), textAlign: 'center', padding: '48px 0', fontStyle: 'italic' }}>
            No team members found.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
            {groups.map((group) => (
              <DeptSection
                key={group.id}
                group={group}
                resolveRole={resolveRole}
                roleMap={roleMap}
                appUserId={appUserId}
                clerkImageUrl={clerkUser?.imageUrl}
                isAdmin={isAdmin}
                onOpen={setSelected}
                onRightClick={handleRightClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 8000,
            background: palette.backgroundLight.hex,
            borderRadius: 9,
            boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`,
            border: `1px solid var(--color-border)`,
            overflow: 'hidden',
            minWidth: 170,
          }}
        >
          <div style={{ padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {contextMenu.user.first_name} {contextMenu.user.last_name}
          </div>
          <button
            onClick={() => { setAssignTarget(contextMenu.user); setContextMenu(null); }}
            style={{
              width: '100%', padding: '9px 14px', border: 'none', background: 'none',
              textAlign: 'left', fontSize: 13, fontWeight: 600,
              color: palette.backgroundDark.hex, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.06))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke={palette.primaryMagenta.hex} strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            Assign Task
          </button>
        </div>
      )}

      <UserProfileDrawer user={selected} onClose={() => setSelected(null)} />

      {assignTarget && (
        <TaskComposer
          variant="modal"
          title={`Assign Task — ${assignTarget.first_name} ${assignTarget.last_name}`}
          defaultAssigneeId={assignTarget.id}
          lockAssignee
          onCreated={() => setAssignTarget(null)}
          onCancel={() => setAssignTarget(null)}
        />
      )}
    </>
  );
}

// ── Department section ─────────────────────────────────────────────────────────
function DeptSection({ group, resolveRole, roleMap, appUserId, clerkImageUrl, isAdmin, onOpen, onRightClick }) {
  const accentColor = group.color || palette.accentBlue.hex;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: accentColor, display: 'inline-block', flexShrink: 0 }} />
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
          {group.label}
        </h2>
        <span style={{ fontSize: 12, fontWeight: 650, padding: '1px 8px', borderRadius: 10, background: hexToRgba(accentColor, 0.12), color: accentColor }}>
          {group.members.length}
        </span>
        <span style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 18 }}>
        {group.members.map((user) => {
          const isMe  = user.id === appUserId;
          const photo = isUploadedPhoto(user.clerk_image_url) ? user.clerk_image_url : null;
          const canAssign = isAdmin && !isMe && classifyRole(roleMap[user.role_id] || '') !== 'admin';
          return (
            <UserCard
              key={user._id}
              user={user}
              roleName={resolveRole(user.role_id)}
              accentColor={getRoleColor(user.role_id)}
              photo={photo}
              isMe={isMe}
              canAssign={canAssign}
              onOpen={() => onOpen(user)}
              onContextMenu={(e) => onRightClick(e, user)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── User card ──────────────────────────────────────────────────────────────────
function UserCard({ user, roleName, accentColor, photo, isMe, canAssign, onOpen, onContextMenu }) {
  const [hovered, setHovered] = useState(false);
  const statusColor = STATUS_DOT[user.status] || STATUS_DOT.Active;

  return (
    <div
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={canAssign ? 'Double-click to view profile · Right-click to assign task' : 'Double-click to view profile'}
      style={{
        padding: '20px 20px 18px',
        borderRadius: 14,
        background: palette.backgroundLight.hex,
        border: `1px solid ${hexToRgba(palette.backgroundDark.hex, hovered ? 0.12 : 0.07)}`,
        boxShadow: hovered ? `0 4px 16px ${hexToRgba(palette.backgroundDark.hex, 0.08)}` : `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
        cursor: canAssign ? 'context-menu' : 'default',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        position: 'relative',
      }}
    >
      {/* Avatar */}
      {photo ? (
        <img src={photo} alt={`${user.first_name} ${user.last_name}`} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: hexToRgba(accentColor, 0.14),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 800, color: accentColor,
        }}>
          {initials(user.first_name, user.last_name)}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, display: 'inline-block', flexShrink: 0 }} title={user.status} />
          <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.first_name} {user.last_name}
            {isMe && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: hexToRgba(palette.primaryMagenta.hex, 0.7) }}>you</span>}
          </p>
        </div>
        <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6 }}>
          {user.email}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: hexToRgba(accentColor, 0.13), color: accentColor }}>
            {roleName}
          </span>
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.32) }}>
            {timeAgo(user.last_login_at)}
          </span>
        </div>
      </div>

      {/* "assignable" hint dot */}
      {canAssign && hovered && (
        <span style={{
          position: 'absolute', top: 8, right: 10,
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
          color: hexToRgba(palette.primaryMagenta.hex, 0.6),
        }}>
          right-click
        </span>
      )}
    </div>
  );
}

