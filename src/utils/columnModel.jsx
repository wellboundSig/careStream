import { useState, useMemo, useRef, useEffect } from 'react';
import palette, { hexToRgba } from './colors.js';

// ── Patient list column definitions ─────────────────────────────────────────
export const PATIENT_COLUMN_DEFS = [
  { key: 'patient',         label: 'Patient',         defaultOn: true,  alwaysOn: true,  sortField: 'last_name',      filterable: false },
  { key: 'division',        label: 'Division',         defaultOn: true,  sortField: 'division',        filterable: true  },
  { key: 'stage',           label: 'Stage',            defaultOn: true,  sortField: 'stage',           filterable: true  },
  { key: 'f2f',  label: 'F2F',  tooltip: 'Face-to-Face authorization — shows days until the F2F order expires (red = expired, orange = ≤14d remaining)',  defaultOn: true, filterable: false },
  { key: 'days', label: 'Days', tooltip: 'Days the patient has been in their current stage. Turns orange at >14 days to flag overdue referrals.', defaultOn: true, filterable: false },
  { key: 'marketer',        label: 'Marketer',         defaultOn: true,  filterable: true  },
  { key: 'insurance',       label: 'Insurance',        defaultOn: true,  sortField: 'insurance_plan',  filterable: true  },
  { key: 'referral_date',   label: 'Referral Date',    defaultOn: true,  filterable: true  },
  { key: 'referral_source', label: 'Referral Source',  defaultOn: false, filterable: true  },
  { key: 'facility',        label: 'Facility',         defaultOn: false, filterable: true  },
  { key: 'physician',       label: 'Physician',        defaultOn: false, filterable: true  },
];

// ── Module page column definitions ──────────────────────────────────────────
export const MODULE_COLUMN_DEFS = [
  { key: 'patient',   label: 'Patient',    defaultOn: true, alwaysOn: true, filterable: false },
  { key: 'division',  label: 'Division',   defaultOn: true, filterable: true },
  { key: 'source',    label: 'Source',     defaultOn: true, filterable: true },
  { key: 'triage',    label: 'Triage',     defaultOn: true, filterable: false },
  { key: 'days',      label: 'Days',       defaultOn: true, filterable: false, tooltip: 'Days in current stage' },
  { key: 'f2f',       label: 'F2F',        defaultOn: true, filterable: false, tooltip: 'F2F authorization countdown' },
  { key: 'owner',     label: 'Owner',      defaultOn: true, filterable: true },
  { key: 'insurance', label: 'Insurance',  defaultOn: false, filterable: true },
  { key: 'facility',  label: 'Facility',   defaultOn: false, filterable: true },
  { key: 'activity',  label: 'Last Activity', defaultOn: true, filterable: false },
];

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useColumnVisibility(columnDefs) {
  const [visibleCols, setVisibleCols] = useState(
    () => new Set(columnDefs.filter((c) => c.defaultOn).map((c) => c.key))
  );
  const activeColumns = useMemo(
    () => columnDefs.filter((c) => visibleCols.has(c.key)),
    [columnDefs, visibleCols]
  );
  return { visibleCols, setVisibleCols, activeColumns };
}

export function useColumnFilters(columnDefs) {
  const defaultFilters = useMemo(
    () => Object.fromEntries(columnDefs.filter((c) => c.filterable).map((c) => [c.key, ''])),
    [columnDefs]
  );
  const [colFilters, setColFilters] = useState({ ...defaultFilters });
  const [showFilters, setShowFilters] = useState(false);

  function setColFilter(key, val) {
    setColFilters((prev) => ({ ...prev, [key]: val }));
  }
  function clearFilters() {
    setColFilters({ ...defaultFilters });
  }
  const hasActiveFilters = useMemo(
    () => Object.values(colFilters).some((v) => v.trim()),
    [colFilters]
  );

  return { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters };
}

// ── FilterInput — polished input with clear × button ────────────────────────

export function FilterInput({ value, onChange, placeholder, options }) {
  const hasValue = !!value?.trim();
  const id = `fi-${placeholder?.replace(/\W/g, '') || 'x'}`;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        list={options?.length ? id : undefined}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Filter…'}
        style={{
          width: '100%', padding: '4px 24px 4px 8px', borderRadius: 5,
          border: `1px solid ${hasValue ? palette.accentBlue.hex : 'var(--color-border)'}`,
          background: hasValue ? hexToRgba(palette.accentBlue.hex, 0.04) : palette.backgroundLight.hex,
          fontSize: 11.5, color: palette.backgroundDark.hex, outline: 'none',
          fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.12s',
        }}
        onFocus={(e) => (e.target.style.borderColor = palette.accentBlue.hex)}
        onBlur={(e) => (e.target.style.borderColor = hasValue ? palette.accentBlue.hex : 'var(--color-border)')}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear filter"
          style={{
            position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)',
            width: 16, height: 16, borderRadius: 4, border: 'none', cursor: 'pointer',
            background: hexToRgba(palette.backgroundDark.hex, 0.08), color: hexToRgba(palette.backgroundDark.hex, 0.5),
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            fontSize: 10, fontWeight: 800, lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
      {options?.length > 0 && (
        <datalist id={id}>
          {options.map((opt) => <option key={opt} value={opt} />)}
        </datalist>
      )}
    </div>
  );
}

// ── ColumnPicker ────────────────────────────────────────────────────────────

export function ColumnPicker({ columnDefs, visibleCols, onChange, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 8, padding: '8px 0', minWidth: 200, boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), padding: '2px 14px 8px' }}>Columns</p>
      {columnDefs.map((col) => (
        <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 14px', cursor: col.alwaysOn ? 'default' : 'pointer', opacity: col.alwaysOn ? 0.45 : 1 }}>
          <input
            type="checkbox"
            checked={visibleCols.has(col.key)}
            disabled={col.alwaysOn}
            onChange={() => {
              if (col.alwaysOn) return;
              const next = new Set(visibleCols);
              if (next.has(col.key)) next.delete(col.key);
              else next.add(col.key);
              onChange(next);
            }}
            style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13 }}
          />
          <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>{col.label}</span>
        </label>
      ))}
    </div>
  );
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

export const FilterIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export const ColsIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>;
