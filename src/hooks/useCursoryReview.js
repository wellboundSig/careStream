/**
 * Shared hook for the F2F Cursory Review checklist.
 *
 * Powers BOTH the patient-drawer F2F tab AND the F2F module-page right panel.
 * Both surfaces read from zustand (hydrated once on app boot) and write via
 * `upsertCursoryReview`, which preserves the one-row-per-referral invariant.
 *
 * Design notes
 * ------------
 *  - Reads: selected out of `useCareStore.cursoryReviews` for the current
 *    referral record id. No per-component fetch — hydration already loaded
 *    the whole table.
 *  - Writes: optimistic + debounced. We update the store immediately on
 *    each toggle so the UI feels instant, and flush to Airtable at most
 *    once every ~400ms of inactivity so rapid clicking doesn't fire a
 *    request per check.
 *  - Sync: after a successful write we call `triggerDataRefresh()` so any
 *    other mounted consumer (e.g. the module panel if the drawer wrote)
 *    sees the update.
 *  - All audit-sensitive fields (reviewed_by, referral_id) are written
 *    server-side via `upsertCursoryReview`. Never rely on optimistic state
 *    alone for audit-critical assertions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCareStore, mergeEntities, removeEntity } from '../store/careStore.js';
import { upsertCursoryReview, dbToUiFields, uiToDbFields } from '../api/cursoryReviews.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { triggerDataRefresh } from './useRefreshTrigger.js';

const SAVE_DEBOUNCE_MS = 400;

// Stable id for the optimistic store mirror when no Airtable row exists yet.
// Using a deterministic per-referral id means subsequent toggles update the
// SAME store entry instead of producing duplicates.
function pendingId(referralRecordId) {
  return `_pending_cursory_${referralRecordId}`;
}

export function useCursoryReview(referralRecordId) {
  const { appUserId } = useCurrentAppUser();
  const cursoryReviews = useCareStore((s) => s.cursoryReviews);

  // Collect EVERY CursoryReview row for this referral. The table is meant to
  // hold one row per referral, but rapid checkbox toggling historically raced
  // upsert into creating several partial-snapshot rows. We tolerate that here
  // so a stray incomplete row can never hide a finished review.
  const matchingRows = useMemo(() => {
    if (!referralRecordId) return [];
    const rows = [];
    for (const row of Object.values(cursoryReviews || {})) {
      const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
      if (link === referralRecordId) rows.push(row);
    }
    return rows;
  }, [cursoryReviews, referralRecordId]);

  // Canonical row = the oldest (lowest created_at, else stable record id).
  // upsert writes/heals against this one so duplicates collapse over time.
  const existingRow = useMemo(() => {
    if (matchingRows.length === 0) return null;
    return [...matchingRows].sort((a, b) => {
      const at = new Date(a.created_at || 0).getTime();
      const bt = new Date(b.created_at || 0).getTime();
      if (at !== bt) return at - bt;
      return String(a._id).localeCompare(String(b._id));
    })[0];
  }, [matchingRows]);

  // Source of truth = the canonical (oldest) row ONLY. We deliberately do NOT
  // union across duplicate rows: unioning resurrected unchecked boxes (a stale
  // duplicate still holding `true` would override an uncheck, so removing a
  // check appeared to "revert" on navigate-away-and-back). Duplicates are
  // healed by `upsert` and pruned from the store after each save (see flush).
  const serverChecked = useMemo(() => (existingRow ? dbToUiFields(existingRow) : {}), [existingRow]);

  // Local working state — seeded from server. Keyed by UI keys, e.g.
  // { f2f_doc_present: true, patient_name_match: false }
  const [checked, setChecked] = useState(serverChecked);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── Debounced save ──────────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const inFlightRef  = useRef(false);
  // True from the moment a user toggles until BOTH (a) any pending debounce
  // has fired and (b) the in-flight save has completed with no further edits
  // queued. While dirty we treat LOCAL state as the source of truth and skip
  // the server re-sync below — otherwise a save's own response would race
  // back through mergeEntities and stomp the user's most recent click, which
  // surfaces as the "click again to retry, second click un-checks" glitch.
  const dirtyRef = useRef(false);

  // Hard reset when the user switches to a different referral. New context,
  // no in-flight edits apply.
  useEffect(() => {
    dirtyRef.current = false;
    setChecked(serverChecked);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId]);

  // Pick up external / post-save server changes ONLY when the user is idle.
  // If the user has unsaved local work, skip — their click wins.
  const serverSignature = useMemo(() => JSON.stringify(serverChecked), [serverChecked]);
  useEffect(() => {
    if (dirtyRef.current) return;
    setChecked(serverChecked);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature]);

  const flush = useCallback(async (nextChecked) => {
    if (!referralRecordId) return;
    if (inFlightRef.current) return; // prevent overlap; next toggle will re-arm
    inFlightRef.current = true;
    setSaving(true); setSaveError(null);
    try {
      const created = await upsertCursoryReview({
        referralRecordId,
        checkedUiKeys: nextChecked,
        reviewedBy: appUserId || undefined,
        existingId: existingRow?._id,
      });
      if (created && created.id) {
        mergeEntities('cursoryReviews', {
          [created.id]: { _id: created.id, ...created.fields },
        });
        // Prune the temp mirror AND any stale duplicate rows for this referral
        // from the store. `upsert` already deleted the duplicates in Airtable;
        // dropping them locally too is what makes an uncheck stick — otherwise
        // the canonical-row read could still see a lingering `true`.
        const store = useCareStore.getState().cursoryReviews || {};
        for (const [rid, row] of Object.entries(store)) {
          if (rid === created.id) continue;
          const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
          if (link === referralRecordId || rid === pendingId(referralRecordId)) {
            try { removeEntity('cursoryReviews', rid); } catch {}
          }
        }
      }
      triggerDataRefresh();
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      // Only clear dirty when there's nothing else queued. If the user
      // toggled again during the round-trip, saveTimerRef will be set and
      // we stay dirty so the resync effect doesn't clobber that newer click.
      if (!saveTimerRef.current) dirtyRef.current = false;
    }
  }, [referralRecordId, existingRow, appUserId]);

  function scheduleSave(nextChecked) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flush(nextChecked);
    }, SAVE_DEBOUNCE_MS);
  }

  // ── Public toggle ───────────────────────────────────────────────────────
  const toggle = useCallback((uiKey) => {
    if (!referralRecordId) return;
    dirtyRef.current = true;
    setChecked((prev) => {
      const next = { ...prev, [uiKey]: !prev[uiKey] };
      // Optimistic store mirror: every consumer that reads cursoryReviews
      // from the store (PatientDrawer's green-check, the Intake panel's
      // Push-to-Clinical-RN gate, the F2F module panel) sees the click
      // immediately, not after the ~400ms debounce + network round-trip.
      const rowId = existingRow?._id || pendingId(referralRecordId);
      mergeEntities('cursoryReviews', {
        [rowId]: {
          _id: rowId,
          ...(existingRow || {}),
          referral_id: [referralRecordId],
          ...uiToDbFields(next),
        },
      });
      scheduleSave(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, existingRow]);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    await flush(checked);
  }, [flush, checked]);

  // Flush on unmount if there are unsaved changes.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      // Best-effort fire-and-forget — do not block unmount.
      flush(checked);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    checked,
    toggle,
    saveNow,
    saving,
    saveError,
    reviewedBy: existingRow?.reviewed_by || null,
    // Exposed for debugging / explicit writes
    _fieldsForAirtable: uiToDbFields(checked),
  };
}
