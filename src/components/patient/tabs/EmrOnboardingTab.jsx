import { useEffect, useState } from 'react';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../../store/careStore.js';
import { updateReferralOptimistic } from '../../../store/mutations.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { attemptTransition, applyTransition } from '../../../engine/transitionEngine.js';

const YELLOW = '#B08900';

function fmtStamp(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function StatusPill({ state, doneLabel, progressLabel = 'In progress', pendingLabel = 'Not started' }) {
  // state: 'done' | 'progress' | 'pending'
  const cfg = state === 'done'
    ? { bg: '#E5F3E4', color: '#2F6B2A', label: doneLabel }
    : state === 'progress'
      ? { bg: hexToRgba(palette.highlightYellow.hex, 0.18), color: YELLOW, label: progressLabel }
      : { bg: hexToRgba(palette.backgroundDark.hex, 0.05), color: hexToRgba(palette.backgroundDark.hex, 0.5), label: pendingLabel };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      borderRadius: 999, padding: '3px 10px',
      background: cfg.bg, color: cfg.color, fontSize: 11.5, fontWeight: 700,
    }}>
      {state === 'done' && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5.5" fill="#2F6B2A" />
          <path d="M3.5 6l2 2 3-3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'progress' && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke={YELLOW} strokeWidth="1.6" />
          <path d="M6 3.2V6l1.9 1.3" stroke={YELLOW} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
      {cfg.label}
    </span>
  );
}

