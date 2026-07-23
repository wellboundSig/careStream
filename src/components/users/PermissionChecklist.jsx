import { useMemo, useState, useEffect, useRef } from 'react';
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_GROUPS,
} from '../../data/permissionKeys.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const CAT_COLORS = [
  palette.primaryMagenta.hex,
  palette.accentBlue.hex,
  palette.accentGreen.hex,
  palette.accentOrange.hex,
  palette.primaryDeepPlum.hex,
  '#0D9488',
];
function catColor(idx) { return CAT_COLORS[idx % CAT_COLORS.length]; }

/**
 * Searchable, family-grouped permission catalog (user sheet, modal, presets).
 * Owns its own scroll so the search bar stays pinned and visible.
 */
export default function PermissionChecklist({
  checked,
  onToggle,
  onToggleCategory,
  presetKeys = null,
  showDescriptions = true,
  autoFocusSearch = false,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | granted | missing
  const [focusCat, setFocusCat] = useState(''); // '' = all categories
  const [collapsed, setCollapsed] = useState(() => new Set(PERMISSION_CATEGORIES));
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const q = query.trim().toLowerCase();

  const catalogByCat = useMemo(() => {
    const map = new Map();
    for (const cat of PERMISSION_CATEGORIES) map.set(cat, []);
    for (const p of PERMISSION_CATALOG) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category).push(p);
    }
    for (const items of map.values()) {
      items.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    }
    return map;
  }, []);

  const grouped = useMemo(() => {
    return PERMISSION_CATEGORIES.map((cat, gi) => {
      const items = (catalogByCat.get(cat) || []).filter((p) => {
        if (focusCat && p.category !== focusCat) return false;
        if (filter === 'granted' && !checked.has(p.key)) return false;
        if (filter === 'missing' && checked.has(p.key)) return false;
        if (!q) return true;
        const hay = `${p.label} ${p.key} ${p.description || ''} ${p.category}`.toLowerCase();
        return hay.includes(q);
      });
      return { category: cat, items, color: catColor(gi), index: gi };
    }).filter((g) => g.items.length > 0);
  }, [catalogByCat, checked, filter, focusCat, q]);

  const families = useMemo(() => {
    return PERMISSION_CATEGORY_GROUPS.map((fam) => ({
      ...fam,
      groups: fam.categories
        .map((cat) => grouped.find((g) => g.category === cat))
        .filter(Boolean),
    })).filter((fam) => fam.groups.length > 0);
  }, [grouped]);

  // Searching / filtering expands matches. Clearing leaves collapse state alone.
  useEffect(() => {
    if (!q && !focusCat && filter === 'all') return;
    setCollapsed(new Set());
  }, [q, focusCat, filter]);

  useEffect(() => {
    if (!autoFocusSearch) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [autoFocusSearch]);

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
  function collapseAll() { setCollapsed(new Set(PERMISSION_CATEGORIES)); }

  function jumpToCategory(cat) {
    setFocusCat((prev) => (prev === cat ? '' : cat));
    setCollapsed(new Set());
    requestAnimationFrame(() => {
      listRef.current?.scrollTo?.({ top: 0 });
    });
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 0,
      minHeight: 0, flex: 1, overflow: 'hidden',
    }}>
      {/* Pinned toolbar — never scrolls away */}
      <div style={{
        flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: 10,
        paddingBottom: 12,
        borderBottom: '1px solid var(--color-border)',
        background: palette.backgroundLight.hex,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 40, padding: '0 12px', borderRadius: 10,
          border: `1.5px solid ${q ? palette.accentBlue.hex : 'var(--color-border)'}`,
          background: hexToRgba(palette.accentBlue.hex, q ? 0.06 : 0.03),
          boxShadow: q ? `0 0 0 3px ${hexToRgba(palette.accentBlue.hex, 0.12)}` : 'none',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke={palette.accentBlue.hex} strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke={palette.accentBlue.hex} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions (e.g. NTUC, marketer, reports)…"
            aria-label="Search permissions"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'none',
              fontSize: 13.5, fontWeight: 500, color: palette.backgroundDark.hex, fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.1),
                width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                fontSize: 13, fontWeight: 800, color: hexToRgba(palette.backgroundDark.hex, 0.55),
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
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
                height: 28, padding: '0 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                border: `1px solid ${filter === f.id ? palette.accentBlue.hex : 'var(--color-border)'}`,
                background: filter === f.id ? hexToRgba(palette.accentBlue.hex, 0.1) : 'none',
                color: filter === f.id ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
              }}
            >
              {f.label}
            </button>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--color-border)', margin: '0 2px' }} />
          <button type="button" onClick={expandAll} style={linkBtnStyle}>Expand all</button>
          <button type="button" onClick={collapseAll} style={linkBtnStyle}>Collapse</button>
          {(q || focusCat || filter !== 'all') && (
            <button
              type="button"
              onClick={() => { setQuery(''); setFocusCat(''); setFilter('all'); }}
              style={{ ...linkBtnStyle, color: palette.primaryMagenta.hex }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Jump chips — filter to one category */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'thin',
        }}>
          <Chip active={!focusCat} onClick={() => setFocusCat('')}>All sections</Chip>
          {PERMISSION_CATEGORIES.map((cat, i) => {
            const total = (catalogByCat.get(cat) || []).length;
            const on = (catalogByCat.get(cat) || []).filter((p) => checked.has(p.key)).length;
            return (
              <Chip
                key={cat}
                active={focusCat === cat}
                color={catColor(i)}
                onClick={() => jumpToCategory(cat)}
              >
                {cat}
                <span style={{ opacity: 0.65, fontWeight: 600 }}> {on}/{total}</span>
              </Chip>
            );
          })}
        </div>

        <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
          {q || filter !== 'all' || focusCat
            ? `${matchCount} match${matchCount === 1 ? '' : 'es'} · type to search any label or key`
            : `${PERMISSION_CATALOG.length} permissions in ${PERMISSION_CATEGORIES.length} sections — search or pick a chip above`}
        </p>
      </div>

      {/* Scrollable families */}
      <div
        ref={listRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {families.length === 0 && (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: '28px 8px', textAlign: 'center' }}>
            No permissions match. Try a different search or clear filters.
          </p>
        )}

        {families.map((fam) => (
          <div key={fam.label}>
            <p style={{
              fontSize: 10.5, fontWeight: 750, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: hexToRgba(palette.backgroundDark.hex, 0.38),
              margin: '0 0 8px 2px',
            }}>
              {fam.label}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fam.groups.map((group) => {
                const catKeys = (catalogByCat.get(group.category) || []).map((p) => p.key);
                const allCatChecked = catKeys.length > 0 && catKeys.every((k) => checked.has(k));
                const someCatChecked = catKeys.some((k) => checked.has(k)) && !allCatChecked;
                const grantedInCat = catKeys.filter((k) => checked.has(k)).length;
                const isOpen = !collapsed.has(group.category) || !!q || !!focusCat;

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
                        background: hexToRgba(group.color, 0.07),
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
                          fontSize: 12, fontWeight: 750, letterSpacing: '0.04em',
                          color: group.color,
                        }}>
                          {group.category}
                        </span>
                        <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 600 }}>
                          {grantedInCat}/{catKeys.length}
                          {(q || focusCat) ? ` · ${group.items.length} shown` : ''}
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
                                  {highlightMatch(perm.label, q)}
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
        ))}
      </div>
    </div>
  );
}

function Chip({ children, active, onClick, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 28,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${active ? (color || palette.accentBlue.hex) : 'var(--color-border)'}`,
        background: active
          ? hexToRgba(color || palette.accentBlue.hex, 0.12)
          : hexToRgba(palette.backgroundDark.hex, 0.03),
        color: active ? (color || palette.accentBlue.hex) : hexToRgba(palette.backgroundDark.hex, 0.55),
        fontSize: 11.5,
        fontWeight: 650,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function highlightMatch(label, q) {
  if (!q) return label;
  const idx = label.toLowerCase().indexOf(q);
  if (idx < 0) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark style={{
        background: hexToRgba(palette.highlightYellow.hex, 0.55),
        color: 'inherit',
        borderRadius: 2,
        padding: '0 1px',
      }}>
        {label.slice(idx, idx + q.length)}
      </mark>
      {label.slice(idx + q.length)}
    </>
  );
}

const linkBtnStyle = {
  height: 28, padding: '0 8px', borderRadius: 6, border: 'none',
  background: 'none', cursor: 'pointer',
  fontSize: 11.5, fontWeight: 650,
  color: hexToRgba(palette.backgroundDark.hex, 0.45),
};
