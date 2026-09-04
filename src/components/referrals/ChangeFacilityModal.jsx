/**
 * Change facility + reconcile marketer / COC nurse / entity / address.
 * Requires referral.change_facility.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { changeFacility } from '../../utils/changeFacility.js';
import {
  buildFacilityReconciliation,
  rowNeedsDecision,
  unresolvedDecisionKeys,
} from '../../utils/facilityReconciliation.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function SearchSelect({ value, onChange, options, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const selected = options.find((o) => o.value === value) || null;

  useEffect(() => {
    if (!open) return;
    function dismiss(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label || ''} ${o.sublabel || ''}`.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8,
          border: `1px solid var(--color-border)`, fontSize: 13.5,
          color: selected ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
          background: palette.backgroundLight.hex, fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', minWidth: 0 }}>
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected?.label || placeholder || 'Select…'}
          </span>
          {selected?.sublabel && (
            <span style={{ display: 'block', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {selected.sublabel}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
          borderRadius: 10, background: palette.backgroundLight.hex,
          boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 8px 6px', borderBottom: `1px solid var(--color-border)` }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search facilities…"
              style={{
                width: '100%', padding: '7px 9px', borderRadius: 7, border: 'none',
                background: hexToRgba(palette.backgroundDark.hex, 0.05),
                fontSize: 12.5, color: palette.backgroundDark.hex,
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.length === 0 ? (
              <p style={{ padding: '10px 12px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), fontStyle: 'italic', margin: 0 }}>
                No matches
              </p>
            ) : filtered.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => { if (opt.disabled) return; onChange(opt.value); setOpen(false); setQuery(''); }}
                  style={{
                    width: '100%', padding: '8px 12px', display: 'block',
                    background: isSelected ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'none',
                    border: 'none', cursor: opt.disabled ? 'default' : 'pointer', textAlign: 'left',
                    fontSize: 12.5, color: opt.disabled
                      ? hexToRgba(palette.backgroundDark.hex, 0.35)
                      : palette.backgroundDark.hex,
                    opacity: opt.disabled ? 0.7 : 1,
                  }}
                >
                  <span style={{ display: 'block', fontWeight: isSelected ? 650 : 500 }}>
                    {opt.label}{opt.disabled ? ' (current)' : ''}
                  </span>
                  {opt.sublabel && (
                    <span style={{ display: 'block', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                      {opt.sublabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Radio({ name, checked, onChange, disabled, children }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, cursor: disabled ? 'default' : 'pointer',
      fontSize: 12.5, lineHeight: 1.4, color: palette.backgroundDark.hex,
    }}>
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginTop: 2 }}
      />
      <span>{children}</span>
    </label>
  );
}

function statusCopy(status) {
  if (status === 'match') return { text: 'Already matches the new facility', color: palette.accentGreen.hex };
  if (status === 'conflict') return { text: 'Different from the new facility default — choose one', color: palette.accentOrange.hex };
  if (status === 'adopt_only') return { text: 'Currently unassigned — decide whether to adopt the facility default', color: palette.accentBlue.hex };
  if (status === 'keep_only') return { text: 'New facility has no default — current assignment can be kept', color: hexToRgba(palette.backgroundDark.hex, 0.45) };
  if (status === 'pick') return { text: 'New facility has more than one COC nurse — pick who stays assigned', color: palette.accentOrange.hex };
  return { text: 'No facility default', color: hexToRgba(palette.backgroundDark.hex, 0.4) };
}

export default function ChangeFacilityModal({
  referral,
  patient,
  patientName,
  onDone,
  onCancel,
}) {
  const storeNetFacs = useCareStore((s) => s.networkFacilities);
  const storeMarketerFacs = useCareStore((s) => s.marketerFacilities);
  const storeCocNurseFacs = useCareStore((s) => s.cocNurseFacilities);
  const storeMarketers = useCareStore((s) => s.marketers);
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveFacility, resolveMarketer, resolveUser, resolveEntity } = useLookups();

  const currentId = String(referral?.facility_id || '').trim();
  const currentLabel = currentId
    ? (resolveFacility(currentId) !== '—' ? resolveFacility(currentId) : currentId)
    : 'Unassigned';

  // Same catalog as New Lead: NetworkFacilities only. The legacy Facilities
  // table is the External Facilities directory and often repeats these names
  // under different ids — mixing the two made Amber Court (and others) appear
  // two or three times. Every referral.facility_id already points at network ids.
  const facilities = useMemo(() => {
    return Object.values(storeNetFacs || {})
      .filter((f) => String(f.id || '').trim())
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [storeNetFacs]);

  const [facilityId, setFacilityId] = useState('');
  const [decisions, setDecisions] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedFacility = facilities.find((f) => String(f.id || '').trim() === facilityId) || null;

  const preview = useMemo(() => {
    if (!selectedFacility) return null;
    return buildFacilityReconciliation({
      referral,
      patient,
      newFacility: selectedFacility,
      marketerFacilities: storeMarketerFacs,
      cocNurseFacilities: storeCocNurseFacs,
    });
  }, [selectedFacility, referral, patient, storeMarketerFacs, storeCocNurseFacs]);

  useEffect(() => {
    setDecisions({});
    setError(null);
  }, [facilityId]);

  const unresolved = preview ? unresolvedDecisionKeys(preview, decisions) : [];
  const canSubmit = !!facilityId && facilityId !== currentId && unresolved.length === 0 && !saving;

  function setDecision(key, patch) {
    setDecisions((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  function labelFor(row, value) {
    if (!value) return '—';
    if (row.key === 'marketer') {
      const name = resolveMarketer(value);
      return name !== '—' ? name : value;
    }
    if (row.key === 'coc_nurse') {
      const name = resolveUser(value);
      return name !== '—' ? name : value;
    }
    if (row.key === 'entity') {
      const name = resolveEntity(value);
      return name !== '—' ? name : value;
    }
    return value;
  }

  async function handleConfirm() {
    if (!canSubmit || !preview) return;
    setSaving(true);
    setError(null);
    try {
      const nextMarketerId = decisions.marketer?.action === 'adopt'
        ? preview.rows.find((r) => r.key === 'marketer')?.suggestedValue
        : decisions.marketer?.action === 'custom'
          ? decisions.marketer.value
          : null;
      const nextCocId = decisions.coc_nurse?.action === 'adopt'
        ? preview.rows.find((r) => r.key === 'coc_nurse')?.suggestedValue
        : decisions.coc_nurse?.action === 'custom'
          ? decisions.coc_nurse.value
          : null;
      const marketerRec = nextMarketerId
        ? Object.values(storeMarketers || {}).find((m) => String(m.id || '').trim() === String(nextMarketerId).trim())
        : null;

      const { fields, patientFields } = await changeFacility({
        referral,
        patient,
        preview,
        decisions,
        actorUserId: appUserId,
        actorName: appUserName,
        previousFacilityName: currentLabel,
        newFacilityName: selectedFacility?.name || facilityId,
        newMarketerUserId: marketerRec?.user_id || null,
        newCocNurseUserId: nextCocId || null,
        patientLabel: patientName || referral?.patientName || referral?.patient_id,
      });
      onDone?.({ fields, patientFields });
    } catch (err) {
      setError(err?.message || 'Failed to change facility');
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && !saving && onCancel?.()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Change facility</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4, lineHeight: 1.4 }}>
            {patientName || referral?.patientName || referral?.patient_id || 'Patient'}
            {' · '}Current facility: <strong style={{ fontWeight: 650 }}>{currentLabel}</strong>
          </p>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              New facility
            </span>
            <SearchSelect
              value={facilityId}
              onChange={setFacilityId}
              disabled={saving}
              placeholder="Select facility…"
              options={facilities.map((f) => {
                const id = String(f.id || '').trim();
                return {
                  value: id,
                  label: f.name || id,
                  sublabel: f.region || '',
                  disabled: id === currentId,
                };
              })}
            />
          </label>

          {preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Reconcile assignments
              </p>
              <p style={{ margin: 0, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.4 }}>
                Nothing is overwritten automatically. Where the new facility differs, pick keep, adopt, or another person on that facility.
              </p>
              {preview.rows.map((row) => {
                const tone = statusCopy(row.status);
                const decision = decisions[row.key] || {};
                const needs = rowNeedsDecision(row);
                return (
                  <div
                    key={row.key}
                    style={{
                      border: `1px solid ${needs && !decision.action
                        ? hexToRgba(palette.accentOrange.hex, 0.45)
                        : 'var(--color-border)'}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                      background: needs && !decision.action
                        ? hexToRgba(palette.accentOrange.hex, 0.04)
                        : hexToRgba(palette.backgroundDark.hex, 0.015),
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>{row.label}</p>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: tone.color }}>{tone.text}</p>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4 }}>
                      Current: <strong style={{ color: palette.backgroundDark.hex }}>{labelFor(row, row.currentValue)}</strong>
                      {row.suggestedValue ? (
                        <>
                          {' · '}Facility default: <strong style={{ color: palette.backgroundDark.hex }}>{labelFor(row, row.suggestedValue)}</strong>
                        </>
                      ) : row.status !== 'match' ? (
                        <> · Facility default: none</>
                      ) : null}
                    </p>

                    {row.status === 'match' ? null : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {row.currentValue && (
                          <Radio
                            name={`fac-recon-${row.key}`}
                            checked={decision.action === 'keep'}
                            disabled={saving}
                            onChange={() => setDecision(row.key, { action: 'keep' })}
                          >
                            Keep current
                          </Radio>
                        )}
                        {row.suggestedValue && (
                          <Radio
                            name={`fac-recon-${row.key}`}
                            checked={decision.action === 'adopt'}
                            disabled={saving}
                            onChange={() => setDecision(row.key, { action: 'adopt' })}
                          >
                            Use facility default
                          </Radio>
                        )}
                        {row.candidates.length > 1 && (
                          <div>
                            <Radio
                              name={`fac-recon-${row.key}`}
                              checked={decision.action === 'custom'}
                              disabled={saving}
                              onChange={() => setDecision(row.key, { action: 'custom', value: decision.value || '' })}
                            >
                              Assign someone linked to this facility
                            </Radio>
                            {decision.action === 'custom' && (
                              <select
                                value={decision.value || ''}
                                disabled={saving}
                                onChange={(e) => setDecision(row.key, { action: 'custom', value: e.target.value })}
                                style={{
                                  marginTop: 6, marginLeft: 22, width: 'calc(100% - 22px)',
                                  padding: '7px 10px', borderRadius: 7,
                                  border: `1px solid var(--color-border)`, fontSize: 12.5,
                                  fontFamily: 'inherit',
                                }}
                              >
                                <option value="">Select…</option>
                                {row.candidates.map((id) => (
                                  <option key={id} value={id}>{labelFor(row, id)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                        {row.key !== 'address' && row.status === 'keep_only' && (
                          <Radio
                            name={`fac-recon-${row.key}`}
                            checked={decision.action === 'clear'}
                            disabled={saving}
                            onChange={() => setDecision(row.key, { action: 'clear' })}
                          >
                            Clear assignment
                          </Radio>
                        )}
                        {row.status === 'adopt_only' && !row.currentValue && (
                          <Radio
                            name={`fac-recon-${row.key}`}
                            checked={decision.action === 'keep'}
                            disabled={saving}
                            onChange={() => setDecision(row.key, { action: 'keep' })}
                          >
                            Leave unassigned
                          </Radio>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, lineHeight: 1.4 }}>
            This writes a timeline event and an audit log entry. The original lead submitter and intake owner are not changed.
          </p>

          {error && (
            <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex, margin: 0 }}>{error}</p>
          )}
        </div>

        <div style={{
          padding: '14px 22px', borderTop: `1px solid var(--color-border)`,
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid var(--color-border)`,
              background: 'none', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              color: hexToRgba(palette.backgroundDark.hex, 0.55),
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.12),
              color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.35),
              fontSize: 13, fontWeight: 650, cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : unresolved.length ? `Choose ${unresolved.length} more` : 'Change facility'}
          </button>
        </div>
      </div>
    </div>
  );
}
