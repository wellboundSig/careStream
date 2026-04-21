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
import { useCareStore, mergeEntities } from '../store/careStore.js';
import { upsertCursoryReview, dbToUiFields, uiToDbFields } from '../api/cursoryReviews.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { triggerDataRefresh } from './useRefreshTrigger.js';

const SAVE_DEBOUNCE_MS = 400;

export function useCursoryReview(referralRecordId) {
  const { appUserId } = useCurrentAppUser();
  const cursoryReviews = useCareStore((s) => s.cursoryReviews);

  // Locate the existing CursoryReview row for this referral.
  const existingRow = useMemo(() => {
    if (!referralRecordId) return null;
    for (const row of Object.values(cursoryReviews || {})) {
      const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
      if (link === referralRecordId) return row;
    }
    return null;
  }, [cursoryReviews, referralRecordId]);

  // Derived UI-keyed checked map.
  const serverChecked = useMemo(() => dbToUiFields(existingRow), [existingRow]);

  // Local working state — seeded from server. Keyed by UI keys, e.g.
  // { f2f_doc_present: true, patient_name_match: false }
  const [checked, setChecked] = useState(serverChecked);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Reset when the referral changes or when the server row updates.
  const serverSignature = useMemo(() => JSON.stringify(serverChecked), [serverChecked]);
  useEffect(() => { setChecked(serverChecked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [referralRecordId, serverSignature]);

  // ── Debounced save ──────────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const inFlightRef  = useRef(false);

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
      }
      triggerDataRefresh();
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  }, [referralRecordId, existingRow, appUserId]);

  function scheduleSave(nextChecked) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flush(nextChecked), SAVE_DEBOUNCE_MS);
  }

  // ── Public toggle ───────────────────────────────────────────────────────
  const toggle = useCallback((uiKey) => {
    if (!referralRecordId) return;
    setChecked((prev) => {
      const next = { ...prev, [uiKey]: !prev[uiKey] };
      scheduleSave(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId]);

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
