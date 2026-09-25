import { useEffect, useMemo, useState } from 'react';
import { useCareStore, mergeEntities, removeEntity } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { syncUserLanguages } from '../../api/userLanguages.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Self-serve "Languages I speak" for Settings. Writes the same UserLanguages
 * rows the admin User Management sheet manages, so staff-patient language
 * matching (StagePanel etc.) picks the selections up automatically.
 */
export default function MyLanguagesSection() {
  const { appUserId } = useCurrentAppUser();
  const storeLanguages = useCareStore((s) => s.languages);
  const storeUserLanguages = useCareStore((s) => s.userLanguages);

  const catalog = useMemo(
    () => Object.values(storeLanguages || {})
      .filter((l) => l.is_active !== false)
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(String(b.name))),
    [storeLanguages],
  );

  const existing = useMemo(
    () => Object.values(storeUserLanguages || {}).filter((r) => r.user_id === appUserId),
    [storeUserLanguages, appUserId],
  );

  const initial = useMemo(() => new Set(existing.map((r) => r.language_id)), [existing]);
  const [selected, setSelected] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);

  // Re-sync draft when the store rows change (e.g. after hydrate or save).
  useEffect(() => { setSelected(new Set(initial)); }, [appUserId, initial]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  function toggle(langId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(langId)) next.delete(langId); else next.add(langId);
      return next;
    });
  }

  async function handleSave() {
    if (!appUserId) return;
    setSaving(true);
    setFlash(null);
    try {
      const { created, removed } = await syncUserLanguages(appUserId, [...selected], existing);
      removed.forEach((id) => removeEntity('userLanguages', id));
      if (created.length) {
        const map = {};
        created.forEach((r) => { map[r._id] = r; });
        mergeEntities('userLanguages', map);
      }
      setFlash('Saved');
      setTimeout(() => setFlash(null), 2500);
    } catch (err) {
      setFlash(`Failed: ${err?.message || 'could not save'}`);
    } finally {
      setSaving(false);
    }
  }

  if (!appUserId) return null;

  return (
    <div style={{
      background: palette.backgroundLight.hex,
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 16,
    }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
        Languages I Speak
      </h2>
      <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 16px', lineHeight: 1.45 }}>
        Select every language you can serve patients in. This is used to match staff with patients by preferred language.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {catalog.length === 0 ? (
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
            Language list is still loading.
          </p>
        ) : catalog.map((lang) => {
          const on = selected.has(lang.id);
          return (
            <button
              key={lang.id}
              type="button"
              onClick={() => toggle(lang.id)}
              style={{
                padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600,
                border: on ? `1.5px solid ${palette.primaryMagenta.hex}` : '1px solid var(--color-border)',
                background: on ? hexToRgba(palette.primaryMagenta.hex, 0.1) : palette.backgroundLight.hex,
                color: on ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
              }}
            >
              {lang.name}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0 }}>
          {selected.size === 0 ? 'No languages selected' : `${selected.size} selected`}
          {dirty && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved</span>}
          {flash && <span style={{ color: flash === 'Saved' ? palette.accentGreen.hex : palette.accentOrange.hex, fontWeight: 600, marginLeft: 8 }}>{flash}</span>}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
            background: (saving || !dirty) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
            color: palette.backgroundLight.hex,
            cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save languages'}
        </button>
      </div>
    </div>
  );
}
