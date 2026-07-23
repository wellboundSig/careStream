import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities, removeEntity, updateEntity } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import {
  PERMISSION_KEYS,
  PERMISSION_CATALOG,
} from '../../data/permissionKeys.js';
import {
  createPermissionPreset,
  updatePermissionPreset,
  deletePermissionPreset,
} from '../../api/permissionPresets.js';
import { updateRole } from '../../api/roles.js';
import PermissionChecklist from '../../components/users/PermissionChecklist.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const ALL_KEYS = Object.values(PERMISSION_KEYS);

export default function Permissions() {
  const { can } = usePermissions();
  const storePresets = useCareStore((s) => s.permissionPresets);
  const presets = useMemo(
    () => Object.values(storePresets).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [storePresets],
  );

  const [editing, setEditing] = useState(null); // preset object or { _new: true }
  const [toast, setToast] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);

  if (!can(PERMISSION_KEYS.ADMIN_PERMISSIONS)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: hexToRgba(palette.primaryMagenta.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke={palette.primaryMagenta.hex} strokeWidth="1.8"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={palette.primaryMagenta.hex} strokeWidth="1.8" strokeLinecap="round"/></svg>
        </div>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 320, textAlign: 'center' }}>
          You need the Manage Permissions permission to access this page.
        </p>
      </div>
    );
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // Duplicate a preset into a new, non-system editable copy. The copy keeps the
  // same permission set so it can serve as a starting point for a tweaked role.
  async function handleDuplicate(preset) {
    if (duplicatingId) return;
    setDuplicatingId(preset._id || preset.id);
    const now = new Date().toISOString();
    const baseName = (preset.name || 'Preset').replace(/\s*\(copy(?: \d+)?\)\s*$/i, '');
    const existingNames = new Set(
      Object.values(storePresets).map((p) => (p.name || '').toLowerCase()),
    );
    let copyName = `${baseName} (Copy)`;
    let n = 2;
    while (existingNames.has(copyName.toLowerCase())) copyName = `${baseName} (Copy ${n++})`;
    try {
      const fields = {
        id: `preset_${Date.now()}`,
        name: copyName,
        description: preset.description || '',
        permissions: preset.permissions || '[]',
        is_system: false,
        created_at: now,
        updated_at: now,
      };
      const rec = await createPermissionPreset(fields);
      mergeEntities('permissionPresets', { [rec.id]: { _id: rec.id, ...rec.fields } });
      showToast(`Duplicated as "${copyName}"`);
      setEditing({ _id: rec.id, ...rec.fields });
    } catch (err) {
      console.error('[Permissions] Duplicate failed:', err);
      showToast('Duplicate failed', 'error');
    } finally {
      setDuplicatingId(null);
    }
  }

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Permission Presets</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              Role packets that serve as starting points when configuring user permissions
            </p>
          </div>
          <button
            onClick={() => setEditing({ _new: true, name: '', description: '', permissions: '[]', is_system: false })}
            style={{ padding: '9px 18px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            New Preset
          </button>
        </div>

        <RoleDefaultsPanel onToast={showToast} />

        <h2 style={{ fontSize: 14, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 12, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Preset library
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {presets.map((preset) => {
            let permCount = 0;
            try { permCount = JSON.parse(preset.permissions || '[]').length; } catch { /* */ }
            return (
              <div
                key={preset._id || preset.id}
                onClick={() => setEditing(preset)}
                style={{
                  padding: '18px 20px', borderRadius: 12, cursor: 'pointer',
                  background: palette.backgroundLight.hex,
                  border: '1px solid var(--color-border)',
                  boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
                  transition: 'box-shadow 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = palette.primaryMagenta.hex; e.currentTarget.style.boxShadow = `0 2px 12px ${hexToRgba(palette.primaryMagenta.hex, 0.1)}`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>{preset.name}</h3>
                  {preset.is_system && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: hexToRgba(palette.accentBlue.hex, 0.12), color: palette.accentBlue.hex }}>SYSTEM</span>
                  )}
                </div>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 10, lineHeight: 1.4 }}>
                  {preset.description || 'No description'}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
                    {permCount} / {ALL_KEYS.length} permissions
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicate(preset); }}
                    disabled={duplicatingId === (preset._id || preset.id)}
                    title="Duplicate this preset"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: duplicatingId ? 'wait' : 'pointer' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4"/><path d="M10.5 5.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    {duplicatingId === (preset._id || preset.id) ? 'Duplicating…' : 'Duplicate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <PresetEditor
          preset={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { setEditing(null); showToast(`Preset "${saved.name}" saved`); }}
          onDeleted={(name) => { setEditing(null); showToast(`Preset "${name}" deleted`); }}
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

function firstId(v) {
  if (Array.isArray(v)) return v[0] || '';
  return v || '';
}

/** Link each Role to an optional default PermissionPreset (or leave name-only). */
function RoleDefaultsPanel({ onToast }) {
  const storeRoles = useCareStore((s) => s.roles);
  const storePresets = useCareStore((s) => s.permissionPresets);
  const [savingId, setSavingId] = useState(null);

  const roles = useMemo(
    () => Object.values(storeRoles || {}).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [storeRoles],
  );
  const presets = useMemo(
    () => Object.values(storePresets || {}).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [storePresets],
  );

  async function setDefault(role, presetId) {
    if (!role?._id) return;
    setSavingId(role.id);
    const prev = firstId(role.default_preset_id);
    updateEntity('roles', role._id, { default_preset_id: presetId || '' });
    try {
      await updateRole(role._id, { default_preset_id: presetId || '' });
      onToast?.(
        presetId
          ? `“${role.name}” default → ${presets.find((p) => p.id === presetId)?.name || presetId}`
          : `“${role.name}” is now name-only (no default permissions)`,
      );
    } catch (err) {
      updateEntity('roles', role._id, { default_preset_id: prev });
      onToast?.(`Failed: ${err.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{
      marginBottom: 28, padding: '18px 20px', borderRadius: 12,
      background: palette.backgroundLight.hex, border: '1px solid var(--color-border)',
      boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
    }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
          Role defaults
        </h2>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.45, maxWidth: 640 }}>
          Choose the default permission preset for each role,or leave blank for a name-only role.
          When you assign a role in User Management, you&apos;ll be asked whether to apply this default or keep the user&apos;s current permissions.
        </p>
      </div>

      {roles.length === 0 ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>No roles loaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roles.map((role) => {
            const current = firstId(role.default_preset_id);
            return (
              <div
                key={role._id || role.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '10px 12px', borderRadius: 8,
                  background: hexToRgba(palette.backgroundDark.hex, 0.025),
                }}
              >
                <div style={{ minWidth: 160, flex: '1 1 160px' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{role.name}</p>
                  {role.description && (
                    <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 2 }}>{role.description}</p>
                  )}
                </div>
                <select
                  value={current}
                  disabled={savingId === role.id}
                  onChange={(e) => setDefault(role, e.target.value)}
                  style={{
                    minWidth: 220, padding: '7px 10px', borderRadius: 7,
                    border: '1px solid var(--color-border)', background: palette.backgroundLight.hex,
                    fontSize: 12.5, color: palette.backgroundDark.hex, cursor: 'pointer', fontFamily: 'inherit',
                    opacity: savingId === role.id ? 0.5 : 1,
                  }}
                >
                  <option value="">— name only (no default) —</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {savingId === role.id && (
                  <span style={{ fontSize: 11.5, color: palette.accentBlue.hex }}>Saving…</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Preset editor modal ─────────────────────────────────────────────────────

function PresetEditor({ preset, onClose, onSaved, onDeleted }) {
  const isNew = !!preset._new;
  const [name, setName] = useState(preset.name || '');
  const [description, setDescription] = useState(preset.description || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const initialChecked = useMemo(() => {
    try {
      const arr = JSON.parse(preset.permissions || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }, [preset.permissions]);

  const [checked, setChecked] = useState(new Set(initialChecked));

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

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const permsJson = JSON.stringify([...checked]);

    try {
      if (isNew) {
        const fields = {
          id: `preset_${Date.now()}`,
          name: name.trim(),
          description: description.trim(),
          permissions: permsJson,
          is_system: false,
          created_at: now,
          updated_at: now,
        };
        const rec = await createPermissionPreset(fields);
        mergeEntities('permissionPresets', { [rec.id]: { _id: rec.id, ...rec.fields } });
        onSaved({ name: name.trim() });
      } else {
        await updatePermissionPreset(preset._id, {
          name: name.trim(),
          description: description.trim(),
          permissions: permsJson,
          updated_at: now,
        });
        mergeEntities('permissionPresets', {
          [preset._id]: { ...preset, name: name.trim(), description: description.trim(), permissions: permsJson, updated_at: now },
        });
        onSaved({ name: name.trim() });
      }
    } catch (err) {
      console.error('[Permissions] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete preset "${name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deletePermissionPreset(preset._id);
      removeEntity('permissionPresets', preset._id);
      onDeleted(name);
    } catch (err) {
      console.error('[Permissions] Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 9995, background: hexToRgba(palette.backgroundDark.hex, 0.55), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: `0 8px 48px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, background: palette.primaryDeepPlum.hex }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundLight.hex }}>
              {isNew ? 'New Preset' : `Edit: ${preset.name}`}
            </h2>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        {/* Name + description */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Preset Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior Intake Coordinator" style={{ width: '100%', padding: '8px 11px', borderRadius: 7, border: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.03), fontSize: 13, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this role packet…" style={{ width: '100%', padding: '8px 11px', borderRadius: 7, border: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.03), fontSize: 13, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* Checkboxes */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 8px', display: 'flex', flexDirection: 'column' }}>
          <PermissionChecklist
            checked={checked}
            onToggle={toggle}
            onToggleCategory={toggleCategory}
            showDescriptions={false}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {!isNew && !preset.is_system && (
              <button onClick={handleDelete} disabled={deleting} style={{ padding: '7px 14px', borderRadius: 7, background: hexToRgba(palette.primaryMagenta.hex, 0.08), border: 'none', fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete Preset'}
              </button>
            )}
            <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 10 }}>
              {checked.size} of {ALL_KEYS.length} permissions
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: '1px solid var(--color-border)', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} style={{ padding: '8px 22px', borderRadius: 8, background: (saving || !name.trim()) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: (saving || !name.trim()) ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save Preset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
