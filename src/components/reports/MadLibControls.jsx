import { useEffect, useMemo, useRef, useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';

const chipBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  verticalAlign: 'baseline',
  margin: '0 3px',
  padding: '2px 8px',
  borderRadius: 6,
  border: `1px dashed ${hexToRgba(palette.accentBlue.hex, 0.45)}`,
  background: hexToRgba(palette.accentBlue.hex, 0.06),
  color: palette.accentBlue.hex,
  fontSize: 13.5,
  fontWeight: 650,
  fontFamily: 'inherit',
  cursor: 'pointer',
  lineHeight: 1.4,
};

function Popover({ open, onClose, children, width = 280 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function dismiss(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 40,
        width,
        maxHeight: 280,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: palette.backgroundLight.hex,
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        boxShadow: `0 10px 28px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`,
      }}
    >
      {children}
    </div>
  );
}

/** Single-select inline chip (division, etc.). */
export function InlineSelect({ value, onChange, options, emptyLabel = 'All', placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const label = selected?.label || emptyLabel;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={chipBase}>
        {label}
        <Chevron />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={220}>
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false); }}
          style={menuItem(!value)}
        >
          {emptyLabel}
        </button>
        <div style={{ overflowY: 'auto', maxHeight: 220 }}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={menuItem(o.value === value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

/** Date chip. */
export function InlineDate({ value, onChange, placeholder = 'date' }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={chipBase}>
        {value || placeholder}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={200}>
        <div style={{ padding: 10 }}>
          <input
            type="date"
            autoFocus
            value={value || ''}
            onChange={(e) => {
              onChange(e.target.value);
              if (e.target.value) setOpen(false);
            }}
            style={{
              width: '100%', padding: '7px 8px', borderRadius: 6,
              border: '1px solid var(--color-border)', fontSize: 13,
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>
      </Popover>
    </span>
  );
}

/**
 * Searchable multi-select chip.
 * options: [{ value, label, searchText? }]
 */
export function InlineMulti({
  values = [],
  onChange,
  options,
  emptyLabel = 'Anyone',
  singular = 'selected',
  plural = 'selected',
  searchPlaceholder = 'Search…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label || ''} ${o.searchText || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const label = (() => {
    if (!values.length) return emptyLabel;
    if (values.length === 1) {
      return options.find((o) => o.value === values[0])?.label || `1 ${singular}`;
    }
    if (values.length <= 3) {
      return values
        .map((id) => options.find((o) => o.value === id)?.label || id)
        .join(', ');
    }
    return `${values.length} ${plural}`;
  })();

  function toggle(id) {
    if (values.includes(id)) onChange(values.filter((v) => v !== id));
    else onChange([...values, id]);
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={chipBase} title={label}>
        {values.length ? `any of ${label}` : emptyLabel}
        <Chevron />
      </button>
      <Popover open={open} onClose={() => { setOpen(false); setQuery(''); }} width={300}>
        <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--color-border)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              width: '100%', padding: '7px 9px', borderRadius: 6,
              border: '1px solid var(--color-border)', fontSize: 12.5,
              fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
            }}
          />
        </div>
        <div style={{ padding: '6px 8px', display: 'flex', gap: 6, borderBottom: '1px solid var(--color-border)' }}>
          <button type="button" onClick={() => onChange([])} style={tinyBtn}>Clear</button>
          <button
            type="button"
            onClick={() => onChange(options.map((o) => o.value))}
            style={tinyBtn}
          >
            Select all shown
          </button>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: 220 }}>
          {filtered.length === 0 && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: 12 }}>
              No matches
            </p>
          )}
          {filtered.map((o) => {
            const on = values.includes(o.value);
            return (
              <label
                key={o.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', cursor: 'pointer',
                  background: on ? hexToRgba(palette.accentBlue.hex, 0.06) : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(o.value)}
                  style={{ accentColor: palette.accentBlue.hex }}
                />
                <span style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{o.label}</span>
              </label>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden style={{ opacity: 0.7 }}>
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function menuItem(active) {
  return {
    display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
    padding: '8px 12px', fontSize: 13, fontFamily: 'inherit',
    background: active ? hexToRgba(palette.accentBlue.hex, 0.1) : 'transparent',
    color: palette.backgroundDark.hex, fontWeight: active ? 650 : 500,
  };
}

const tinyBtn = {
  border: '1px solid var(--color-border)', background: 'none', borderRadius: 5,
  padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  color: hexToRgba(palette.backgroundDark.hex, 0.55), fontFamily: 'inherit',
};
