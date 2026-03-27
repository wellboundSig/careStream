import { useState, useMemo } from 'react';
import { useCareStore, updateEntity, mergeEntities } from '../../store/careStore.js';
import airtable from '../../api/airtable.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { updateUserPermission, createUserPermission } from '../../api/userPermissions.js';
import { updateReferralSource } from '../../api/referralSources.js';
import UserProfileDrawer from '../../components/users/UserProfileDrawer.jsx';
import PermissionModal from '../../components/users/PermissionModal.jsx';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUSES = ['Active', 'Pending', 'Suspended', 'Revoked'];

// Role colors cycle for any number of roles — no hardcoded role IDs needed.
const ROLE_COLOR_CYCLE = [
  '#D91E75', '#450931', '#06D4FF', '#6EC72B', '#DB8640', '#F0C424', '#9B59B6',
];
function roleColor(roleId) {
  const num = parseInt((roleId || '').replace(/\D/g, ''), 10);
  return ROLE_COLOR_CYCLE[isNaN(num) ? 0 : (num - 1) % ROLE_COLOR_CYCLE.length];
}

const STATUS_COLORS = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.18),      text: palette.accentGreen.hex },
  Pending:   { bg: hexToRgba(palette.highlightYellow.hex, 0.25),  text: '#7A5F00' },
  Suspended: { bg: hexToRgba(palette.accentOrange.hex, 0.2),      text: palette.accentOrange.hex },
  Revoked:   { bg: hexToRgba(palette.backgroundDark.hex, 0.1),    text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UserManagement() {
  const { appUser } = useCurrentAppUser();
  const { roleMap } = useLookups();
  const storeUsers = useCareStore((s) => s.users);
  const hydrated   = useCareStore((s) => s.hydrated);

  const roles = Object.entries(roleMap)
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const users = useMemo(() =>
    Object.values(storeUsers).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')),
  [storeUsers]);

  const [saving, setSaving] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [reassignData, setReassignData] = useState(null);
  const storeMarketers = useCareStore((s) => s.marketers);

  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.ADMIN_USER_MANAGEMENT);
  const canEditPerms = can(PERMISSION_KEYS.ADMIN_PERMISSIONS);

  const storePresets   = useCareStore((s) => s.permissionPresets);
  const storeUserPerms = useCareStore((s) => s.userPermissions);
  const storeRoles     = useCareStore((s) => s.roles);

  function findPresetForRole(roleId) {
    const role = Object.values(storeRoles).find((r) => r.id === roleId);
    if (!role?.name) return null;
    const roleLower = role.name.toLowerCase();
    return Object.values(storePresets).find((p) => {
      const presetLower = (p.name || '').toLowerCase();
      return presetLower.includes(roleLower) || roleLower.includes(presetLower.split('/')[0].trim());
    }) || null;
  }

  async function applyPresetToUser(userId, preset) {
    if (!preset?.permissions) return;
    const now = new Date().toISOString();
    const existingRec = Object.values(storeUserPerms).find((up) => up.user_id === userId);
    try {
      if (existingRec?._id) {
        const fields = { permissions: preset.permissions, last_preset_id: preset.id, updated_at: now, updated_by: appUserId || '' };
        await updateUserPermission(existingRec._id, fields);
        mergeEntities('userPermissions', { [existingRec._id]: { ...existingRec, ...fields } });
      } else {
        const fields = { id: `up_${userId}`, user_id: userId, permissions: preset.permissions, last_preset_id: preset.id, updated_at: now, updated_by: appUserId || '' };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
    } catch { /* best-effort — role change still succeeds */ }
  }

  async function updateUser(userId, airtableId, field, value) {
    setSaving((prev) => ({ ...prev, [userId]: true }));
    updateEntity('users', airtableId, { [field]: value });
    try {
      await airtable.update('Users', airtableId, { [field]: value });

      if (field === 'role_id') {
        const matchedPreset = findPresetForRole(value);
        if (matchedPreset) {
          await applyPresetToUser(userId, matchedPreset);
          showToast(`Role updated → permissions synced to "${matchedPreset.name}"`);
        } else {
          showToast(`Role updated (no matching preset found)`);
        }
      } else if (field === 'status' && (value === 'Suspended' || value === 'Revoked')) {
        // Check if this user is a marketer with assigned referral sources
        const isMarketer = Object.values(storeMarketers || {}).some((m) => m.user_id === userId || m.id === userId);
        if (isMarketer) {
          const storeSources = useCareStore.getState().referralSources;
          const assignedSources = Object.values(storeSources || {}).filter((s) => s.marketer_id === userId);
          if (assignedSources.length > 0) {
            setReassignData({ userId, sources: assignedSources });
          }
        }
        showToast(`Updated ${field} for ${userId}`);
      } else {
        showToast(`Updated ${field} for ${userId}`);
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }));
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: hexToRgba(palette.primaryMagenta.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke={palette.primaryMagenta.hex} strokeWidth="1.8"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={palette.primaryMagenta.hex} strokeWidth="1.8" strokeLinecap="round"/></svg>
        </div>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 320, textAlign: 'center' }}>
          User Management requires the appropriate permission. Contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>User Management</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {users.length} users in system — edit roles, status, and permissions below
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 36, width: 240 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/>
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
        </div>

        {/* Clerk notice */}
        <div style={{ padding: '12px 16px', borderRadius: 10, background: hexToRgba(palette.accentBlue.hex, 0.08), marginBottom: 22, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" stroke={palette.accentBlue.hex} strokeWidth="1.8"/>
            <path d="M12 8v4M12 16h.01" stroke={palette.accentBlue.hex} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.accentBlue.hex, marginBottom: 3 }}>
              Account creation, invitations, and deletion are managed in Clerk Dashboard
            </p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55 }}>
              Use this page to manage roles, status, and permissions for existing accounts.
              To invite a new user or revoke credentials, visit{' '}
              <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer" style={{ color: palette.accentBlue.hex, fontWeight: 600 }}>
                dashboard.clerk.com
              </a>.
            </p>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {['User', 'Role', 'Status', 'Last Login', ''].map((h) => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!hydrated ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={5} />)
              ) : filtered.map((user) => (
                <UserRow
                  key={user._id}
                  user={user}
                  roles={roles}
                  isSaving={!!saving[user.id]}
                  canEditPerms={canEditPerms}
                  onUpdate={(field, value) => updateUser(user.id, user._id, field, value)}
                  onOpenProfile={() => setSelectedUser(user)}
                  onOpenPermissions={() => setPermUser(user)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <UserProfileDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />
      {permUser && <PermissionModal user={permUser} onClose={() => setPermUser(null)} />}

      {reassignData && (
        <ReassignSourcesModal
          sources={reassignData.sources}
          marketers={Object.values(storeMarketers).filter((m) => m.status === 'Active' && m.id !== reassignData.userId)}
          onClose={() => setReassignData(null)}
          onReassign={async (sourceId, newMarketerId) => {
            const src = Object.values(useCareStore.getState().referralSources).find((s) => s.id === sourceId);
            if (src) {
              await updateReferralSource(src._id, { marketer_id: newMarketerId || '' });
              mergeEntities('referralSources', { [src._id]: { ...src, marketer_id: newMarketerId || '' } });
            }
          }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

function UserRow({ user, roles, isSaving, canEditPerms, onUpdate, onOpenProfile, onOpenPermissions }) {
  const [hovered, setHovered] = useState(false);
  const statusStyle = STATUS_COLORS[user.status] || STATUS_COLORS.Active;
  const color       = roleColor(user.role_id);

  const selectStyle = {
    padding: '5px 8px', borderRadius: 6, border: `1px solid var(--color-border)`,
    background: palette.backgroundLight.hex, fontSize: 12.5, color: palette.backgroundDark.hex,
    cursor: 'pointer', outline: 'none', fontFamily: 'inherit', opacity: isSaving ? 0.5 : 1,
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.025) : 'transparent', transition: 'background 0.1s' }}
    >
      <td style={{ padding: '11px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: hexToRgba(color, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
            {initials(user.first_name, user.last_name)}
          </div>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.2 }}>{user.first_name} {user.last_name}</p>
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{user.email}</p>
          </div>
        </div>
      </td>

      <td style={{ padding: '11px 14px' }}>
        <select value={user.role_id || ''} onChange={(e) => onUpdate('role_id', e.target.value)} disabled={isSaving || !roles.length} style={selectStyle}>
          {!user.role_id && <option value="">— select role —</option>}
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </td>

      <td style={{ padding: '11px 14px' }}>
        <select value={user.status || 'Active'} onChange={(e) => onUpdate('status', e.target.value)} disabled={isSaving} style={{ ...selectStyle, background: statusStyle.bg, color: statusStyle.text, border: 'none', fontWeight: 650 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>

      <td style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
        {timeAgo(user.last_login_at)}
        {isSaving && <span style={{ marginLeft: 8, color: palette.accentBlue.hex }}>Saving…</span>}
      </td>

      <td style={{ padding: '11px 14px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEditPerms && (
            <button
              onClick={onOpenPermissions}
              style={{ padding: '5px 12px', borderRadius: 6, background: hexToRgba(palette.primaryMagenta.hex, 0.1), border: 'none', fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex, cursor: 'pointer' }}
            >
              Permissions
            </button>
          )}
          <button
            onClick={onOpenProfile}
            style={{ padding: '5px 12px', borderRadius: 6, background: hexToRgba(palette.primaryDeepPlum.hex, 0.07), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.primaryDeepPlum.hex, 0.8), cursor: 'pointer' }}
          >
            Profile
          </button>
        </div>
      </td>
    </tr>
  );
}

function ReassignSourcesModal({ sources, marketers, onClose, onReassign }) {
  const [assignments, setAssignments] = useState({});
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    for (const [srcId, mktId] of Object.entries(assignments)) {
      await onReassign(srcId, mktId).catch(() => {});
    }
    setSaving(false);
    onClose();
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.accentOrange.hex }}>Reassign Referral Sources</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 4 }}>
            This marketer has {sources.length} referral source{sources.length !== 1 ? 's' : ''}. Reassign them or leave as unassigned.
          </p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {sources.map((src) => (
            <div key={src.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{src.name}</p>
                {src.type && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{src.type}</p>}
              </div>
              <select value={assignments[src.id] || ''} onChange={(e) => setAssignments((p) => ({ ...p, [src.id]: e.target.value }))}
                style={{ padding: '6px 10px', borderRadius: 7, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), fontSize: 12, color: palette.backgroundDark.hex, cursor: 'pointer', minWidth: 160 }}>
                <option value="">Leave unassigned</option>
                {marketers.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Skip for now</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 22px', borderRadius: 8, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save Assignments'}</button>
        </div>
      </div>
    </div>
  );
}
