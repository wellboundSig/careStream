/**
 * Display labels for New Lead form drafts.
 * Prefer patient name; otherwise draft-NNN-MM-DD-YYYY.
 */

export function draftDisplayName(form, draftNumber, createdAt = new Date()) {
  const first = String(form?.first_name || '').trim();
  const last = String(form?.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full.slice(0, 80);

  const n = Math.max(1, Number(draftNumber) || 1);
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt || Date.now());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `draft-${String(n).padStart(3, '0')}-${mm}-${dd}-${yyyy}`;
}

export function nextDraftNumber(existingDrafts = []) {
  let max = 0;
  for (const row of existingDrafts) {
    const n = Number(row?.fields?.draft_number ?? row?.draft_number ?? 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}
