import { useMemo, useState, useEffect } from 'react';
import { useCareStore } from '../../store/careStore.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Confirm dialog when changing a user's role.
 * Roles may be name-only or have a default permission preset —
 * admin chooses whether to apply that default or keep current permissions.
 */
export default function RoleChangeDialog({
  user,
  newRoleId,
  onConfirm,
  onCancel,
  working = false,
}) {
  const storeRoles = useCareStore((s) => s.roles);
  const storePresets = useCareStore((s) => s.permissionPresets);

  const role = useMemo(
    () => Object.values(storeRoles || {}).find((r) => r.id === newRoleId) || null,
    [storeRoles, newRoleId],
  );

  const defaultPreset = useMemo(() => {
    const presetId = role?.default_preset_id;
    if (!presetId) return null;
    return Object.values(storePresets || {}).find((p) => p.id === presetId) || null;
  }, [role, storePresets]);

  const roleName = role?.name || newRoleId || 'this role';
  const userName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'this user';
  const hasDefault = !!defaultPreset;

  const [choice, setChoice] = useState(hasDefault ? 'apply' : 'keep');

  useEffect(() => {
    setChoice(hasDefault ? 'apply' : 'keep');
  }, [newRoleId, hasDefault]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !working) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, working]);

  let presetCount = 0;
  try { presetCount = JSON.parse(defaultPreset?.permissions || '[]').length; } catch { /* */ }

  return (
    <div
      data-testid="role-change-dialog"
      onClick={(e) => e.target === e.currentTarget && !working && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.55),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex,
        borderRadius: 14, width: '100%', maxWidth: 440,
        boxShadow: `0 8px 40px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
            Change role for {userName}?
          </h2>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.45 }}>
            New role: <strong style={{ color: palette.backgroundDark.hex }}>{roleName}</strong>
            {!hasDefault && (
              <span> — this role has no default permission set (name only).</span>
            )}
          </p>
        </div>

        <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px',
              borderRadius: 10, cursor: hasDefault ? 'pointer' : 'not-allowed',
              border: `1.5px solid ${choice === 'apply' ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
              background: choice === 'apply' ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'transparent',
              opacity: hasDefault ? 1 : 0.45,
            }}
          >
            <input
              type="radio"
              name="role-perm-choice"
              checked={choice === 'apply'}
              disabled={!hasDefault || working}
              onChange={() => setChoice('apply')}
              style={{ marginTop: 2, accentColor: palette.primaryMagenta.hex }}
            />
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>
                Apply default permissions of {roleName}
              </p>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 3, lineHeight: 1.4 }}>
                {hasDefault
                  ? `Replaces current feature permissions with “${defaultPreset.name}” (${presetCount} permissions). Assignment targets are left unchanged.`
                  : 'No default preset is linked to this role. Set one under Permission Presets → Role defaults.'}
              </p>
            </div>
          </label>

          <label
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px',
              borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${choice === 'keep' ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
              background: choice === 'keep' ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'transparent',
            }}
          >
            <input
              type="radio"
              name="role-perm-choice"
              checked={choice === 'keep'}
              disabled={working}
              onChange={() => setChoice('keep')}
              style={{ marginTop: 2, accentColor: palette.primaryMagenta.hex }}
            />
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>
                Change role but keep current permissions
              </p>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 3, lineHeight: 1.4 }}>
                Updates the role label only. Feature permissions and who they can assign to stay as they are.
              </p>
            </div>
          </label>
        </div>

        <div style={{ padding: '12px 22px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            style={{ padding: '8px 16px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: '1px solid var(--color-border)', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(choice)}
            disabled={working || (choice === 'apply' && !hasDefault)}
            style={{
              padding: '8px 20px', borderRadius: 8,
              background: palette.primaryDeepPlum.hex, border: 'none',
              fontSize: 13, fontWeight: 650, color: '#fff',
              cursor: working ? 'not-allowed' : 'pointer', opacity: working ? 0.6 : 1,
            }}
          >
            {working ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
