import { useState, useMemo, useEffect } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { updateUserPermission, createUserPermission } from '../../api/userPermissions.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

function displayName(u) {
  return `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || u.id;
}

/**
 * Separate modal for configuring who a user can assign tasks/ownership to.
 * Search + department filter — kept out of the feature-permissions modal so
 * saving assignees never clobber permission checkboxes.
 */
export default function AssignableUsersModal({ user, onClose }) {
  const { appUserId } = useCurrentAppUser();
  const storeUsers = useCareStore((s) => s.users);
  const storeRoles = useCareStore((s) => s.roles);
  const storeDepartments = useCareStore((s) => s.departments);
  const storeUserPerms = useCareStore((s) => s.userPermissions);

  const departments = useMemo(
    () => Object.values(storeDepartments || {}).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [storeDepartments],
  );

  const roleNameById = useMemo(() => {
    const map = {};
    Object.values(storeRoles || {}).forEach((r) => { map[r.id] = r.name || r.id; });
    return map;
  }, [storeRoles]);

  const deptNameById = useMemo(() => {
    const map = {};
    Object.values(storeDepartments || {}).forEach((d) => { map[d.id] = d.name || d.id; });
    return map;
  }, [storeDepartments]);

  const allUsers = useMemo(
    () => Object.values(storeUsers)
      .filter((u) => (u.status === 'Active' || !u.status) && u.id !== user?.id)
      .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [storeUsers, user?.id],
  );

  const existingRecord = useMemo(() => {
    if (!user?.id) return null;
    return Object.values(storeUserPerms).find((up) => up.user_id === user.id) || null;
  }, [user?.id, storeUserPerms]);

  const initialAllowed = useMemo(() => {
    if (!existingRecord?.allowed_assignees) return null;
    try {
      const arr = JSON.parse(existingRecord.allowed_assignees);
      return Array.isArray(arr) ? new Set(arr) : null;
    } catch { return null; }
  }, [existingRecord]);

  const [restricted, setRestricted] = useState(() => !!initialAllowed);
  const [checked, setChecked] = useState(() => (initialAllowed ? new Set(initialAllowed) : new Set()));
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Re-sync when opening for a different user (not on every store tick).
  useEffect(() => {
    if (initialAllowed) {
      setRestricted(true);
      setChecked(new Set(initialAllowed));
    } else {
      setRestricted(false);
      setChecked(new Set());
    }
    setSearch('');
    setDeptFilter('');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: open-only sync

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (deptFilter === '_none') {
        if (u.department_id) return false;
      } else if (deptFilter && (u.department_id || '') !== deptFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allUsers, search, deptFilter]);

  // Group filtered results by department for scannability
  const grouped = useMemo(() => {
    const groups = new Map();
    filteredUsers.forEach((u) => {
      const key = u.department_id || '_none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(u);
    });
    const ordered = [];
    departments.forEach((d) => {
      if (groups.has(d.id)) ordered.push({ id: d.id, name: d.name || d.id, users: groups.get(d.id) });
    });
    if (groups.has('_none')) ordered.push({ id: '_none', name: 'No department', users: groups.get('_none') });
    // Any dept ids not in the departments table
    groups.forEach((users, id) => {
      if (id === '_none' || departments.some((d) => d.id === id)) return;
      ordered.push({ id, name: deptNameById[id] || id, users });
    });
    return ordered;
  }, [filteredUsers, departments, deptNameById]);

  if (!user) return null;

  function toggleUser(uid) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  function toggleGroup(userIds) {
    const allOn = userIds.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      userIds.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function selectVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      filteredUsers.forEach((u) => next.add(u.id));
      return next;
    });
  }

  function clearSelection() { setChecked(new Set()); }

  async function handleSave() {
    setSaving(true);
    const allowedJson = restricted ? JSON.stringify([...checked]) : '';
    const now = new Date().toISOString();

    try {
      if (existingRecord?._id) {
        // PATCH only assignees — never touch permissions
        const fields = { allowed_assignees: allowedJson, updated_at: now, updated_by: appUserId || '' };
        await updateUserPermission(existingRecord._id, fields);
        mergeEntities('userPermissions', { [existingRecord._id]: { ...existingRecord, ...fields } });
      } else {
        // Create without writing permissions:[] — null permissions keeps the
        // migration fallback (all feature perms granted) until an admin sets them.
        const fields = {
          id: `up_${user.id}`,
          user_id: user.id,
          allowed_assignees: allowedJson,
          updated_at: now,
          updated_by: appUserId || '',
        };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
      setToast('Saved');
      setTimeout(() => { setToast(null); onClose(); }, 700);
    } catch (err) {
      setToast(`Error: ${err.message}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = (() => {
    if (!restricted) return initialAllowed !== null;
    if (initialAllowed === null) return true;
    if (checked.size !== initialAllowed.size) return true;
    for (const k of checked) if (!initialAllowed.has(k)) return true;
    return false;
  })();

  const summary = !restricted
    ? 'Everyone'
    : checked.size === 0
      ? 'No one'
      : `${checked.size} ${checked.size === 1 ? 'person' : 'people'}`;

  return (
    <div
      data-testid="assignable-users-modal"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9996,
        background: hexToRgba(palette.backgroundDark.hex, 0.55),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex,
        borderRadius: 16, width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 48px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        overflow: 'hidden', position: 'relative',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>
                Who can {user.first_name || 'this user'} assign to?
              </h2>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                Controls task and ownership assignment targets for {displayName(user)}.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              style={{ width: 30, height: 30, borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 1l11 11M12 1L1 12" stroke={hexToRgba(palette.backgroundDark.hex, 0.55)} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={restricted}
                onChange={(e) => { setRestricted(e.target.checked); if (!e.target.checked) setChecked(new Set()); }}
                style={{ accentColor: palette.primaryMagenta.hex, width: 15, height: 15, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>
                Restrict to specific people
              </span>
            </label>
            <span style={{
              marginLeft: 'auto', fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20,
              background: restricted ? hexToRgba(palette.primaryMagenta.hex, 0.1) : hexToRgba(palette.accentGreen.hex, 0.12),
              color: restricted ? palette.primaryMagenta.hex : palette.accentGreen.hex,
            }}>
              {summary}
            </span>
          </div>
        </div>

        {!restricted ? (
          <div style={{ padding: '28px 22px', flex: 1 }}>
            <p style={{ fontSize: 13.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5 }}>
              This user can assign tasks and ownership to any active team member.
              Turn on restriction above to pick a specific list.
            </p>
          </div>
        ) : (
          <>
            {/* Search + department filter */}
            <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                  background: hexToRgba(palette.backgroundDark.hex, 0.04),
                  border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 10px', height: 34,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
                    <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or email…"
                    autoFocus
                    style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%', fontFamily: 'inherit' }}
                  />
                </div>
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  aria-label="Filter by department"
                  style={{
                    minWidth: 150, padding: '0 10px', height: 34, borderRadius: 8,
                    border: '1px solid var(--color-border)', background: palette.backgroundLight.hex,
                    fontSize: 12.5, color: palette.backgroundDark.hex, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="_none">No department</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={selectVisible}
                  disabled={filteredUsers.length === 0}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, filteredUsers.length === 0 ? 0.25 : 0.55), cursor: filteredUsers.length === 0 ? 'default' : 'pointer' }}
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={checked.size === 0}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, checked.size === 0 ? 0.25 : 0.55), cursor: checked.size === 0 ? 'default' : 'pointer' }}
                >
                  Clear
                </button>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                  {checked.size} selected · {filteredUsers.length} shown
                </span>
              </div>
              {checked.size === 0 && (
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.accentOrange.hex, background: hexToRgba(palette.accentOrange.hex, 0.08), borderRadius: 6, padding: '7px 10px', margin: 0 }}>
                  No one selected — this user won&apos;t be able to assign to anyone. Turn off restriction to allow everyone.
                </p>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}>
              {grouped.length === 0 ? (
                <p style={{ padding: 24, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), textAlign: 'center' }}>
                  No people match this search.
                </p>
              ) : grouped.map((group) => {
                const ids = group.users.map((u) => u.id);
                const allOn = ids.length > 0 && ids.every((id) => checked.has(id));
                const someOn = ids.some((id) => checked.has(id)) && !allOn;
                return (
                  <div key={group.id} data-testid={`dept-group-${group.id}`}>
                    <div
                      onClick={() => toggleGroup(ids)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px',
                        background: hexToRgba(palette.backgroundDark.hex, 0.03),
                        borderBottom: '1px solid var(--color-border)', cursor: 'pointer', userSelect: 'none',
                        position: 'sticky', top: 0, zIndex: 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={(el) => { if (el) el.indeterminate = someOn; }}
                        onChange={() => toggleGroup(ids)}
                        style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                        {group.name}
                      </span>
                      <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                        {ids.filter((id) => checked.has(id)).length}/{ids.length}
                      </span>
                    </div>
                    {group.users.map((u) => (
                      <label
                        key={u.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px 20px',
                          cursor: 'pointer', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(u.id)}
                          onChange={() => toggleUser(u.id)}
                          style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: hexToRgba(palette.primaryDeepPlum.hex, 0.1),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 800, color: palette.primaryDeepPlum.hex,
                        }}>
                          {initials(u.first_name, u.last_name)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.2 }}>
                            {displayName(u)}
                          </p>
                          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {[roleNameById[u.role_id], u.email].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: '1px solid var(--color-border)', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              padding: '8px 20px', borderRadius: 8,
              background: (saving || !hasChanges) ? hexToRgba(palette.accentGreen.hex, 0.35) : palette.accentGreen.hex,
              border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex,
              cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {toast && (
          <div style={{
            position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
            background: toast.startsWith('Error') ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
            color: palette.backgroundLight.hex, padding: '8px 16px', borderRadius: 8,
            fontSize: 12.5, fontWeight: 550, whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
