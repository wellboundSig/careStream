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
import { useCareStore, mergeEntities, removeEntity } from '../store/careStore.js';
import { upsertClinicalReview, dbToUiFields, uiToDbFields } from '../api/clinicalReviews.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { triggerDataRefresh } from './useRefreshTrigger.js';

const SAVE_DEBOUNCE_MS = 400;

// See useCursoryReview for the rationale — deterministic per-referral temp id
// for the optimistic store mirror until a real Airtable row arrives.
function pendingId(referralRecordId) {
  return `_pending_clinical_${referralRecordId}`;
}

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

  // ── Debounced save ──────────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const inFlightRef  = useRef(false);
  // True while the user has unsaved edits (pending debounce or in-flight save
  // with more queued). While dirty we skip the server-resync effect so a
  // save's own response can't clobber a click that happened mid round-trip —
  // the bug that surfaced as "click again to retry, second click un-checks".
  const dirtyRef = useRef(false);

  // Hard reset when the user switches to a different referral.
  useEffect(() => {
    dirtyRef.current = false;
    setChecked(serverChecked);
    setDecision(serverDecision);
    setAuthRequired(serverAuthRequired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId]);

  // Pick up external / post-save server changes ONLY when the user is idle.
  const serverSignature = useMemo(
    () => JSON.stringify({ c: serverChecked, d: serverDecision, a: serverAuthRequired }),
    [serverChecked, serverDecision, serverAuthRequired],
  );
  useEffect(() => {
    if (dirtyRef.current) return;
    setChecked(serverChecked);
    setDecision(serverDecision);
    setAuthRequired(serverAuthRequired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature]);

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
        if (created.id !== pendingId(referralRecordId)) {
          try { removeEntity('clinicalReviews', pendingId(referralRecordId)); } catch {}
        }
      }
      triggerDataRefresh();
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      // Only clear dirty if nothing new is queued; otherwise the resync effect
      // would clobber the still-pending edits.
      if (!saveTimerRef.current) dirtyRef.current = false;
    }
  }, [referralRecordId, existingRow, appUserId]);

  function scheduleSave(next) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flush(next);
    }, SAVE_DEBOUNCE_MS);
  }

  // Optimistic store mirror — keep every consumer reading from the store
  // (drawer indicators, module panels, other hook instances) in lockstep with
  // the click, not the debounced save. See useCursoryReview for the rationale.
  function mirrorToStore(next) {
    const rowId = existingRow?._id || pendingId(referralRecordId);
    mergeEntities('clinicalReviews', {
      [rowId]: {
        _id: rowId,
        ...(existingRow || {}),
        referral_id: [referralRecordId],
        ...uiToDbFields(next.checked),
        decision: (next.decision === 'accept' || next.decision === 'conditional')
          ? next.decision
          : null,
        auth_required: next.authRequired === true,
      },
    });
  }

  // ── Public mutators ─────────────────────────────────────────────────────
  const toggle = useCallback((uiKey) => {
    if (!referralRecordId) return;
    dirtyRef.current = true;
    setChecked((prev) => {
      const next = { ...prev, [uiKey]: !prev[uiKey] };
      const payload = { checked: next, decision, authRequired };
      mirrorToStore(payload);
      scheduleSave(payload);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, existingRow, decision, authRequired]);

  const updateDecision = useCallback((nextDecision) => {
    if (!referralRecordId) return;
    dirtyRef.current = true;
    setDecision(nextDecision);
    const payload = { checked, decision: nextDecision, authRequired };
    mirrorToStore(payload);
    scheduleSave(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, existingRow, checked, authRequired]);

  const updateAuthRequired = useCallback((nextAuth) => {
    if (!referralRecordId) return;
    dirtyRef.current = true;
    setAuthRequired(nextAuth);
    const payload = { checked, decision, authRequired: nextAuth };
    mirrorToStore(payload);
    scheduleSave(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralRecordId, existingRow, checked, decision]);

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
