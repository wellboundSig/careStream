/**
 * Shared hook for the Clinical Intake RN Review checklist.
 *
 * Used by BOTH the patient-drawer Clinical Review tab AND the Clinical RN
 * module right-panel. Both surfaces read from zustand and write via
 * `upsertClinicalReview`, which preserves the one-row-per-referral
 * invariant. Mirrors the pattern of `useCursoryReview` so the two
 * checklist hooks are easy to reason about together.
 *
 * Design notes
 * ------------
 *  - Reads: pulled from `useCareStore.clinicalReviews`; hydrated once on
 *    app boot. No per-component fetch.
 *  - Writes: optimistic + debounced (~400ms). Each toggle updates local
 *    state immediately and schedules a save; rapid clicks coalesce into
 *    a single PATCH.
 *  - Sync: triggers `triggerDataRefresh()` after a successful write so
 *    any other mounted consumer (drawer if the panel wrote, etc.) sees
 *    the update.
 *  - Decision + auth-required state are persisted in the same row as
 *    the checklist. The final immutable decision still lives on
 *    `Referrals.clinical_review_decision` — this hook only persists
 *    the in-flight working state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCareStore, mergeEntities } from '../store/careStore.js';
import { upsertClinicalReview, dbToUiFields } from '../api/clinicalReviews.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { triggerDataRefresh } from './useRefreshTrigger.js';

const SAVE_DEBOUNCE_MS = 400;

export function useClinicalReview(referralRecordId) {
  const { appUserId } = useCurrentAppUser();
  const clinicalReviews = useCareStore((s) => s.clinicalReviews);

  // Locate the existing ClinicalReview row for this referral.
  const existingRow = useMemo(() => {
    if (!referralRecordId) return null;
    for (const row of Object.values(clinicalReviews || {})) {
      const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
      if (link === referralRecordId) return row;
    }
    return null;
  }, [clinicalReviews, referralRecordId]);

  // Derived from server.
  const serverChecked      = useMemo(() => dbToUiFields(existingRow), [existingRow]);
  const serverDecision     = existingRow?.decision || null;
  const serverAuthRequired = existingRow?.auth_required === true;

  // Local working state — seeded from server, debounced back to server on edit.
  const [checked, setChecked]           = useState(serverChecked);
  const [decision, setDecision]         = useState(serverDecision);
  const [authRequired, setAuthRequired] = useState(serverAuthRequired);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState(null);

  // Reset when the referral changes or when the server row updates.
  const serverSignature = useMemo(
    () => JSON.stringify({ c: serverChecked, d: serverDecision, a: serverAuthRequired }),
    [serverChecked, serverDecision, serverAuthRequired],
  );
  useEffect(() => {
    setChecked(serverChecked);
    setDecision(serverDecision);
    setAuthRequired(serverAuthRequired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, serverSignature]);

  // ── Debounced save ──────────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const inFlightRef  = useRef(false);

  const flush = useCallback(async (next) => {
    if (!referralRecordId) return;
    if (inFlightRef.current) return; // overlap guard; next change re-arms
    inFlightRef.current = true;
    setSaving(true); setSaveError(null);
    try {
      const created = await upsertClinicalReview({
        referralRecordId,
        checkedUiKeys: next.checked,
        decision: next.decision,
        authRequired: next.authRequired,
        reviewedBy: appUserId || undefined,
        existingId: existingRow?._id,
      });
      if (created && created.id) {
        mergeEntities('clinicalReviews', {
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

  function scheduleSave(next) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flush(next), SAVE_DEBOUNCE_MS);
  }

  // ── Public mutators ─────────────────────────────────────────────────────
  const toggle = useCallback((uiKey) => {
    if (!referralRecordId) return;
    setChecked((prev) => {
      const next = { ...prev, [uiKey]: !prev[uiKey] };
      scheduleSave({ checked: next, decision, authRequired });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, decision, authRequired]);

  const updateDecision = useCallback((nextDecision) => {
    if (!referralRecordId) return;
    setDecision(nextDecision);
    scheduleSave({ checked, decision: nextDecision, authRequired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, checked, authRequired]);

  const updateAuthRequired = useCallback((nextAuth) => {
    if (!referralRecordId) return;
    setAuthRequired(nextAuth);
    scheduleSave({ checked, decision, authRequired: nextAuth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, checked, decision]);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    await flush({ checked, decision, authRequired });
  }, [flush, checked, decision, authRequired]);

  // Flush on unmount if there are unsaved changes.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      // Best-effort fire-and-forget.
      flush({ checked, decision, authRequired });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    checked,
    decision,
    authRequired,
    toggle,
    setDecision: updateDecision,
    setAuthRequired: updateAuthRequired,
    saveNow,
    saving,
    saveError,
    reviewedBy: existingRow?.reviewed_by || null,
  };
}