function SectionCard({ title, status, children }) {
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid var(--color-border)`,
      background: '#FFFFFF',
      padding: '14px 16px',
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 750, color: palette.backgroundDark.hex }}>{title}</p>
        {status}
      </div>
      {children}
    </div>
  );
}

function ConfirmBlock({ prompt, detail, error, saving, onConfirm, onCancel, confirmLabel = 'Confirm' }) {
  return (
    <div style={{ borderRadius: 10, background: '#E5F3E4', padding: '10px 11px', marginTop: 10 }}>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px', lineHeight: 1.45 }}>{prompt}</p>
      {detail && <p style={{ fontSize: 12, color: '#3A3545', lineHeight: 1.5, margin: '0 0 10px' }}>{detail}</p>}
      {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, margin: '0 0 6px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
            background: saving ? '#8FBF86' : palette.accentGreen.hex,
            color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650,
            cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
            background: '#E8E6ED', color: '#3A3545',
            fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
        background: disabled ? hexToRgba(palette.accentGreen.hex, 0.4) : palette.accentGreen.hex,
        color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', marginTop: 10,
      }}
    >
      {label}
    </button>
  );
}

/**
 * EMR Onboarding tab — two milestones:
 *   1. Initial EMR Onboarding (HCHB chart created during Intake) — yellow
 *      "in progress" icon on the tab once done.
 *   2. Complete EMR Onboarding (full HCHB onboarding) — green checkmark on
 *      the tab once done. Completing it for a legacy case still sitting in
 *      the EMR Onboarding stage also advances that case to Staffing.
 */
export default function EmrOnboardingTab({ referral, readOnly }) {
  const { can, canAny } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const storeUsers = useCareStore((s) => s.users);

  const [confirming, setConfirming] = useState(null); // 'initial' | 'complete' | null
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setConfirming(null); setSaving(false); setError(null);
  }, [referral?._id]);

  if (!referral) return null;

  const resolveUser = (id) => {
    const u = Object.values(storeUsers || {}).find((x) => x.id === id || x._id === id);
    return u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : null;
  };

  const initialAt = referral.emr_initial_onboarded_at;
  const completeAt = referral.emr_onboarded_at;
  const completeDone = !!completeAt;
  // Complete EMR implies initial — you can't have the full chart without it.
  const initialDone = !!initialAt || completeDone;
  // Initial EMR is an ALF-only milestone (chart must exist before SOC/ROC
  // scheduling). SPN goes straight to Complete EMR. Still show the initial
  // card for a non-ALF case if someone already stamped it (legacy data).
  const showInitial = referral.division === 'ALF' || !!initialAt;

  const canInitial = !readOnly && can(PERMISSION_KEYS.INTAKE_EMR_INITIAL);
  const canComplete = !readOnly && canAny([PERMISSION_KEYS.SCHEDULING_STAFFING, PERMISSION_KEYS.INTAKE_EMR_INITIAL]);

  async function stampInitial() {
    setSaving(true); setError(null);
    try {
      await updateReferralOptimistic(referral._id, {
        emr_initial_onboarded_at: new Date().toISOString(),
        emr_initial_onboarded_by_id: appUserId || 'unknown',
      });
      triggerDataRefresh();
      setConfirming(null);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function stampComplete() {
    setSaving(true); setError(null);
    const now = new Date().toISOString();
    const fields = {
      emr_onboarded_at: now,
      emr_onboarded_by_id: appUserId || 'unknown',
      // Complete implies initial — backfill the stamp when it was skipped so
      // reports and the old UI see a consistent record.
      ...(referral.emr_initial_onboarded_at ? {} : {
        emr_initial_onboarded_at: now,
        emr_initial_onboarded_by_id: appUserId || 'unknown',
      }),
    };
    try {
      if (referral.current_stage === 'EMR Onboarding') {
        // Legacy stage — completing EMR here advances the case to Staffing,
        // same as the old EMR Onboarding module action.
        const result = attemptTransition({
          referral,
          toStage: 'Staffing Feasibility',
          context: {
            note: '[EMR onboarding complete → Staffing Feasibility]',
            actorUserId: appUserId,
            extraFields: fields,
          },
        });
        if (!result.allowed) throw new Error(result.reason || 'Cannot advance to Staffing');
        await applyTransition({ referral, result, context: { actorUserId: appUserId } });
      } else {
        await updateReferralOptimistic(referral._id, fields);
      }
      triggerDataRefresh();
      setConfirming(null);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const stampRow = (at, byId) => (
    <div style={{ fontSize: 12, color: '#3A3545', lineHeight: 1.6 }}>
      <span style={{ fontWeight: 650 }}>Completed:</span> {fmtStamp(at)}
      {byId && resolveUser(byId) && (
        <>
          <br />
          <span style={{ fontWeight: 650 }}>By:</span> {resolveUser(byId)}
        </>
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, margin: '0 0 14px' }}>
        {showInitial
          ? 'Two milestones: create the HCHB chart early during Intake (initial), then finish full EMR onboarding. Visit scheduling requires at least the initial chart.'
          : 'One milestone for Special Needs: mark EMR onboarding complete once the HCHB chart is fully set up.'}
      </p>

      {showInitial && (
      <SectionCard
        title="Initial EMR Onboarding"
        status={<StatusPill state={initialDone ? 'done' : 'pending'} doneLabel="Done" />}
      >
        {initialDone ? stampRow(initialAt || completeAt, referral.emr_initial_onboarded_by_id || referral.emr_onboarded_by_id) : (
          <p style={{ fontSize: 12, color: '#3A3545', lineHeight: 1.5, margin: 0 }}>
            Create the HCHB chart so scheduling can plot the SOC/ROC visit. The patient stays in Intake.
          </p>
        )}
        {!initialDone && canInitial && confirming !== 'initial' && (
          <ActionButton label="Complete initial EMR onboarding" onClick={() => { setConfirming('initial'); setError(null); }} />
        )}
        {!initialDone && confirming === 'initial' && (
          <ConfirmBlock
            prompt="Confirm the HCHB chart is created?"
            detail="This stamps initial EMR done. The patient stays in Intake."
            error={error}
            saving={saving}
            onConfirm={stampInitial}
            onCancel={() => { setConfirming(null); setError(null); }}
          />
        )}
        {!initialDone && !canInitial && (
          <p style={{ fontSize: 11.5, color: '#5A5466', margin: '8px 0 0' }}>
            {readOnly ? 'View only.' : 'You need permission to stamp initial EMR.'}
          </p>
        )}
      </SectionCard>
      )}

      <SectionCard
        title="Complete EMR Onboarding"
        status={<StatusPill state={completeDone ? 'done' : initialDone ? 'progress' : 'pending'} doneLabel="Done" progressLabel="Initial done" />}
      >
        {completeDone ? stampRow(completeAt, referral.emr_onboarded_by_id) : (
          <p style={{ fontSize: 12, color: '#3A3545', lineHeight: 1.5, margin: 0 }}>
            Mark once HCHB onboarding is fully complete (all remaining fields entered).
            {referral.current_stage === 'EMR Onboarding' ? ' This case will advance to Staffing.' : ''}
          </p>
        )}
        {!completeDone && canComplete && confirming !== 'complete' && (
          <ActionButton label="Complete EMR onboarding" onClick={() => { setConfirming('complete'); setError(null); }} />
        )}
        {!completeDone && confirming === 'complete' && (
          <ConfirmBlock
            prompt="Confirm full EMR onboarding is done?"
            detail={referral.current_stage === 'EMR Onboarding'
              ? 'This stamps EMR onboarded and advances the case to Staffing Feasibility.'
              : 'This stamps EMR onboarded. The case stays where it is.'}
            error={error}
            saving={saving}
            onConfirm={stampComplete}
            onCancel={() => { setConfirming(null); setError(null); }}
          />
        )}
        {!completeDone && !canComplete && (
          <p style={{ fontSize: 11.5, color: '#5A5466', margin: '8px 0 0' }}>
            {readOnly ? 'View only.' : 'You need permission to complete EMR onboarding.'}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
