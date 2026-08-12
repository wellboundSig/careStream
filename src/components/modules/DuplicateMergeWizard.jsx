/**
 * Guided merge for CareStream duplicate charts.
 * Steps: pick → combine preview → resolve differences → confirm → run.
 */
import { useEffect, useMemo, useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useCareStore } from '../../store/careStore.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import {
  allConflictsResolved,
  buildMergePlan,
  executeMerge,
  loadMergeContext,
  pickSurvivor,
} from '../../utils/mergeDuplicateReferrals.js';

const STEPS = ['pick', 'combine', 'resolve', 'confirm', 'run'];

function softFill(hex, alpha = 0.06) {
  return hexToRgba(hex, alpha);
}

function displayValue(raw, resolvers, fieldKey) {
  if (raw == null || raw === '') return 'Empty';
  const s = Array.isArray(raw) ? raw.join(', ') : String(raw);
  if (!s.trim()) return 'Empty';
  if (fieldKey === 'referral_source_id') return resolvers.resolveSource?.(s) || s;
  if (fieldKey === 'facility_id') return resolvers.resolveFacility?.(s) || s;
  if (fieldKey === 'physician_id') return resolvers.resolvePhysician?.(s) || s;
  if (fieldKey === 'marketer_id') return resolvers.resolveMarketer?.(s) || s;
  if (fieldKey === 'intake_owner_id') return resolvers.resolveUser?.(s) || s;
  if (fieldKey === 'entity_id') return resolvers.resolveEntity?.(s) || s;
  return s;
}

function ChartCard({ referral, badge, selected, onClick, counts }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        padding: '14px 16px',
        borderRadius: 10,
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        background: selected
          ? softFill(palette.primaryMagenta.hex, 0.1)
          : softFill(palette.backgroundDark.hex, 0.04),
        fontFamily: 'inherit',
        outline: selected ? `2px solid ${palette.primaryMagenta.hex}` : 'none',
        outlineOffset: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {referral.patientName || referral.patient_id}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex }}>
            {referral.current_stage}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            Created {fmtCalendarDate(referral.created_at || referral.referral_date) || 'unknown'}
            {referral.division ? ` · ${referral.division}` : ''}
          </p>
          {counts && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              {counts.files || 0} files · {counts.notes || 0} notes · {counts.insurances || 0} plans
              {counts.hasTriage ? ' · triage' : ''}
            </p>
          )}
        </div>
        {badge && (
          <span style={{
            flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em',
            textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6,
            background: softFill(palette.accentGreen.hex, 0.14),
            color: palette.accentGreen.hex,
          }}>
            {badge}
          </span>
        )}
      </div>
    </button>
  );
}

