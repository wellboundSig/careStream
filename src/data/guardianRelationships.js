/**
 * Allowed relationship values for known guardians ↔ patients.
 * Stored as plain text on patient_guardians.relationship and patient mirrors.
 */
export const GUARDIAN_RELATIONSHIPS = [
  'Father',
  'Mother',
  'Sibling',
  'Spouse',
  'Grandparent',
  'Legal Guardian',
  'Other',
];

/** Map free-text / parenthetical labels → canonical relationship. */
const ALIAS_TO_RELATIONSHIP = {
  father: 'Father',
  dad: 'Father',
  daddy: 'Father',
  papa: 'Father',
  mother: 'Mother',
  mom: 'Mother',
  mum: 'Mother',
  mommy: 'Mother',
  mama: 'Mother',
  sibling: 'Sibling',
  brother: 'Sibling',
  sister: 'Sibling',
  bro: 'Sibling',
  sis: 'Sibling',
  spouse: 'Spouse',
  husband: 'Spouse',
  wife: 'Spouse',
  partner: 'Spouse',
  grandparent: 'Grandparent',
  grandmother: 'Grandparent',
  grandfather: 'Grandparent',
  grandma: 'Grandparent',
  grandpa: 'Grandparent',
  'legal guardian': 'Legal Guardian',
  guardian: 'Legal Guardian',
  'legal gaurdian': 'Legal Guardian', // common misspelling in legacy data
  gaurdian: 'Legal Guardian',
  other: 'Other',
};

/**
 * Normalize a relationship string to a catalog value, or '' if unknown/empty.
 */
export function normalizeGuardianRelationship(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (GUARDIAN_RELATIONSHIPS.includes(s)) return s;
  const hit = ALIAS_TO_RELATIONSHIP[s.toLowerCase()];
  return hit || '';
}

/**
 * Pull a parenthetical role out of a contact name.
 * "John Smith (Father)" → { cleanName: "John Smith", relationship: "Father" }
 * Never inventes a relationship when none is found; cleanName is always set.
 */
export function splitContactNameAndRelationship(rawName) {
  const original = String(rawName || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!original) return { cleanName: '', relationship: '' };

  // Trailing or mid "(Role)" — take the last parenthetical that maps to a relationship
  const re = /\(([^)]+)\)/g;
  let match;
  let lastRel = '';
  let lastFull = '';
  while ((match = re.exec(original)) !== null) {
    const cand = normalizeGuardianRelationship(match[1]);
    if (cand) {
      lastRel = cand;
      lastFull = match[0];
    }
  }

  let cleanName = original;
  if (lastFull) {
    cleanName = original.replace(lastFull, ' ').replace(/\s+/g, ' ').trim();
  }
  // Strip leftover empty parens
  cleanName = cleanName.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

  return { cleanName: cleanName || original, relationship: lastRel };
}
