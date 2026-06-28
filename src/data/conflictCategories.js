// Effective conflict-category resolution.
//
// Conflict categories are admin-managed (Airtable `ConflictCategories`, hydrated
// into `store.conflictCategories`). Until that table is populated, the app falls
// back to the built-in CONFLICT_REASON_OPTIONS so nothing breaks on a fresh
// deployment. The category PICKERS use the effective active list; the validation
// / eligibility-derivation layer still uses the fixed CONFLICT_REASON enum.

import { getStore } from '../store/careStore.js';
import { CONFLICT_REASON_OPTIONS } from './eligibilityEnums.js';

function isActive(c) {
  return c.is_active !== false && c.is_active !== 'false' && c.is_active !== 0 && c.is_active !== '0';
}

function bySortOrder(a, b) {
  return Number(a.sort_order ?? 999) - Number(b.sort_order ?? 999);
}

/**
 * The list of `{ value, label }` options to show in conflict-category pickers.
 * Accepts an optional store slice (for React hooks); defaults to the live store.
 * Falls back to the built-in defaults when no categories are configured.
 */
export function activeConflictCategoryOptions(store) {
  const src = store || getStore();
  const rows = Object.values(src?.conflictCategories || {});
  if (!rows.length) return CONFLICT_REASON_OPTIONS;
  const active = rows.filter(isActive).sort(bySortOrder).map((c) => ({ value: c.value, label: c.label }));
  return active.length ? active : CONFLICT_REASON_OPTIONS;
}

/**
 * Resolve an admin-managed label for a category code, if one exists (active or
 * not, so historical rows still render). Returns null when unknown.
 */
export function managedConflictCategoryLabel(value, store) {
  if (!value) return null;
  const rows = Object.values((store || getStore())?.conflictCategories || {});
  const row = rows.find((c) => c.value === value);
  return row?.label || null;
}

/** Slugify a human label into a stable snake_case category code. */
export function slugifyCategoryValue(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || `category_${Date.now()}`;
}

/** Built-in defaults, shaped as ConflictCategories rows for one-click seeding. */
export function defaultConflictCategoryRows() {
  return CONFLICT_REASON_OPTIONS.map((o, i) => ({
    value: o.value,
    label: o.label,
    sort_order: (i + 1) * 10,
    is_active: true,
  }));
}
