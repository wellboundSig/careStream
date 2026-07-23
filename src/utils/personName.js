/**
 * Person-name normalization for CareStream patients / contacts.
 * Produces clean Title Case while preserving hyphens, apostrophes, and
 * common prefixes (Mc/Mac) and suffixes (Jr, III).
 */

const SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'v', 'vi',
  'md', 'do', 'phd', 'rn', 'np', 'pa', 'dds', 'esq',
]);

/** Particles often left lowercase in formal style — we still Title Case for US intake clarity. */
function capitalizeWord(raw, { preserveAcronyms = false } = {}) {
  if (!raw) return '';
  const w = String(raw);

  // Parenthetical role labels: (Mom) / (DAD)
  const paren = w.match(/^(\()([^)]+)(\))$/);
  if (paren) {
    return `(${capitalizeWord(paren[2], { preserveAcronyms })})`;
  }

  // Facility/org acronyms on emergency contacts (ACPG, ACS, ADMIN) — keep as typed caps.
  // Never use this for patient first/last (JOHN should become John).
  if (preserveAcronyms && /^[A-Z]{2,6}$/.test(w)) return w;

  const lower = w.toLowerCase();
  if (SUFFIXES.has(lower)) {
    if (lower === 'jr' || lower === 'sr') {
      return lower.charAt(0).toUpperCase() + lower.slice(1) + (w.endsWith('.') ? '.' : '');
    }
    return lower.toUpperCase();
  }

  // O'Brien / D'Angelo — capitalize letter after apostrophe
  if (/^[a-zA-Z]['’][a-zA-Z]/.test(w)) {
    return (
      w.charAt(0).toUpperCase()
      + w.charAt(1)
      + w.charAt(2).toUpperCase()
      + w.slice(3).toLowerCase()
    );
  }

  // McDonald / McBride (Mc + letter). Skip bare "Mc".
  // Do not auto-fix "Mac…" — Machado/Mack would become wrong.
  if (/^mc[a-zA-Z]/i.test(w) && w.length > 2) {
    return `Mc${w.charAt(2).toUpperCase()}${w.slice(3).toLowerCase()}`;
  }

  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function normalizeNameString(input, opts) {
  if (input == null) return '';
  let s = String(input)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  // Split on spaces; within each token, preserve hyphens
  return s
    .split(' ')
    .filter(Boolean)
    .map((token) => token.split(/(-)/).map((piece) => (
      piece === '-' ? '-' : capitalizeWord(piece, opts)
    )).join(''))
    .join(' ');
}

/**
 * Normalize a patient first/last (or similar) name part.
 * Empty / whitespace-only → ''.
 */
export function normalizePersonNamePart(input) {
  return normalizeNameString(input, { preserveAcronyms: false });
}

/**
 * Normalize emergency / contact labels. Preserves short ALL-CAPS acronyms
 * (ACPG, ACS, ADMIN) while cleaning person names and whitespace.
 */
export function normalizeContactName(input) {
  return normalizeNameString(input, { preserveAcronyms: true });
}

/**
 * Normalize first + last (and optional middle) for patient create/update.
 */
export function normalizePersonNameFields({ first_name, last_name, middle_name } = {}) {
  const out = {
    first_name: normalizePersonNamePart(first_name),
    last_name: normalizePersonNamePart(last_name),
  };
  if (middle_name !== undefined) {
    out.middle_name = normalizePersonNamePart(middle_name);
  }
  return out;
}
