/**
 * Helpers for Airtable `multipleRecordLinks` fields.
 *
 * Airtable expects linked-record fields as ARRAYS of record IDs. Writing a
 * bare string silently produces a validation error. These helpers centralise
 * the conversion so every API module writes consistently.
 *
 * Also handles the read path — linked-record fields come back as arrays of
 * record IDs; `readLink(value)` returns the first id or null.
 */

export function toLinks(idOrIds) {
  if (idOrIds == null || idOrIds === '') return undefined;
  if (Array.isArray(idOrIds)) {
    const clean = idOrIds.filter((x) => typeof x === 'string' && x.trim());
    return clean.length ? clean : undefined;
  }
  return [String(idOrIds)];
}

export function readLink(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

export function readAllLinks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}
