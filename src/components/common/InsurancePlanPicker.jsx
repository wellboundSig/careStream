/**
 * Searchable multi-select checklist of known insurance plans.
 * Parent owns selected[] and toggle/remove/other/details.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { INSURANCE_PLANS, filterInsurancePlans } from '../../data/insurancePlans.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * @param {{
 *   selected: string[],
 *   onToggle: (plan: string) => void,
 *   disabled?: boolean,
 *   triggerLabel?: string,
 * }} props
 */
export default function InsurancePlanPicker({
  selected = [],
  onToggle,
  disabled = false,
  triggerLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dropRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = useMemo(
    () => filterInsurancePlans(query, INSURANCE_PLANS),
    [query],
  );

  useEffect(() => {
    if (!open) return;
    function dismiss(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const label = triggerLabel
    || (selected.length > 0
      ? `${selected.length} plan${selected.length !== 1 ? 's' : ''} selected`
      : 'Select insurance plans…');

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '9px 11px',
          borderRadius: 8,
          border: 'none',
          background: hexToRgba(palette.backgroundDark.hex, 0.05),
          fontSize: 13,
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: selected.length > 0
            ? palette.backgroundDark.hex
            : hexToRgba(palette.backgroundDark.hex, 0.4),
          opacity: disabled ? 0.6 : 1,
          boxSizing: 'border-box',
        }}
      >
        <span>{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          borderRadius: 10,
          background: palette.backgroundLight.hex,
          boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 320,
        }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}` }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search payers…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 7,
                border: 'none',
                background: hexToRgba(palette.backgroundDark.hex, 0.05),
                fontSize: 12.5,
                color: palette.backgroundDark.hex,
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <p style={{
              margin: '6px 2px 0',
              fontSize: 10.5,
              fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.38),
            }}>
              {filtered.length} of {INSURANCE_PLANS.length} payers
            </p>
          </div>

          <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
            {filtered.length === 0 ? (
              <p style={{
                margin: 0,
                padding: '14px 12px',
                fontSize: 12.5,
                color: hexToRgba(palette.backgroundDark.hex, 0.45),
                textAlign: 'center',
              }}>
                No match — use + Other below
              </p>
            ) : (
              filtered.map((plan) => {
                const isSelected = selected.includes(plan);
                return (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => onToggle(plan)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      background: isSelected ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 12.5,
                      color: palette.backgroundDark.hex,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04);
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected
                        ? hexToRgba(palette.primaryMagenta.hex, 0.06)
                        : 'none';
                    }}
                  >
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isSelected ? palette.primaryMagenta.hex : 'none',
                      border: isSelected ? 'none' : `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
                    }}>
                      {isSelected && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke={palette.backgroundLight.hex} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {plan}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
