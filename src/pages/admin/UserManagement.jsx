import { useState, useMemo } from 'react';
import { useCareStore, updateEntity, mergeEntities } from '../../store/careStore.js';
import airtable from '../../api/airtable.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { updateReferralSource } from '../../api/referralSources.js';
import { languageById } from '../../data/languages.js';
import UserSettingsSheet from '../../components/users/UserSettingsSheet.jsx';
import OooBadge from '../../components/common/OooBadge.jsx';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUS_COLORS = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.18),      text: palette.accentGreen.hex },
  Pending:   { bg: hexToRgba(palette.highlightYellow.hex, 0.25),  text: '#7A5F00' },
  Suspended: { bg: hexToRgba(palette.accentOrange.hex, 0.2),      text: palette.accentOrange.hex },
  Revoked:   { bg: hexToRgba(palette.backgroundDark.hex, 0.1),    text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

const ROLE_COLOR_CYCLE = [
  '#D91E75', '#450931', '#06D4FF', '#6EC72B', '#DB8640', '#F0C424', '#9B59B6',
];
function roleColor(roleId) {
  const num = parseInt((roleId || '').replace(/\D/g, ''), 10);
  return ROLE_COLOR_CYCLE[isNaN(num) ? 0 : (num - 1) % ROLE_COLOR_CYCLE.length];
}

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
  const { roleMap } = useLookups();
  const storeUsers = useCareStore((s) => s.users);
  const storeUserLanguages = useCareStore((s) => s.userLanguages);
  const storeLanguages = useCareStore((s) => s.languages);
  const hydrated = useCareStore((s) => s.hydrated);
  const storeMarketers = useCareStore((s) => s.marketers);

  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.ADMIN_USER_MANAGEMENT);
  const canEditPerms = can(PERMISSION_KEYS.ADMIN_PERMISSIONS);

  const roles = Object.entries(roleMap)
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const users = useMemo(() =>
    Object.values(storeUsers).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')),
  [storeUsers]);

  const langsByUser = useMemo(() => {
    const map = {};
    Object.values(storeUserLanguages || {}).forEach((ul) => {
      if (!ul.user_id) return;
      if (!map[ul.user_id]) map[ul.user_id] = [];
      const fromStore = Object.values(storeLanguages || {}).find((l) => l.id === ul.language_id);
      const name = fromStore?.name || languageById(ul.language_id)?.name || ul.language_id;
      map[ul.user_id].push(name);
    });
    return map;
  }, [storeUserLanguages, storeLanguages]);

  const [saving, setSaving] = useState({});
  const [settingsUser, setSettingsUser] = useState(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [reassignData, setReassignData] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function updateUser(userId, airtableId, field, value) {
    setSaving((prev) => ({ ...prev, [userId]: true }));
    updateEntity('users', airtableId, { [field]: value });
    try {
      await airtable.update('Users', airtableId, { [field]: value });

      if (field === 'status' && (value === 'Suspended' || value === 'Revoked')) {
        const isMarketer = Object.values(storeMarketers || {}).some((m) => m.user_id === userId || m.id === userId);
        if (isMarketer) {
          const storeSources = useCareStore.getState().referralSources;
          const assignedSources = Object.values(storeSources || {}).filter((s) => s.marketer_id === userId);
          if (assignedSources.length > 0) {
            setReassignData({ userId, sources: assignedSources });
          }
        }
      }
      showToast(`Updated ${field}`);
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }));
    }
  }

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const langHay = (langsByUser[u.id] || []).join(' ').toLowerCase();
    return `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || langHay.includes(q);
  });

  // Keep sheet user in sync with store edits
  const sheetUser = settingsUser
    ? (Object.values(storeUsers).find((u) => u._id === settingsUser._id || u.id === settingsUser.id) || settingsUser)
    : null;

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>User Management</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {users.length} people — click a row to open settings
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 36, width: 260 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/>
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, language…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
        </div>

        <div style={{ padding: '10px 14px', borderRadius: 10, background: hexToRgba(palette.accentBlue.hex, 0.07), marginBottom: 18, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10" stroke={palette.accentBlue.hex} strokeWidth="1.8"/>
            <path d="M12 8v4M12 16h.01" stroke={palette.accentBlue.hex} strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), lineHeight: 1.5, margin: 0 }}>
            Invites and account deletion live in{' '}
            <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer" style={{ color: palette.accentBlue.hex, fontWeight: 600 }}>
              Clerk
            </a>
            . Here you manage role, status, languages, permissions, and assignment.
          </p>
        </div>

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {['User', 'Role', 'Status', 'Languages', 'Last login', ''].map((h, i) => (
                  <th key={i} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!hydrated ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                    No users match your search
                  </td>
                </tr>
              ) : filtered.map((user) => (
                <UserRow
                  key={user._id}
                  user={user}
                  roleLabel={roleMap[user.role_id] || user.role_id || '—'}
                  languages={langsByUser[user.id] || []}
                  isSaving={!!saving[user.id]}
                  selected={sheetUser?.id === user.id}
                  onOpen={() => setSettingsUser(user)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sheetUser && (
        <UserSettingsSheet
          user={sheetUser}
          roles={roles}
          canEditPerms={canEditPerms}
          onClose={() => setSettingsUser(null)}
          onToast={showToast}
          onStatusChange={(value) => updateUser(sheetUser.id, sheetUser._id, 'status', value)}
          onRoleApplied={() => { /* store already updated */ }}
        />
      )}

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

function UserRow({ user, roleLabel, languages, isSaving, selected, onOpen }) {
  const [hovered, setHovered] = useState(false);
  const statusStyle = STATUS_COLORS[user.status] || STATUS_COLORS.Active;
  const color = roleColor(user.role_id);
  const shownLangs = languages.slice(0, 3);
  const extra = languages.length - shownLangs.length;

  return (
    <tr
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
        background: selected
          ? hexToRgba(palette.primaryMagenta.hex, 0.06)
          : hovered
            ? hexToRgba(palette.primaryDeepPlum.hex, 0.03)
            : 'transparent',
        transition: 'background 0.1s',
        cursor: 'pointer',
      }}
    >
      <td style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: hexToRgba(color, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
            {initials(user.first_name, user.last_name)}
          </div>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.2 }}>{user.first_name} {user.last_name}</p>
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{user.email}</p>
          </div>
        </div>
      </td>

      <td style={{ padding: '12px 14px' }}>
        <span style={{
          fontSize: 12, fontWeight: 650, padding: '4px 9px', borderRadius: 6,
          background: hexToRgba(color, 0.1), color,
        }}>
          {roleLabel}
        </span>
      </td>

      <td style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 12, fontWeight: 650, padding: '4px 9px', borderRadius: 6,
            background: statusStyle.bg, color: statusStyle.text,
          }}>
            {user.status || 'Active'}
          </span>
          <OooBadge user={user} size="md" />
        </div>
      </td>

      <td style={{ padding: '12px 14px', maxWidth: 220 }}>
        {languages.length === 0 ? (
          <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {shownLangs.map((name) => (
              <span key={name} style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12,
                background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex,
              }}>
                {name}
              </span>
            ))}
            {extra > 0 && (
              <span style={{ fontSize: 11, fontWeight: 650, padding: '3px 8px', color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                +{extra}
              </span>
            )}
          </div>
        )}
      </td>

      <td style={{ padding: '12px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap' }}>
        {timeAgo(user.last_login_at)}
        {isSaving && <span style={{ marginLeft: 8, color: palette.accentBlue.hex }}>Saving…</span>}
      </td>

      <td style={{ padding: '12px 14px', width: 44 }}>
        <div
          aria-label={`Open settings for ${user.first_name} ${user.last_name}`}
          title="User settings"
          style={{
            width: 30, height: 30, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: hovered ? hexToRgba(palette.primaryMagenta.hex, 0.1) : 'transparent',
            color: hovered ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
            transition: 'background 0.12s, color 0.12s',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
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
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.55), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 480, padding: 22, boxShadow: `0 8px 40px ${hexToRgba(palette.backgroundDark.hex, 0.25)}` }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 6 }}>Reassign referral sources</h3>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 16, lineHeight: 1.45 }}>
          This marketer has {sources.length} source{sources.length === 1 ? '' : 's'}. Reassign before suspending.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18, maxHeight: 280, overflowY: 'auto' }}>
          {sources.map((src) => (
            <div key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{src.name || src.id}</span>
              <select
                value={assignments[src.id] || ''}
                onChange={(e) => setAssignments((prev) => ({ ...prev, [src.id]: e.target.value }))}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12.5, minWidth: 160 }}
              >
                <option value="">— unassigned —</option>
                {marketers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Skip
          </button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex, fontSize: 13, fontWeight: 650, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
