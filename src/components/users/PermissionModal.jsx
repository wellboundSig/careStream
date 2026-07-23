import { useState, useMemo, useEffect, useRef } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { createUserPermission, updateUserPermission } from '../../api/userPermissions.js';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
} from '../../data/permissionKeys.js';
import PermissionChecklist from './PermissionChecklist.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const ALL_KEYS = Object.values(PERMISSION_KEYS);

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

export default function PermissionModal({ user, onClose, onOpenAssignable }) {
  const { appUserId } = useCurrentAppUser();
  const { resolveRole } = useLookups();

  const storePresets   = useCareStore((s) => s.permissionPresets);
  const storeUserPerms = useCareStore((s) => s.userPermissions);

  const presets = useMemo(() => Object.values(storePresets), [storePresets]);

  const existingRecord = useMemo(() => {
    if (!user?.id) return null;
    return Object.values(storeUserPerms).find((up) => up.user_id === user.id) || null;
  }, [user?.id, storeUserPerms]);

  const initialPerms = useMemo(() => {
    if (!existingRecord?.permissions) return new Set(ALL_KEYS);
    try {
      const arr = JSON.parse(existingRecord.permissions);
      return new Set(Array.isArray(arr) ? arr : ALL_KEYS);
    } catch {
      return new Set(ALL_KEYS);
    }
  }, [existingRecord]);

  const [checked, setChecked] = useState(() => new Set(initialPerms));
  const [selectedPreset, setSelectedPreset] = useState(existingRecord?.last_preset_id || '');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const syncedUserId = useRef(null);

  // Sync checkboxes only when opening for a new user — not when assignee saves
  // mutate the same UserPermissions row (that used to wipe unsaved checkbox edits).
  useEffect(() => {
    if (!user?.id) return;
    if (syncedUserId.current === user.id) return;
    syncedUserId.current = user.id;
    setChecked(new Set(initialPerms));
    setSelectedPreset(existingRecord?.last_preset_id || '');
  }, [user?.id, initialPerms, existingRecord?.last_preset_id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!user) return null;

  function toggle(key) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleCategory(cat) {
    const catKeys = PERMISSION_CATALOG.filter((p) => p.category === cat).map((p) => p.key);
    const allChecked = catKeys.every((k) => checked.has(k));
    setChecked((prev) => {
      const next = new Set(prev);
      catKeys.forEach((k) => allChecked ? next.delete(k) : next.add(k));
      return next;
    });
  }

  function applyPreset() {
    const preset = presets.find((p) => p.id === selectedPreset);
    if (!preset) return;
    try {
      const keys = JSON.parse(preset.permissions);
      setChecked(new Set(Array.isArray(keys) ? keys : []));
    } catch { /* ignore */ }
  }

  function selectAll() { setChecked(new Set(ALL_KEYS)); }
  function selectNone() { setChecked(new Set()); }

  const presetKeys = useMemo(() => {
    const preset = presets.find((p) => p.id === selectedPreset);
    if (!preset?.permissions) return null;
    try {
      const arr = JSON.parse(preset.permissions);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return null;
    }
  }, [selectedPreset, presets]);

  async function handleSave() {
    setSaving(true);
    const permsJson = JSON.stringify([...checked]);
    const now = new Date().toISOString();

    try {
      if (existingRecord?._id) {
        await updateUserPermission(existingRecord._id, {
          permissions: permsJson,
          last_preset_id: selectedPreset || '',
          updated_at: now,
          updated_by: appUserId || '',
        });
        mergeEntities('userPermissions', {
          [existingRecord._id]: {
            ...existingRecord,
            permissions: permsJson,
            last_preset_id: selectedPreset || '',
            updated_at: now,
            updated_by: appUserId || '',
          },
        });
      } else {
        const fields = {
          id: `up_${user.id}`,
          user_id: user.id,
          permissions: permsJson,
          last_preset_id: selectedPreset || '',
          updated_at: now,
          updated_by: appUserId || '',
        };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', {
          [rec.id]: { _id: rec.id, ...rec.fields },
        });
      }
      setToast('Permissions saved');
      setTimeout(() => { setToast(null); onClose(); }, 800);
    } catch (err) {
      setToast(`Error: ${err.message}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = (() => {
    if (checked.size !== initialPerms.size) return true;
    for (const k of checked) if (!initialPerms.has(k)) return true;
    return false;
  })();

  const roleName = resolveRole(user.role_id);

  const assigneeSummary = (() => {
    if (!existingRecord?.allowed_assignees) return 'Everyone';
    try {
      const arr = JSON.parse(existingRecord.allowed_assignees);
      if (!Array.isArray(arr)) return 'Everyone';
      if (arr.length === 0) return 'No one';
      return `${arr.length} ${arr.length === 1 ? 'person' : 'people'}`;
    } catch { return 'Everyone'; }
  })();

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9995,
        background: hexToRgba(palette.backgroundDark.hex, 0.55),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex,
        borderRadius: 16, width: '100%', maxWidth: 760,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 48px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        overflow: 'hidden', position: 'relative',
      }}>

        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, background: palette.primaryDeepPlum.hex }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                background: hexToRgba(palette.backgroundLight.hex, 0.15),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 800, color: palette.backgroundLight.hex,
              }}>
                {initials(user.first_name, user.last_name)}
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 2 }}>
                  {user.first_name} {user.last_name}
                </h2>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundLight.hex, 0.55) }}>
                  {user.email} &middot; {roleName}
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: hexToRgba(palette.primaryDeepPlum.hex, 0.04) }}>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), whiteSpace: 'nowrap' }}>Preset:</span>
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: palette.backgroundLight.hex, fontSize: 12.5, color: palette.backgroundDark.hex, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
          >
            <option value="">— no preset —</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={applyPreset}
            disabled={!selectedPreset}
            style={{ padding: '6px 14px', borderRadius: 7, background: selectedPreset ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 12, fontWeight: 650, color: selectedPreset ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: selectedPreset ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
          >
            Apply
          </button>
          <div style={{ borderLeft: '1px solid var(--color-border)', height: 20, margin: '0 2px' }} />
          <button onClick={selectAll} style={{ padding: '5px 10px', borderRadius: 6, background: 'none', border: '1px solid var(--color-border)', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>All</button>
          <button onClick={selectNone} style={{ padding: '5px 10px', borderRadius: 6, background: 'none', border: '1px solid var(--color-border)', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>None</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 8px', display: 'flex', flexDirection: 'column' }}>
          <PermissionChecklist
            checked={checked}
            onToggle={toggle}
            onToggleCategory={toggleCategory}
            presetKeys={presetKeys}
            showDescriptions
          />
        </div>

        {onOpenAssignable && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Can assign to
              </p>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.65), marginTop: 2 }}>
                Currently: <strong style={{ color: palette.backgroundDark.hex }}>{assigneeSummary}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAssignable}
              style={{ padding: '7px 14px', borderRadius: 7, background: hexToRgba(palette.accentBlue.hex, 0.1), border: 'none', fontSize: 12.5, fontWeight: 650, color: palette.accentBlue.hex, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Manage…
            </button>
          </div>
        )}

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {checked.size} of {ALL_KEYS.length} permissions granted
            {hasChanges && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved changes</span>}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: '1px solid var(--color-border)', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              style={{
                padding: '8px 22px', borderRadius: 8,
                background: (saving || !hasChanges) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
                border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex,
                cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
              }}
            >
              {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          </div>
        </div>

        {toast && (
          <div style={{
            position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
            background: toast.startsWith('Error') ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
            color: palette.backgroundLight.hex, padding: '9px 20px', borderRadius: 8,
            fontSize: 12.5, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
