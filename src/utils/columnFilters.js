/** Column filter values are string[] (multi-select). Legacy strings still parse. */

export function selectedFilterValues(val) {
  if (Array.isArray(val)) {
    return val.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  const s = String(val ?? '').trim();
  return s ? [s] : [];
}

export function filterIsActive(val) {
  return selectedFilterValues(val).length > 0;
}

export function filtersAreActive(colFilters) {
  return Object.values(colFilters || {}).some(filterIsActive);
}

export function cellMatchesFilter(cellVal, val) {
  const selected = selectedFilterValues(val);
  if (!selected.length) return true;
  const cell = String(cellVal ?? '').trim().toLowerCase();
  return selected.some((s) => {
    const q = s.toLowerCase();
    return cell === q || cell.includes(q);
  });
}

export function matchesYesNoFilter(isYes, val) {
  const selected = selectedFilterValues(val).map((s) => s.toLowerCase());
  if (!selected.length) return true;
  const wantsYes = selected.some((v) => v === 'yes' || v === 'y' || v === 'true');
  const wantsNo = selected.some((v) => v === 'no' || v === 'n' || v === 'false');
  if (wantsYes && wantsNo) return true;
  if (wantsYes) return !!isYes;
  if (wantsNo) return !isYes;
  return true;
}

export function matchesNumericFilter(dayCount, val) {
  const selected = selectedFilterValues(val);
  if (!selected.length) return true;
  if (!Number.isFinite(dayCount)) return false;
  return selected.some((s) => Number(s) === dayCount);
}

/** Borderless toolbar chip — active = color only, no fill or outline. */
export function ghostToolbarBtnStyle(active, { height = 32 } = {}) {
  return {
    height,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 7,
    border: 'none',
    background: 'transparent',
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    color: active ? undefined : undefined,
    cursor: 'pointer',
    flexShrink: 0,
  };
}
