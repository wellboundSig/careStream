/**
 * Physician display helpers — prefer NPPES credential/title (NP, PA, MD, …)
 * over a hardcoded "Dr." prefix.
 */

/** Normalize NPPES basic.credential into a short title (NP, PA-C, MD, …). */
export function normalizePhysicianTitle(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // Drop periods / extra spaces: "M.D." → "MD", "N.P." → "NP"
  s = s.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Keep hyphenated credentials (NP-C, PA-C); uppercase letter runs
  return s
    .split(/([\s/-]+)/)
    .map((part) => (/^[\s/-]+$/.test(part) ? part : part.toUpperCase()))
    .join('');
}

/**
 * Display name for lists/pickers.
 * With title → "Neidra Walker, NP"
 * Without → "Dr. Jane Doe" (legacy fallback)
 */
export function formatPhysicianName(phy) {
  if (!phy) return '—';
  const first = String(phy.first_name || '').trim();
  const last = String(phy.last_name || '').trim();
  const name = `${first} ${last}`.trim();
  if (!name) return '—';
  const title = normalizePhysicianTitle(phy.title);
  if (title) return `${name}, ${title}`;
  return `Dr. ${name}`;
}
