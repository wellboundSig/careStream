import { useMemo, useState, useEffect } from 'react';
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
} from '../../data/permissionKeys.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const CAT_COLORS = [
  palette.primaryMagenta.hex,
  palette.accentBlue.hex,
  palette.accentGreen.hex,
  palette.accentOrange.hex,
  palette.primaryDeepPlum.hex,
  palette.highlightYellow.hex,
];
function catColor(idx) { return CAT_COLORS[idx % CAT_COLORS.length]; }

/**
 * Searchable, collapsible permission catalog used by preset editor + user modal.
 */
export default function PermissionChecklist({
  checked,
  onToggle,
  onToggleCategory,
  presetKeys = null,
  showDescriptions = true,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | granted | missing
  // Start collapsed so the page isn't a wall of checkboxes.
  const [collapsed, setCollapsed] = useState(() => new Set(PERMISSION_CATEGORIES));

  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    return PERMISSION_CATEGORIES.map((cat, gi) => {
      const items = PERMISSION_CATALOG.filter((p) => {
        if (p.category !== cat) return false;
        if (filter === 'granted' && !checked.has(p.key)) return false;
        if (filter === 'missing' && checked.has(p.key)) return false;
        if (!q) return true;
        const hay = `${p.label} ${p.key} ${p.description || ''} ${p.category}`.toLowerCase();
        return hay.includes(q);
      });
      return { category: cat, items, color: catColor(gi), index: gi };
    }).filter((g) => g.items.length > 0);
  }, [checked, filter, q]);

  // When searching, expand all matching categories. When clearing search, leave state alone.
  useEffect(() => {
    if (!q) return;
    setCollapsed(new Set());
  }, [q]);

  const matchCount = grouped.reduce((n, g) => n + g.items.length, 0);

  function toggleCollapse(cat) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function expandAll() { setCollapsed(new Set()); }
  function collapseAll() {
    setCollapsed(new Set(PERMISSION_CATEGORIES));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 2,
        background: palette.backgroundLight.hex,
        paddingBottom: 4,
      }}>
        <div style={{
          flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 8,
          height: 34, padding: '0 10px', borderRadius: 8,
          border: '1px solid var(--color-border)',
          background: hexToRgba(palette.backgroundDark.hex, 0.03),
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'none',
              fontSize: 13, color: palette.backgroundDark.hex, fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{
                border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.08),
                width: 18, height: 18, borderRadius: 4, cursor: 'pointer',
                fontSize: 11, fontWeight: 800, color: hexToRgba(palette.backgroundDark.hex, 0.5),
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'granted', label: 'On' },
            { id: 'missing', label: 'Off' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              style={{
                height: 30, padding: '0 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                border: `1px solid ${filter === f.id ? palette.accentBlue.hex : 'var(--color-border)'}`,
                background: filter === f.id ? hexToRgba(palette.accentBlue.hex, 0.1) : 'none',
                color: filter === f.id ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button type="button" onClick={expandAll} style={linkBtnStyle}>Expand</button>
          <button type="button" onClick={collapseAll} style={linkBtnStyle}>Collapse</button>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: -4 }}>
        {q || filter !== 'all'
          ? `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${grouped.length} categor${grouped.length === 1 ? 'y' : 'ies'}`
          : `${PERMISSION_CATALOG.length} permissions in ${PERMISSION_CATEGORIES.length} categories — expand a section to edit`}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {grouped.length === 0 && (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: '20px 8px', textAlign: 'center' }}>
            No permissions match your search.
          </p>
        )}

        {grouped.map((group) => {
          const catKeys = PERMISSION_CATALOG.filter((p) => p.category === group.category).map((p) => p.key);
          const allCatChecked = catKeys.length > 0 && catKeys.every((k) => checked.has(k));
          const someCatChecked = catKeys.some((k) => checked.has(k)) && !allCatChecked;
          const grantedInCat = catKeys.filter((k) => checked.has(k)).length;
          const isOpen = !collapsed.has(group.category) || !!q;

          return (
            <div
              key={group.category}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                overflow: 'hidden',
                background: hexToRgba(palette.backgroundDark.hex, 0.015),
              }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: hexToRgba(group.color, 0.06),
                  borderBottom: isOpen ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={allCatChecked}
                  ref={(el) => { if (el) el.indeterminate = someCatChecked; }}
                  onChange={() => onToggleCategory(group.category)}
                  onClick={(e) => e.stopPropagation()}
                  title={`Toggle all in ${group.category}`}
                  style={{ accentColor: group.color, width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }}
                />
                <button
                  type="button"
                  onClick={() => toggleCollapse(group.category)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                    border: 'none', background: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                  }}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: group.color,
                  }}>
                    {group.category}
                  </span>
                  <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 600 }}>
                    {grantedInCat}/{catKeys.length}
                    {q ? ` · ${group.items.length} shown` : ''}
                  </span>
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
                    style={{
                      marginLeft: 'auto',
                      transform: isOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.15s',
                      color: hexToRgba(palette.backgroundDark.hex, 0.4),
                    }}
                  >
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {isOpen && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: showDescriptions ? '1fr' : '1fr 1fr',
                  gap: 2,
                  padding: '6px 6px 8px',
                }}>
                  {group.items.map((perm) => {
                    const isChecked = checked.has(perm.key);
                    const differsFromPreset = presetKeys && (presetKeys.has(perm.key) !== isChecked);
                    return (
                      <label
                        key={perm.key}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 9,
                          padding: showDescriptions ? '7px 10px' : '6px 10px',
                          borderRadius: 7, cursor: 'pointer',
                          background: differsFromPreset
                            ? hexToRgba(palette.highlightYellow.hex, 0.12)
                            : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggle(perm.key)}
                          style={{
                            accentColor: palette.primaryMagenta.hex,
                            width: 14, height: 14, marginTop: 1, cursor: 'pointer', flexShrink: 0,
                          }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>
                            {perm.label}
                          </span>
                          {differsFromPreset && (
                            <span style={{
                              marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px',
                              borderRadius: 4, background: hexToRgba(palette.highlightYellow.hex, 0.3),
                              color: '#7A5F00', verticalAlign: 'middle',
                            }}>
                              modified
                            </span>
                          )}
                          {showDescriptions && perm.description && (
                            <p style={{
                              fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45),
                              marginTop: 2, lineHeight: 1.35,
                            }}>
                              {perm.description}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const linkBtnStyle = {
  height: 30, padding: '0 8px', borderRadius: 6, border: 'none',
  background: 'none', cursor: 'pointer',
  fontSize: 11.5, fontWeight: 650,
  color: hexToRgba(palette.backgroundDark.hex, 0.45),
};
