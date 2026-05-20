import palette, { hexToRgba } from '../../utils/colors.js';

// Source type catalog and color tokens. Lives outside the page component so
// the page and the create/edit modal can share it without circular imports.

export const SOURCE_TYPES = [
  'CCO',
  'Hospital',
  'SNF',
  'PCP / MD',
  'ALF',
  'Adult Home',
  'Care Manager',
  'Self-Referral',
  'Campaign',
  'Other',
];

export const TYPE_COLORS = {
  CCO:             { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), text: palette.primaryDeepPlum.hex },
  Hospital:        { bg: hexToRgba(palette.primaryMagenta.hex, 0.14),  text: palette.primaryMagenta.hex },
  SNF:             { bg: hexToRgba(palette.accentOrange.hex, 0.14),    text: '#8B4A00' },
  'PCP / MD':      { bg: hexToRgba(palette.accentGreen.hex, 0.15),     text: '#2e7d52' },
  ALF:             { bg: hexToRgba(palette.highlightYellow.hex, 0.22), text: '#7A5F00' },
  'Adult Home':    { bg: hexToRgba(palette.accentBlue.hex, 0.12),      text: '#1a5fa8' },
  'Care Manager':  { bg: hexToRgba(palette.accentBlue.hex, 0.14),      text: palette.accentBlue.hex },
  'Self-Referral': { bg: hexToRgba(palette.accentGreen.hex, 0.12),     text: '#2e7d52' },
  Campaign:        { bg: hexToRgba(palette.primaryMagenta.hex, 0.10),  text: palette.primaryMagenta.hex },
  Other:           { bg: hexToRgba(palette.backgroundDark.hex, 0.07),  text: hexToRgba(palette.backgroundDark.hex, 0.55) },
};

// Categories where the source represents an individual (or a generic
// channel) rather than a person inside another company.
export const NO_ENTITY_TYPES = new Set(['Self-Referral', 'Campaign', 'Other']);
