import palette, { hexToRgba } from '../../utils/colors.js';

// Source type catalog and color tokens. Lives outside the page component so
// the page and the create/edit modal can share it without circular imports.

export const SOURCE_TYPES = [
  'CCO',
  'Hospital',
  'SNF',
  'LHCSA',
  'CHHA',
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
  LHCSA:           { bg: hexToRgba(palette.accentOrange.hex, 0.12),    text: '#9a3412' },
  CHHA:            { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.10), text: '#5b21b6' },
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
// LHCSA / CHHA always require a company/entity name.
export const NO_ENTITY_TYPES = new Set(['Self-Referral', 'Campaign', 'Other']);

/**
 * How a referral reached us — not who referred.
 * Stored optionally on ReferralSources (default) and on Referrals (stamp).
 * Blank / leave-blank is always allowed.
 */
export const REFERRAL_METHODS = [
  'Word of Mouth',
  'Facebook Ads',
  'Patient Self-Referral',
  'Website',
  'Fax',
  'Email',
  'Call-In',
  'Allscripts',
  'Readmit',
  'Other',
];

/** Map messy historical labels → canonical method (or null). */
export function normalizeReferralMethod(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (REFERRAL_METHODS.includes(s)) return s;
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    'word of mouth': 'Word of Mouth',
    'wom': 'Word of Mouth',
    'call-in / word of mouth': 'Word of Mouth',
    'call in / word of mouth': 'Word of Mouth',
    'facebook': 'Facebook Ads',
    'facebook ad': 'Facebook Ads',
    'facebook ads': 'Facebook Ads',
    'fb ads': 'Facebook Ads',
    'self referral': 'Patient Self-Referral',
    'self-referral': 'Patient Self-Referral',
    'patient self referral': 'Patient Self-Referral',
    'patient self-referral': 'Patient Self-Referral',
    'web': 'Website',
    'website': 'Website',
    'web lead': 'Website',
    'fax': 'Fax',
    'email': 'Email',
    'e-mail': 'Email',
    'wellbound email submission': 'Email',
    'call-in': 'Call-In',
    'call in': 'Call-In',
    'allscripts': 'Allscripts',
    'readmit': 'Readmit',
    're-admit': 'Readmit',
    'roc': 'Readmit',
  };
  return aliases[key] || '';
}
