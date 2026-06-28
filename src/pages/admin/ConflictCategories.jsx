import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities, removeEntity } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  createConflictCategory,
  updateConflictCategory,
  deleteConflictCategory,
} from '../../api/conflictCategories.js';
import {
  slugifyCategoryValue,
  defaultConflictCategoryRows,
} from '../../data/conflictCategories.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function isActive(c) {
  return c.is_active !== false && c.is_active !== 'false' && c.is_active !== 0 && c.is_active !== '0';
}

export default function ConflictCategories() {
  const { can } = usePermissions();
  const storeCats = useCareStore((s) => s.conflictCategories);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const categories = useMemo(
    () => Object.values(storeCats || {}).sort(
      (a, b) => Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999),
    ),
    [storeCats],
  );

  if (!can(PERMISSION_KEYS.CONFLICT_MANAGE_CATEGORIES)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 340, textAlign: 'center' }}>
          You need the “Manage conflict categories” permission to access this page.
        </p>
      </div>
    );
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  const existingValues = useMemo(
    () => new Set(categories.map((c) => c.value)),
    [categories],
  );

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label || busy) return;
    let value = slugifyCategoryValue(label);
    let n = 2;
    while (existingValues.has(value)) value = `${slugifyCategoryValue(label)}_${n++}`;
    setBusy(true);
    const now = new Date().toISOString();
    const maxSort = categories.reduce((m, c) => Math.max(m, Number(c.sort_order ?? 0)), 0);
    try {
      const rec = await createConflictCategory({
        id: `cc_${Date.now()}`,
        value,
        label,
        sort_order: maxSort + 10,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
      mergeEntities('conflictCategories', { [rec.id]: { _id: rec.id, ...rec.fields } });
      setNewLabel('');
      showToast(`Added “${label}”`);
    } catch (err) {
      console.error('[ConflictCategories] add failed:', err);
      showToast('Add failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function patch(cat, fields) {
    const now = new Date().toISOString();
    try {
      await updateConflictCategory(cat._id, { ...fields, updated_at: now });
      mergeEntities('conflictCategories', { [cat._id]: { ...cat, ...fields, updated_at: now } });
    } catch (err) {
      console.error('[ConflictCategories] update failed:', err);
      showToast('Update failed', 'error');
    }
  }

  async function handleRename(cat, label) {
    const trimmed = label.trim();
    if (!trimmed || trimmed === cat.label) return;
    await patch(cat, { label: trimmed });
  }

  async function handleToggleActive(cat) {
    await patch(cat, { is_active: !isActive(cat) });
  }

  async function handleMove(idx, dir) {
    const target = categories[idx + dir];
    const cat = categories[idx];
    if (!target || !cat) return;
    const a = Number(cat.sort_order ?? (idx + 1) * 10);
    const b = Number(target.sort_order ?? (idx + 1 + dir) * 10);
    await Promise.all([patch(cat, { sort_order: b }), patch(target, { sort_order: a })]);
  }

  async function handleDelete(cat) {
    if (!confirm(`Delete the “${cat.label}” conflict category? Existing conflicts already tagged with it are unaffected.`)) return;
    try {
      await deleteConflictCategory(cat._id);
      removeEntity('conflictCategories', cat._id);
      showToast(`Deleted “${cat.label}”`);
    } catch (err) {
      console.error('[ConflictCategories] delete failed:', err);
      showToast('Delete failed', 'error');
    }
  }

  async function handleSeedDefaults() {
    if (busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    try {
      for (const row of defaultConflictCategoryRows()) {
        const rec = await createConflictCategory({
          id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          ...row,
          created_at: now,
          updated_at: now,
        });
        mergeEntities('conflictCategories', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
      showToast('Loaded built-in defaults');
    } catch (err) {
      console.error('[ConflictCategories] seed failed:', err);
      showToast('Seeding failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Conflict Categories</h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          The categories staff choose when routing a referral to Conflict. Changes apply everywhere conflicts are flagged or displayed.
        </p>
      </div>

      {/* Add new */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="New category label (e.g. Duplicate Referral)…"
          style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.03), fontSize: 13, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit' }}
        />
        <button
          onClick={handleAdd}
          disabled={!newLabel.trim() || busy}
          style={{ padding: '9px 18px', borderRadius: 8, background: (!newLabel.trim() || busy) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: (!newLabel.trim() || busy) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
        >
          Add Category
        </button>
      </div>

      {categories.length === 0 ? (
        <div style={{ padding: '28px 24px', borderRadius: 12, border: '1px dashed var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.02), textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>No categories configured yet</p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 14 }}>
            The app is currently showing the built-in default categories. Load them here to start customizing.
          </p>
          <button
            onClick={handleSeedDefaults}
            disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 8, background: palette.accentBlue.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? 'Loading…' : 'Load built-in defaults'}
          </button>
        </div>
      ) : (
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          {categories.map((cat, idx) => {
            const active = isActive(cat);
            return (
              <div key={cat._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: idx === categories.length - 1 ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, opacity: active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <button onClick={() => handleMove(idx, -1)} disabled={idx === 0} title="Move up" style={{ border: 'none', background: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: hexToRgba(palette.backgroundDark.hex, idx === 0 ? 0.2 : 0.5), fontSize: 9, lineHeight: 1, padding: 0 }}>▲</button>
                <button onClick={() => handleMove(idx, 1)} disabled={idx === categories.length - 1} title="Move down" style={{ border: 'none', background: 'none', cursor: idx === categories.length - 1 ? 'default' : 'pointer', color: hexToRgba(palette.backgroundDark.hex, idx === categories.length - 1 ? 0.2 : 0.5), fontSize: 9, lineHeight: 1, padding: 0 }}>▼</button>
              </div>
              <input
                defaultValue={cat.label}
                onBlur={(e) => handleRename(cat, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={{ flex: 1, padding: '6px 9px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', fontSize: 13.5, fontWeight: 500, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit' }}
                onFocus={(e) => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
                onBlurCapture={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
              />
              <code style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontFamily: 'ui-monospace, Menlo, monospace' }}>{cat.value}</code>
              <button
                onClick={() => handleToggleActive(cat)}
                title={active ? 'Active — click to hide from pickers' : 'Hidden — click to show in pickers'}
                style={{ padding: '3px 10px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 650, cursor: 'pointer', background: active ? hexToRgba(palette.accentGreen.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.08), color: active ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}
              >
                {active ? 'Active' : 'Hidden'}
              </button>
              <button
                onClick={() => handleDelete(cat)}
                title="Delete category"
                style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--color-border)', background: palette.backgroundLight.hex, cursor: 'pointer', color: palette.primaryMagenta.hex, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ×
              </button>
            </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
