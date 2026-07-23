import { useState, useMemo, useEffect, useRef } from 'react';
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

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * Unique slug for a new label given the current value set (mutates `used` as
 * values are claimed so batch adds don't collide with each other).
 */
function uniqueSlug(label, used) {
  let value = slugifyCategoryValue(label);
  let n = 2;
  const base = value;
  while (used.has(value)) value = `${base}_${n++}`;
  used.add(value);
  return value;
}

export default function ConflictCategories() {
  const { can } = usePermissions();
  const storeCats = useCareStore((s) => s.conflictCategories);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const categories = useMemo(
    () => Object.values(storeCats || {}).sort(
      (a, b) => Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999),
    ),
    [storeCats],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) =>
      String(c.label || '').toLowerCase().includes(q)
      || String(c.value || '').toLowerCase().includes(q),
    );
  }, [categories, search]);

  const existingValues = useMemo(
    () => new Set(categories.map((c) => c.value)),
    [categories],
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

  async function handleAddMany(labels) {
    const cleaned = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    if (!cleaned.length || busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    let maxSort = categories.reduce((m, c) => Math.max(m, Number(c.sort_order ?? 0)), 0);
    const used = new Set(existingValues);
    let ok = 0;
    try {
      for (const label of cleaned) {
        const value = uniqueSlug(label, used);
        maxSort += 10;
        const rec = await createConflictCategory({
          id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          value,
          label,
          sort_order: maxSort,
          is_active: true,
          created_at: now,
          updated_at: now,
        });
        mergeEntities('conflictCategories', { [rec.id]: { _id: rec.id, ...rec.fields } });
        ok++;
      }
      setAddOpen(false);
      showToast(ok === 1 ? `Added “${cleaned[0]}”` : `Added ${ok} categories`);
    } catch (err) {
      console.error('[ConflictCategories] add failed:', err);
      showToast(ok ? `Added ${ok}, then failed` : 'Add failed', 'error');
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
    // Move within the full ordered list (not the filtered view), so sort
    // stays consistent even while searching.
    const fullIdx = categories.findIndex((c) => c._id === filtered[idx]?._id);
    if (fullIdx < 0) return;
    const target = categories[fullIdx + dir];
    const cat = categories[fullIdx];
    if (!target || !cat) return;
    const a = Number(cat.sort_order ?? (fullIdx + 1) * 10);
    const b = Number(target.sort_order ?? (fullIdx + 1 + dir) * 10);
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Conflict Categories</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            Options shown when flagging a conflict.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            padding: '9px 16px', borderRadius: 8, border: 'none', flexShrink: 0,
            background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
            fontSize: 13, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          + Add category
        </button>
      </div>

      {/* Search — primary bar (users mistook the old add field for this) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-border)',
        background: palette.backgroundLight.hex,
      }}>
        <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.35), display: 'flex' }}>
          <SearchIcon />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories…"
          aria-label="Search categories"
          style={{
            flex: 1, padding: '11px 0', border: 'none', background: 'transparent',
            fontSize: 13.5, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit',
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 4,
              color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 16, lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {categories.length === 0 ? (
        <div style={{ padding: '28px 24px', borderRadius: 12, border: '1px dashed var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.02), textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>No categories yet</p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 14 }}>
            Load the built-in defaults, or add your own.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSeedDefaults}
              disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 8, background: palette.accentBlue.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Loading…' : 'Load built-in defaults'}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              style={{ padding: '9px 18px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}
            >
              + Add category
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '28px 24px', borderRadius: 12, border: '1px solid var(--color-border)', textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4 }}>No matches</p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            Nothing matches “{search}”. Try a different search, or{' '}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              style={{ border: 'none', background: 'none', padding: 0, color: palette.primaryMagenta.hex, fontWeight: 650, cursor: 'pointer', fontSize: 12.5 }}
            >
              add a new category
            </button>
            .
          </p>
        </div>
      ) : (
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          {filtered.map((cat, idx) => {
            const active = isActive(cat);
            const fullIdx = categories.findIndex((c) => c._id === cat._id);
            return (
              <div key={cat._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: idx === filtered.length - 1 ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, opacity: active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button type="button" onClick={() => handleMove(idx, -1)} disabled={fullIdx <= 0 || !!search.trim()} title={search.trim() ? 'Clear search to reorder' : 'Move up'} style={{ border: 'none', background: 'none', cursor: (fullIdx <= 0 || search.trim()) ? 'default' : 'pointer', color: hexToRgba(palette.backgroundDark.hex, (fullIdx <= 0 || search.trim()) ? 0.2 : 0.5), fontSize: 9, lineHeight: 1, padding: 0 }}>▲</button>
                  <button type="button" onClick={() => handleMove(idx, 1)} disabled={fullIdx < 0 || fullIdx >= categories.length - 1 || !!search.trim()} title={search.trim() ? 'Clear search to reorder' : 'Move down'} style={{ border: 'none', background: 'none', cursor: (fullIdx >= categories.length - 1 || search.trim()) ? 'default' : 'pointer', color: hexToRgba(palette.backgroundDark.hex, (fullIdx >= categories.length - 1 || search.trim()) ? 0.2 : 0.5), fontSize: 9, lineHeight: 1, padding: 0 }}>▼</button>
                </div>
                <input
                  defaultValue={cat.label}
                  key={`${cat._id}-${cat.label}`}
                  onBlur={(e) => handleRename(cat, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  style={{ flex: 1, padding: '6px 9px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', fontSize: 13.5, fontWeight: 500, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit' }}
                  onFocus={(e) => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.03); }}
                  onBlurCapture={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
                />
                <code style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontFamily: 'ui-monospace, Menlo, monospace' }}>{cat.value}</code>
                <button
                  type="button"
                  onClick={() => handleToggleActive(cat)}
                  title={active ? 'Active, click to hide from pickers' : 'Hidden, click to show in pickers'}
                  style={{ padding: '3px 10px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 650, cursor: 'pointer', background: active ? hexToRgba(palette.accentGreen.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.08), color: active ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}
                >
                  {active ? 'Active' : 'Hidden'}
                </button>
                <button
                  type="button"
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

      {addOpen && (
        <AddCategoriesModal
          busy={busy}
          existingLabels={categories.map((c) => c.label)}
          onClose={() => !busy && setAddOpen(false)}
          onSubmit={handleAddMany}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/**
 * Tag/pill composer: type a name → Enter (or comma) to stage a pill → Add all.
 * Familiar Gmail/Slack/Linear-style multi-add pattern.
 */
function AddCategoriesModal({ busy, existingLabels, onClose, onSubmit }) {
  const [pills, setPills] = useState([]);
  const [draft, setDraft] = useState('');
  const [warn, setWarn] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const existingLower = useMemo(
    () => new Set(existingLabels.map((l) => String(l).trim().toLowerCase())),
    [existingLabels],
  );

  function stageLabel(raw) {
    const label = String(raw || '').trim();
    if (!label) return;
    const lower = label.toLowerCase();
    if (pills.some((p) => p.toLowerCase() === lower)) {
      setWarn(`“${label}” is already in the list`);
      setDraft('');
      return;
    }
    if (existingLower.has(lower)) {
      setWarn(`“${label}” already exists`);
      setDraft('');
      return;
    }
    setWarn('');
    setPills((prev) => [...prev, label]);
    setDraft('');
  }

  function onDraftKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      stageLabel(draft);
    } else if (e.key === 'Backspace' && !draft && pills.length) {
      setPills((prev) => prev.slice(0, -1));
      setWarn('');
    }
  }

  function removePill(idx) {
    setPills((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    const pending = [...pills];
    if (draft.trim()) pending.push(draft.trim());
    onSubmit(pending);
  }

  const canSubmit = pills.length > 0 || !!draft.trim();

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, padding: '22px 24px',
        maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Add categories</p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '6px 0 0', lineHeight: 1.45 }}>
            Type a name and press <strong>Enter</strong> to add another. Then click Add all.
          </p>
        </div>

        {/* Pill composer — looks like a tag input, not a lone text field */}
        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            minHeight: 48, padding: '8px 10px', borderRadius: 10,
            border: `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
            background: '#fff', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
            cursor: 'text',
          }}
        >
          {pills.map((p, i) => (
            <span
              key={`${p}-${i}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px 4px 10px', borderRadius: 16, fontSize: 12.5, fontWeight: 600,
                background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                color: palette.primaryMagenta.hex,
              }}
            >
              {p}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removePill(i); }}
                aria-label={`Remove ${p}`}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                  color: palette.primaryMagenta.hex, fontSize: 14, lineHeight: 1, opacity: 0.7,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setWarn(''); }}
            onKeyDown={onDraftKeyDown}
            placeholder={pills.length ? 'Add another…' : 'e.g. Duplicate Referral'}
            disabled={busy}
            style={{
              flex: 1, minWidth: 120, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13.5, fontFamily: 'inherit', color: palette.backgroundDark.hex, padding: '4px 2px',
            }}
          />
        </div>

        {warn && (
          <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, margin: '-6px 0 0' }}>{warn}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '9px 14px', borderRadius: 8, border: '1px solid var(--color-border)',
              background: palette.backgroundLight.hex, fontSize: 13, fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.65), cursor: busy ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
              background: (!canSubmit || busy) ? hexToRgba(palette.primaryMagenta.hex, 0.35) : palette.primaryMagenta.hex,
              color: palette.backgroundLight.hex,
              cursor: (!canSubmit || busy) ? 'not-allowed' : 'pointer',
            }}
          >
            {busy
              ? 'Adding…'
              : pills.length + (draft.trim() ? 1 : 0) <= 1
                ? 'Add category'
                : `Add all (${pills.length + (draft.trim() ? 1 : 0)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
