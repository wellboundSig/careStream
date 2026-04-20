/**
 * Shared styling helpers for the Eligibility + Authorization workspaces.
 *
 * Design goals:
 * - Solid, non-transparent borders + backgrounds. No tinted haze.
 * - Minimal chrome: fields use existing `--color-border` CSS variable.
 * - Consistent density between the narrow module-page panel and the wider
 *   drawer tab.
 */

import palette, { hexToRgba } from '../../../utils/colors.js';

/** Returns size-aware tokens. */
export function tokens(variant /* 'panel' | 'drawer' */) {
  const isPanel = variant === 'panel';
  return {
    isPanel,
    fontBase:   isPanel ? 12   : 13,
    fontMuted:  isPanel ? 11   : 12,
    fontLabel:  isPanel ? 10.5 : 11.5,
    radius:     isPanel ? 7    : 9,
    cardPadX:   isPanel ? 12   : 14,
    cardPadY:   isPanel ? 10   : 12,
    gap:        isPanel ? 8    : 12,
    inputPadY:  isPanel ? 6    : 7,
    inputPadX:  isPanel ? 8    : 9,
    btnPadY:    isPanel ? 7    : 8,
    sectionGap: isPanel ? 14   : 20,
  };
}

const BORDER = 'var(--color-border)';

export function inputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: `${t.inputPadY}px ${t.inputPadX}px`,
    borderRadius: 6,
    border: `1px solid ${BORDER}`,
    fontSize: t.fontBase,
    fontFamily: 'inherit',
    outline: 'none',
    background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex,
  };
}

export function primaryBtn(t, { disabled, color } = {}) {
  return {
    flex: 2,
    padding: `${t.btnPadY}px 0`,
    borderRadius: 6,
    border: 'none',
    background: disabled ? '#e5e5e5' : (color || palette.accentGreen.hex),
    color: disabled ? '#999' : palette.backgroundLight.hex,
    fontSize: t.fontBase,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export function secondaryBtn(t) {
  return {
    flex: 1,
    padding: `${t.btnPadY}px 0`,
    borderRadius: 6,
    border: `1px solid ${BORDER}`,
    background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex,
    fontSize: t.fontBase,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

export function chipBtn(t, { active, color = palette.accentGreen.hex } = {}) {
  return {
    padding: `${Math.max(4, t.inputPadY - 1)}px ${t.inputPadX + 2}px`,
    borderRadius: 5,
    border: `1px solid ${active ? color : BORDER}`,
    fontSize: t.fontMuted,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? color : palette.backgroundLight.hex,
    color: active ? palette.backgroundLight.hex : palette.backgroundDark.hex,
  };
}

export function smallActionBtn(t, { color, filled = false } = {}) {
  return {
    padding: `${Math.max(4, t.inputPadY - 1)}px ${t.inputPadX + 2}px`,
    borderRadius: 5,
    border: `1px solid ${filled ? color : BORDER}`,
    background: filled ? color : palette.backgroundLight.hex,
    color: filled ? palette.backgroundLight.hex : color,
    fontSize: t.fontMuted,
    fontWeight: 650,
    cursor: 'pointer',
  };
}

export function sectionHeading(t) {
  return {
    fontSize: t.fontLabel,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: palette.backgroundDark.hex,
    opacity: 0.55,
    marginBottom: Math.max(6, t.gap - 4),
  };
}

export function cardStyle(t) {
  return {
    marginBottom: t.gap,
    borderRadius: t.radius,
    border: `1px solid ${BORDER}`,
    background: palette.backgroundLight.hex,
  };
}

// Subtle status-pill palette (solid colors, no rgba)
export const STATUS_PILL_MAP = {
  unreviewed:           { bg: '#EEE',    fg: '#666',        label: 'Unreviewed' },
  confirmed_active:     { bg: '#DCFCE7', fg: '#15803d',     label: 'Active' },
  confirmed_inactive:   { bg: '#E5E5E5', fg: '#666',        label: 'Inactive' },
  denied_not_found:     { bg: '#FEE2E2', fg: '#B91C1C',     label: 'Denied' },
  partial:              { bg: '#FEF3C7', fg: '#92400E',     label: 'Partial' },
  unable_to_verify:     { bg: '#FFEDD5', fg: '#9A3412',     label: 'Unable' },
};

// for legacy lookups/compat
export { hexToRgba, palette };
