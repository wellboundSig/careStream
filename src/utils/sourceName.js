/**
 * Normalize referral-source person / label names.
 * Blocks bare dashes / em-dashes and strips other special characters so free
 * text can't land in referral_source_id and display as "—" in the UI.
 */

const DASH_CHARS = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g; // hyphen-ish unicode
const ALLOWED = /[^a-zA-Z0-9\s.&/'()-]/g;

/**
 * @param {string} raw
 * @returns {string} cleaned name, or '' if nothing usable remains
 */
export function sanitizeSourceName(raw) {
  let s = String(raw || '')
    .replace(DASH_CHARS, '-')
    .replace(ALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, '');

  // Reject names that are only punctuation / dashes / too short.
  if (!s || /^[-.\s]+$/.test(s) || s.length < 2) return '';
  return s.slice(0, 80);
}

/** True when a value looks like a directory source business id. */
export function isSourceBusinessId(value) {
  return typeof value === 'string' && /^src[_a-zA-Z0-9]+$/i.test(value.trim());
}

/**
 * Short labels (person / facility / campaign) belong in the directory.
 * Longer free-text notes should not become source rows — use Unknown + note.
 */
export function isPlausibleSourceLabel(name) {
  const s = sanitizeSourceName(name);
  if (!s) return false;
  const words = s.split(/\s+/).filter(Boolean);
  return s.length <= 40 && words.length <= 6;
}

export const UNKNOWN_SOURCE_ID = 'src_unknown';
