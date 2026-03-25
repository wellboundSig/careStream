import { useState, useMemo, useEffect } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { updateUserPermission, createUserPermission } from '../../api/userPermissions.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * "Can Assign To" permission editor.
 * Displays all team members grouped by role with checkboxes.
 * Saves allowed_assignees as JSON array on UserPermissions.
 */
export default function AssigneePermissionEditor({ user, onSaved }) {
  const { appUserId } = useCurrentAppUser();
  const { resolveRole } = useLookups();
  const storeUsers = useCareStore((s) => s.users);
  const storeRoles = useCareStore((s) => s.roles);
  const storeUserPerms = useCareStore((s) => s.userPermissions);

  const allUsers = useMemo(
    () => Object.values(storeUsers)
      .filter((u) => (u.status === 'Active' || !u.status) && u.id !== user?.id)
      .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')),
    [storeUsers, user?.id]
  );

  const roles = useMemo(
    () => Object.values(storeRoles).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [storeRoles]
  );

  const groupedByRole = useMemo(() => {
    const groups = {};
    allUsers.forEach((u) => {
      const roleId = u.role_id || '_none';
      if (!groups[roleId]) groups[roleId] = [];
      groups[roleId].push(u);
    });
    return roles
      .map((r) => ({ roleId: r.id, roleName: r.name || r.id, users: groups[r.id] || [] }))
      .filter((g) => g.users.length > 0)
      .concat(groups['_none']?.length ? [{ roleId: '_none', roleName: 'No Role Assigned', users: groups['_none'] }] : []);
  }, [allUsers, roles]);

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

  const [mode, setMode] = useState('unrestricted');
  const [checked, setChecked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (initialAllowed) {
      setMode('restricted');
      setChecked(new Set(initialAllowed));
    } else {
      setMode('unrestricted');
      setChecked(new Set(allUsers.map((u) => u.id)));
    }
  }, [user?.id, initialAllowed]);

  if (!user) return null;

  function toggleUser(uid) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  function toggleRoleGroup(roleId) {
    const group = groupedByRole.find((g) => g.roleId === roleId);
    if (!group) return;
    const groupIds = group.users.map((u) => u.id);
    const allChecked = groupIds.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      groupIds.forEach((id) => allChecked ? next.delete(id) : next.add(id));
      return next;
    });
  }

  function selectAll() { setChecked(new Set(allUsers.map((u) => u.id))); }
  function selectNone() { setChecked(new Set()); }

  async function handleSave() {
    setSaving(true);
    const allowedJson = mode === 'restricted' ? JSON.stringify([...checked]) : null;
    const now = new Date().toISOString();

    try {
      if (existingRecord?._id) {
        const fields = { allowed_assignees: allowedJson || '', updated_at: now, updated_by: appUserId || '' };
        await updateUserPermission(existingRecord._id, fields);
        mergeEntities('userPermissions', { [existingRecord._id]: { ...existingRecord, ...fields } });
      } else {
        const fields = {
          id: `up_${user.id}`,
          user_id: user.id,
          permissions: JSON.stringify([]),
          allowed_assignees: allowedJson || '',
          updated_at: now,
          updated_by: appUserId || '',
        };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
      setToast('Assignment permissions saved');
      onSaved?.();
      setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setToast(`Error: ${err.message}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = (() => {
    if (mode === 'unrestricted' && initialAllowed === null) return false;
    if (mode === 'unrestricted' && initialAllowed !== null) return true;
    if (mode === 'restricted' && initialAllowed === null) return true;
    if (initialAllowed && checked.size !== initialAllowed.size) return true;
    if (initialAllowed) { for (const k of checked) if (!initialAllowed.has(k)) return true; }
    return false;
  })();

  return (
    <div data-testid="assignee-editor" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
          Can Assign To
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setMode('unrestricted')}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${mode === 'unrestricted' ? palette.accentGreen.hex : 'var(--color-border)'}`, background: mode === 'unrestricted' ? hexToRgba(palette.accentGreen.hex, 0.1) : 'none', fontSize: 11, fontWeight: 600, color: mode === 'unrestricted' ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}
          >Everyone</button>
          <button
            onClick={() => setMode('restricted')}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${mode === 'restricted' ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: mode === 'restricted' ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'none', fontSize: 11, fontWeight: 600, color: mode === 'restricted' ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}
          >Restricted</button>
        </div>
      </div>

      {mode === 'unrestricted' ? (
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic', padding: '8px 0' }}>
          This user can assign tasks and ownership to any active team member.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <button onClick={selectAll} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>Select All</button>
            <button onClick={selectNone} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>Select None</button>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              {checked.size} of {allUsers.length} selected
            </span>
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            {groupedByRole.map((group) => {
              const groupIds = group.users.map((u) => u.id);
              const allGroupChecked = groupIds.every((id) => checked.has(id));
              const someGroupChecked = groupIds.some((id) => checked.has(id)) && !allGroupChecked;

              return (
                <div key={group.roleId} data-testid={`role-group-${group.roleId}`}>
                  <div
                    onClick={() => toggleRoleGroup(group.roleId)}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: hexToRgba(palette.backgroundDark.hex, 0.03), borderBottom: '1px solid var(--color-border)', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <input
                      type="checkbox" checked={allGroupChecked}
                      ref={(el) => { if (el) el.indeterminate = someGroupChecked; }}
                      onChange={() => toggleRoleGroup(group.roleId)}
                      style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                      {group.roleName}
                    </span>
                    <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                      {groupIds.filter((id) => checked.has(id)).length}/{groupIds.length}
                    </span>
                  </div>
                  {group.users.map((u) => (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 12px 6px 28px', cursor: 'pointer', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
                      <input
                        type="checkbox" checked={checked.has(u.id)}
                        onChange={() => toggleUser(u.id)}
                        style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>
                        {u.first_name} {u.last_name}
                      </span>
                      {u.email && (
                        <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 'auto' }}>{u.email}</span>
                      )}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        {toast && <span style={{ fontSize: 12, fontWeight: 600, color: toast.startsWith('Error') ? palette.primaryMagenta.hex : palette.accentGreen.hex }}>{toast}</span>}
        {!toast && <span />}
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          style={{ padding: '7px 18px', borderRadius: 7, background: (saving || !hasChanges) ? hexToRgba(palette.backgroundDark.hex, 0.07) : palette.accentGreen.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: (saving || !hasChanges) ? hexToRgba(palette.backgroundDark.hex, 0.3) : palette.backgroundLight.hex, cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save Assignment Permissions'}
        </button>
      </div>
    </div>
  );
}
