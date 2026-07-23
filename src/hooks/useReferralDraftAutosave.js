import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createReferralDraft,
  updateReferralDraft,
  deleteReferralDraft,
  getReferralDraftsByOwner,
} from '../api/referralDrafts.js';
import { draftDisplayName, nextDraftNumber } from '../utils/referralDraftName.js';

const DEBOUNCE_MS = 700;

/**
 * Autosave New Lead form state into referral_drafts for the current user.
 * Disabled for embedded / inbound convert flows.
 */
export function useReferralDraftAutosave({
  enabled,
  appUserId,
  form,
  dirty,
  initialDraftRecordId = null,
  initialDraftBusinessId = null,
  initialDraftNumber = null,
}) {
  const [draftRecId, setDraftRecId] = useState(initialDraftRecordId);
  const [draftBizId, setDraftBizId] = useState(initialDraftBusinessId);
  const [draftNum, setDraftNum] = useState(initialDraftNumber);
  const [draftCreatedAt, setDraftCreatedAt] = useState(null);
  const [status, setStatus] = useState(initialDraftRecordId ? 'saved' : 'idle'); // idle|saving|saved|error

  const formRef = useRef(form);
  formRef.current = form;
  const draftRecIdRef = useRef(draftRecId);
  draftRecIdRef.current = draftRecId;
  const draftBizIdRef = useRef(draftBizId);
  draftBizIdRef.current = draftBizId;
  const draftNumRef = useRef(draftNum);
  draftNumRef.current = draftNum;
  const draftCreatedAtRef = useRef(draftCreatedAt);
  draftCreatedAtRef.current = draftCreatedAt;
  const creatingRef = useRef(false);
  const discardedRef = useRef(false);
  const timerRef = useRef(null);
  const pendingFlushRef = useRef(null);

  const persist = useCallback(async () => {
    if (!enabled || !appUserId || discardedRef.current) return null;
    const snapshot = formRef.current;
    const name = draftDisplayName(
      snapshot,
      draftNumRef.current || 1,
      draftCreatedAtRef.current || new Date(),
    );
    setStatus('saving');
    try {
      if (!draftRecIdRef.current) {
        if (creatingRef.current) return null;
        creatingRef.current = true;
        try {
          const existing = await getReferralDraftsByOwner(appUserId);
          const num = nextDraftNumber(existing);
          const now = new Date().toISOString();
          const bizId = `dft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const rec = await createReferralDraft({
            id: bizId,
            owner_user_id: appUserId,
            display_name: draftDisplayName(snapshot, num, now),
            draft_number: num,
            form_data: snapshot,
            created_at: now,
            updated_at: now,
          });
          // User may have discarded while create was in flight.
          if (discardedRef.current) {
            try { await deleteReferralDraft(rec.id); } catch { /* ignore */ }
            setStatus('idle');
            return null;
          }
          setDraftRecId(rec.id);
          setDraftBizId(rec.fields?.id || bizId);
          setDraftNum(num);
          setDraftCreatedAt(now);
          draftRecIdRef.current = rec.id;
          draftBizIdRef.current = rec.fields?.id || bizId;
          draftNumRef.current = num;
          draftCreatedAtRef.current = now;
          setStatus('saved');
          return rec;
        } finally {
          creatingRef.current = false;
        }
      }

      await updateReferralDraft(draftRecIdRef.current, {
        form_data: snapshot,
        display_name: name,
        updated_at: new Date().toISOString(),
      });
      setStatus('saved');
      return { id: draftRecIdRef.current };
    } catch (err) {
      console.warn('[referralDraft] autosave failed', err);
      setStatus('error');
      return null;
    }
  }, [enabled, appUserId]);

  const schedulePersist = useCallback(() => {
    if (!enabled || !appUserId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const p = persist();
      pendingFlushRef.current = p;
    }, DEBOUNCE_MS);
  }, [enabled, appUserId, persist]);

  useEffect(() => {
    if (!enabled || !appUserId) return;
    if (!dirty && !draftRecIdRef.current) return;
    schedulePersist();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [form, dirty, enabled, appUserId, schedulePersist]);

  const flushDraftSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingFlushRef.current) {
      try { await pendingFlushRef.current; } catch { /* ignore */ }
    }
    if (!enabled || !appUserId) return;
    if (!dirty && !draftRecIdRef.current) return;
    await persist();
  }, [enabled, appUserId, dirty, persist]);

  const discardDraft = useCallback(async () => {
    discardedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = draftRecIdRef.current;
    if (id) {
      try {
        await deleteReferralDraft(id);
      } catch (err) {
        console.warn('[referralDraft] discard failed', err);
        throw err;
      }
    }
    setDraftRecId(null);
    setDraftBizId(null);
    setDraftNum(null);
    setDraftCreatedAt(null);
    draftRecIdRef.current = null;
    draftBizIdRef.current = null;
    draftNumRef.current = null;
    draftCreatedAtRef.current = null;
    setStatus('idle');
  }, []);

  const deleteDraftQuiet = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = draftRecIdRef.current;
    if (!id) return;
    try {
      await deleteReferralDraft(id);
    } catch (err) {
      console.warn('[referralDraft] post-submit delete failed', err);
    }
    setDraftRecId(null);
    draftRecIdRef.current = null;
    setStatus('idle');
  }, []);

  return {
    draftRecId,
    draftBizId,
    draftNum,
    status,
    flushDraftSave,
    discardDraft,
    deleteDraftQuiet,
    hasActiveDraft: !!draftRecId,
  };
}