function StepDots({ step }) {
  const idx = STEPS.indexOf(step);
  const labels = ['Pick', 'Combine', 'Resolve', 'Confirm', 'Run'];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
      {labels.map((label, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <span
            key={label}
            style={{
              fontSize: 11, fontWeight: 650, padding: '4px 9px', borderRadius: 6,
              background: active
                ? softFill(palette.primaryMagenta.hex, 0.12)
                : done
                  ? softFill(palette.accentGreen.hex, 0.12)
                  : softFill(palette.backgroundDark.hex, 0.04),
              color: active
                ? palette.primaryMagenta.hex
                : done
                  ? palette.accentGreen.hex
                  : hexToRgba(palette.backgroundDark.hex, 0.4),
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function DuplicateMergeWizard({
  members = [],
  onClose,
  onMerged,
}) {
  const { appUserId } = useCurrentAppUser();
  const resolvers = useLookups();
  const patientsById = useCareStore((s) => s.patients) || {};

  const enrichedMembers = useMemo(() => members.map((r) => {
    if (r.patient?._id) return r;
    const fromStore = Object.values(patientsById).find(
      (p) => p.id === r.patient_id || p._id === r.patient_id,
    );
    if (!fromStore) return r;
    return { ...r, patient: { ...fromStore, ...(r.patient || {}) } };
  }), [members, patientsById]);

  const [step, setStep] = useState(enrichedMembers.length === 2 ? 'combine' : 'pick');
  const [selectedIds, setSelectedIds] = useState(() => (
    enrichedMembers.length === 2 ? enrichedMembers.map((m) => m._id) : []
  ));
  const [contextByPatientId, setContextByPatientId] = useState({});
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [plan, setPlan] = useState(null);
  const [choices, setChoices] = useState({});
  const [error, setError] = useState('');
  const [runDetail, setRunDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const pair = useMemo(() => {
    if (selectedIds.length !== 2) return null;
    const a = enrichedMembers.find((m) => m._id === selectedIds[0]);
    const b = enrichedMembers.find((m) => m._id === selectedIds[1]);
    if (!a || !b) return null;
    return [a, b];
  }, [enrichedMembers, selectedIds]);

  useEffect(() => {
    if (!pair || (step !== 'combine' && step !== 'resolve' && step !== 'confirm')) return;
    let cancelled = false;
    setLoadingCtx(true);
    setError('');
    loadMergeContext(pair[0], pair[1])
      .then((ctx) => {
        if (cancelled) return;
        setContextByPatientId(ctx);
        try {
          const next = buildMergePlan(pair[0], pair[1], { contextByPatientId: ctx });
          setPlan(next);
          setChoices((prev) => {
            const seeded = { ...prev };
            for (const c of next.conflicts) {
              if (!seeded[c.key]) seeded[c.key] = 'survivor';
            }
            return seeded;
          });
        } catch (err) {
          setError(err?.message || 'Could not build merge plan');
          setPlan(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load chart details');
      })
      .finally(() => {
        if (!cancelled) setLoadingCtx(false);
      });
    return () => { cancelled = true; };
  }, [pair?.[0]?._id, pair?.[1]?._id, step]);

  function togglePick(id) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const conflictsReady = plan ? allConflictsResolved(plan.conflicts, choices) : false;

  async function runMerge() {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    setStep('run');
    setRunDetail('Starting…');
    try {
      const result = await executeMerge({
        survivor: plan.survivor,
        loser: plan.loser,
        choices,
        actorUserId: appUserId,
        onProgress: ({ detail }) => setRunDetail(detail || ''),
      });
      triggerDataRefresh();
      onMerged?.(result.survivor);
    } catch (err) {
      setError(err?.message || 'Merge failed');
      setStep('confirm');
    } finally {
      setBusy(false);
    }
  }

  const previewSurvivor = pair
    ? pickSurvivor(pair[0], pair[1], contextByPatientId).survivor
    : null;

  return (
    <div
      data-testid="duplicate-merge-wizard"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        background: hexToRgba(palette.backgroundDark.hex, 0.45),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div style={{
        width: 'min(720px, 100%)',
        maxHeight: 'min(88vh, 860px)',
        overflow: 'auto',
        borderRadius: 14,
        background: palette.backgroundLight.hex,
        padding: '22px 24px 20px',
        boxShadow: `0 18px 50px ${hexToRgba(palette.backgroundDark.hex, 0.22)}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 750, color: palette.backgroundDark.hex, letterSpacing: '-0.02em' }}>
              Merge duplicate charts
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.45 }}>
              Combine into one referral. Files, notes, and insurance come along. You choose when details differ.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              border: 'none', background: softFill(palette.backgroundDark.hex, 0.06),
              borderRadius: 8, width: 32, height: 32, cursor: busy ? 'not-allowed' : 'pointer',
              fontSize: 18, lineHeight: 1, color: hexToRgba(palette.backgroundDark.hex, 0.5),
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <StepDots step={step} />

        {error && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 8,
            background: softFill(palette.primaryMagenta.hex, 0.1),
            color: palette.primaryMagenta.hex, fontSize: 13, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {step === 'pick' && (
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
              Choose two charts to merge first
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {enrichedMembers.map((m) => {
                const selected = selectedIds.includes(m._id);
                const wouldSurvive = selectedIds.length === 2
                  && previewSurvivor?._id === m._id;
                return (
                  <ChartCard
                    key={m._id}
                    referral={m}
                    selected={selected}
                    badge={wouldSurvive ? 'Keeps stage' : (selected ? 'Selected' : null)}
                    onClick={() => togglePick(m._id)}
                  />
                );
              })}
            </div>
            <FooterNav
              backLabel="Cancel"
              onBack={onClose}
              nextLabel="Continue"
              nextDisabled={selectedIds.length !== 2}
              onNext={() => setStep('combine')}
            />
          </div>
        )}

        {step === 'combine' && (
          <div>
            {loadingCtx || !plan ? (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                Scanning both charts…
              </p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <ChartCard
                    referral={plan.survivor}
                    badge="Keeps stage"
                    counts={contextByPatientId[plan.survivor.patient_id]}
                  />
                  <ChartCard
                    referral={plan.loser}
                    badge="Merges in"
                    counts={contextByPatientId[plan.loser.patient_id]}
                  />
                </div>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>
                  What combines automatically
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {plan.unions.map((u) => (
                    <div
                      key={u.key}
                      style={{
                        padding: '11px 14px', borderRadius: 8,
                        background: softFill(palette.accentGreen.hex, 0.08),
                      }}
                    >
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                        {u.label}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                        {u.survivorCount} + {u.loserCount} → {u.combined} on the kept chart
                      </p>
                    </div>
                  ))}
                  {plan.autoFills.length > 0 && (
                    <div style={{
                      padding: '11px 14px', borderRadius: 8,
                      background: softFill(palette.accentBlue.hex, 0.08),
                    }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                        Empty fields fill from the other chart
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                        {plan.autoFills.length} field{plan.autoFills.length === 1 ? '' : 's'} (name, phone, address, and more when only one side has a value)
                      </p>
                    </div>
                  )}
                </div>
                <FooterNav
                  backLabel={enrichedMembers.length > 2 ? 'Back' : 'Cancel'}
                  onBack={() => (enrichedMembers.length > 2 ? setStep('pick') : onClose?.())}
                  nextLabel={plan.conflicts.length ? 'Resolve differences' : 'Review merge'}
                  onNext={() => setStep(plan.conflicts.length ? 'resolve' : 'confirm')}
                />
              </>
            )}
          </div>
        )}

        {step === 'resolve' && plan && (
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Choose what to keep
            </p>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.4 }}>
              Both charts have a value. Tap the side that should win for each row.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plan.conflicts.map((c) => {
                const picked = choices[c.key];
                return (
                  <div
                    key={c.key}
                    style={{
                      padding: '12px 14px', borderRadius: 10,
                      background: softFill(palette.backgroundDark.hex, 0.035),
                    }}
                  >
                    <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.45), letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {c.label}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {['survivor', 'loser'].map((side) => {
                        const active = picked === side;
                        const val = side === 'survivor' ? c.survivorValue : c.loserValue;
                        const ref = side === 'survivor' ? plan.survivor : plan.loser;
                        return (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setChoices((p) => ({ ...p, [c.key]: side }))}
                            style={{
                              textAlign: 'left', padding: '12px 12px', borderRadius: 8, border: 'none',
                              cursor: 'pointer', fontFamily: 'inherit',
                              background: active
                                ? softFill(palette.accentGreen.hex, 0.16)
                                : softFill(palette.backgroundDark.hex, 0.04),
                              outline: active ? `2px solid ${palette.accentGreen.hex}` : 'none',
                            }}
                          >
                            <span style={{
                              display: 'block', fontSize: 10.5, fontWeight: 700,
                              color: active ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
                              textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4,
                            }}>
                              {active ? 'Keep this' : (side === 'survivor' ? 'Kept chart' : 'Other chart')}
                            </span>
                            <span style={{
                              display: 'block', fontSize: 13.5, fontWeight: 650,
                              color: palette.backgroundDark.hex, wordBreak: 'break-word',
                            }}>
                              {displayValue(val, resolvers, c.key.includes('insurance:') ? '' : c.key)}
                            </span>
                            <span style={{
                              display: 'block', marginTop: 4, fontSize: 11,
                              color: hexToRgba(palette.backgroundDark.hex, 0.4),
                            }}>
                              {ref.patientName?.split(' ')[0] || ref.current_stage}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <FooterNav
              backLabel="Back"
              onBack={() => setStep('combine')}
              nextLabel="Review merge"
              nextDisabled={!conflictsReady}
              onNext={() => setStep('confirm')}
            />
          </div>
        )}

        {step === 'confirm' && plan && (
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Confirm before merging
            </p>
            <ul style={{
              margin: 0, padding: '14px 16px 14px 32px', borderRadius: 10,
              background: softFill(palette.backgroundDark.hex, 0.035),
              fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.55,
            }}>
              <li>
                Kept referral: <strong>{plan.survivor.id || plan.survivor._id}</strong> at{' '}
                <strong>{plan.survivorStage}</strong>
              </li>
              <li>
                Duplicate referral <strong>{plan.loser.id || plan.loser._id}</strong> is discarded
              </li>
              <li>
                Duplicate patient is deactivated
              </li>
              <li>
                Files, notes, and insurance from both charts land on the kept chart
              </li>
              {plan.conflicts.length > 0 && (
                <li>
                  {plan.conflicts.length} difference{plan.conflicts.length === 1 ? '' : 's'} resolved by your choices
                </li>
              )}
            </ul>
            <FooterNav
              backLabel="Back"
              onBack={() => setStep(plan.conflicts.length ? 'resolve' : 'combine')}
              nextLabel="Confirm merge"
              nextPrimary
              onNext={runMerge}
            />
          </div>
        )}

        {step === 'run' && (
          <div style={{ padding: '28px 8px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Merging charts…
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              {runDetail || 'Working'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FooterNav({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled,
  nextPrimary,
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          height: 36, padding: '0 14px', borderRadius: 8, border: 'none',
          background: softFill(palette.backgroundDark.hex, 0.06),
          color: hexToRgba(palette.backgroundDark.hex, 0.6),
          fontSize: 13, fontWeight: 650, cursor: 'pointer',
        }}
      >
        {backLabel}
      </button>
      <button
        type="button"
        disabled={nextDisabled}
        onClick={onNext}
        style={{
          height: 36, padding: '0 16px', borderRadius: 8, border: 'none',
          background: nextDisabled
            ? softFill(palette.backgroundDark.hex, 0.08)
            : (nextPrimary ? palette.accentGreen.hex : palette.primaryMagenta.hex),
          color: nextDisabled
            ? hexToRgba(palette.backgroundDark.hex, 0.35)
            : palette.backgroundLight.hex,
          fontSize: 13, fontWeight: 700, cursor: nextDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {nextLabel}
      </button>
    </div>
  );
}
