/**
 * Early-stage duplicate review for CareStream + HCHB.
 * Ignores EMR-onboarded / late-pipeline records — those already belong in HCHB.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { runHchbDupCheck } from '../../api/hchbDupCheck.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { hchbBody, hchbCaseLines, hchbTitle, hchbTone } from '../../utils/hchbDupResult.js';
import DuplicateMergeWizard from './DuplicateMergeWizard.jsx';

/** Stages where duplicate intake still matters. */
export const EARLY_DUP_STAGES = new Set([
  'Lead Entry',
  'Intake',
  'Eligibility Verification',
  'OPWDD Enrollment',
  'Disenrollment Required',
  'F2F/MD Orders Pending',
  'Clinical Intake RN Review',
  'Authorization Pending',
  'Conflict',
  'Hold',
]);

function isEmrOnboarded(r) {
  return !!(r?.emr_onboarded_at || r?.emr_initial_onboarded_at);
}

function isEarlyCandidate(r) {
  if (!r) return false;
  if (isEmrOnboarded(r)) return false;
  return EARLY_DUP_STAGES.has(r.current_stage);
}

function buildIdentityKeys(r) {
  const keys = [];
  const name = (r.patientName || '').trim().toLowerCase();
  const dob = r.patient?.dob || r.dob || '';
  if (name && dob) keys.push(`name:${name}|dob:${dob}`);
  const medicaid = (r.patient?.medicaid_number || '').trim().toLowerCase();
  if (medicaid) keys.push(`medicaid:${medicaid}`);
  const nameOnly = name;
  if (nameOnly && !dob) keys.push(`nameonly:${nameOnly}`);
  return keys;
}

function referralSortTime(r) {
  const t = Date.parse(r.created_at || r.updated_at || r.referral_date || '') || 0;
  return t;
}

function nameParts(r) {
  const patient = r.patient || {};
  const name = String(r.patientName || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    first: patient.first_name || parts[0] || '',
    last: patient.last_name || (parts.length > 1 ? parts[parts.length - 1] : '') || '',
    dob: patient.dob || r.dob || '',
  };
}

/**
 * Groups of early-stage, not-yet-EMR patients sharing name+DOB or Medicaid.
 */
export function findEarlyDuplicateGroups(allReferrals = []) {
  const pool = (allReferrals || []).filter(isEarlyCandidate);
  const seen = {};
  for (const r of pool) {
    for (const key of buildIdentityKeys(r)) {
      if (key.startsWith('nameonly:')) continue; // name-only is weak; use for HCHB, not pipeline groups
      (seen[key] ||= []).push(r);
    }
  }
  const matched = new Map();
  for (const [matchKey, group] of Object.entries(seen)) {
    const uniquePatientIds = [...new Set(group.map((r) => r.patient_id).filter(Boolean))];
    if (uniquePatientIds.length < 2) continue;
    const groupKey = uniquePatientIds.sort().join('|');
    if (matched.has(groupKey)) continue;
    const deduped = [];
    const idsSeen = new Set();
    for (const r of group) {
      if (!r.patient_id || idsSeen.has(r.patient_id)) continue;
      idsSeen.add(r.patient_id);
      deduped.push(r);
    }
    deduped.sort((a, b) => referralSortTime(a) - referralSortTime(b));
    matched.set(groupKey, {
      id: groupKey,
      matchKey,
      matchLabel: matchKey.startsWith('medicaid:') ? 'Medicaid ID' : 'Name + DOB',
      members: deduped,
    });
  }
  return [...matched.values()];
}

function findDuplicateGroupsForPatient(selectedReferral, allReferrals) {
  if (!selectedReferral?.patient_id) return [];
  return findEarlyDuplicateGroups(allReferrals).filter((g) =>
    g.members.some((r) => r.patient_id === selectedReferral.patient_id)
  );
}

const DupIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <rect x="8" y="2" width="13" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M16 18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

function HchbChip({ tone }) {
  if (!tone) return null;
  const map = {
    strong: { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), fg: palette.primaryMagenta.hex, label: 'HCHB active' },
    former: { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), fg: palette.primaryDeepPlum.hex, label: 'HCHB discharged' },
    soft: { bg: hexToRgba(palette.accentOrange.hex, 0.14), fg: palette.accentOrange.hex, label: 'HCHB name' },
    clear: { bg: hexToRgba(palette.accentGreen.hex, 0.12), fg: palette.accentGreen.hex, label: 'Not in HCHB' },
    error: { bg: hexToRgba(palette.backgroundDark.hex, 0.06), fg: hexToRgba(palette.backgroundDark.hex, 0.45), label: 'HCHB n/a' },
  };
  const m = map[tone];
  if (!m) return null;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em',
      padding: '2px 7px', borderRadius: 5, background: m.bg, color: m.fg, flexShrink: 0,
    }}>
      {m.label}
    </span>
  );
}

/**
 * @param {{
 *   selectedReferral: object | null,
 *   allReferrals: object[],
 *   onSelectReferral?: (r: object) => void,
 *   onOpenReferral?: (r: object) => void,
 * }} props
 */
export default function DuplicateChecker({
  selectedReferral,
  allReferrals,
  onSelectReferral,
  onOpenReferral,
}) {
  const { can } = usePermissions();
  const canMerge = can(PERMISSION_KEYS.REFERRAL_MERGE_DUPLICATES);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('pipeline');
  const [sortBy, setSortBy] = useState('count'); // count | name | stage | newest
  const [expandedId, setExpandedId] = useState(null);
  const [hchbManual, setHchbManual] = useState({ first: '', last: '', dob: '' });
  const [hchbBusy, setHchbBusy] = useState(false);
  const [hchbResult, setHchbResult] = useState(null);
  const [hchbError, setHchbError] = useState('');
  const [hchbByPatient, setHchbByPatient] = useState({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [mergeMembers, setMergeMembers] = useState(null);
  const ref = useRef(null);

  const allEarlyGroups = useMemo(
    () => findEarlyDuplicateGroups(allReferrals),
    [allReferrals]
  );

  const selectedGroups = useMemo(
    () => (selectedReferral ? findDuplicateGroupsForPatient(selectedReferral, allReferrals) : []),
    [selectedReferral, allReferrals]
  );

  const sortedGroups = useMemo(() => {
    const list = [...allEarlyGroups];
    list.sort((a, b) => {
      if (sortBy === 'count') return b.members.length - a.members.length;
      if (sortBy === 'newest') {
        const ta = Math.max(...a.members.map(referralSortTime));
        const tb = Math.max(...b.members.map(referralSortTime));
        return tb - ta;
      }
      if (sortBy === 'stage') {
        const sa = a.members[0]?.current_stage || '';
        const sb = b.members[0]?.current_stage || '';
        return sa.localeCompare(sb);
      }
      const na = (a.members[0]?.patientName || '').toLowerCase();
      const nb = (b.members[0]?.patientName || '').toLowerCase();
      return na.localeCompare(nb);
    });
    // Pin groups that include the selected patient
    if (selectedReferral?.patient_id) {
      list.sort((a, b) => {
        const ai = a.members.some((r) => r.patient_id === selectedReferral.patient_id) ? 0 : 1;
        const bi = b.members.some((r) => r.patient_id === selectedReferral.patient_id) ? 0 : 1;
        return ai - bi;
      });
    }
    return list;
  }, [allEarlyGroups, sortBy, selectedReferral?.patient_id]);

  const badgeCount = selectedReferral ? selectedGroups.length : allEarlyGroups.length;

  useEffect(() => {
    if (!open || mergeMembers) return;
    function dismiss(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open, mergeMembers]);

  useEffect(() => {
    if (!selectedReferral) return;
    const p = nameParts(selectedReferral);
    setHchbManual({ first: p.first, last: p.last, dob: p.dob });
    setHchbResult(null);
    setHchbError('');
  }, [selectedReferral?._id]);

  async function runHchb() {
    setHchbBusy(true);
    setHchbError('');
    setHchbResult(null);
    try {
      const result = await runHchbDupCheck({
        first_name: hchbManual.first,
        last_name: hchbManual.last,
        ...(hchbManual.dob ? { dob: hchbManual.dob } : {}),
      });
      setHchbResult(result);
      if (selectedReferral?.patient_id) {
        setHchbByPatient((prev) => ({ ...prev, [selectedReferral.patient_id]: result }));
      }
    } catch (err) {
      setHchbError(err.message || 'HCHB check failed');
    } finally {
      setHchbBusy(false);
    }
  }

  async function runHchbForReferral(r) {
    const p = nameParts(r);
    if (!p.first || !p.last) return;
    try {
      const result = await runHchbDupCheck({
        first_name: p.first,
        last_name: p.last,
        ...(p.dob ? { dob: p.dob } : {}),
      });
      setHchbByPatient((prev) => ({ ...prev, [r.patient_id]: result }));
      return result;
    } catch {
      setHchbByPatient((prev) => ({ ...prev, [r.patient_id]: { ok: false } }));
      return null;
    }
  }

  async function runHchbForGroup(group) {
    setBatchBusy(true);
    try {
      for (const r of group.members) {
        // eslint-disable-next-line no-await-in-loop
        await runHchbForReferral(r);
      }
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Review early-stage duplicate leads (skips EMR-onboarded patients)"
        style={{
          height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
          borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600,
          cursor: 'pointer',
          background: open ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
          color: open ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
          transition: 'all 0.12s',
        }}
      >
        <DupIcon />
        Duplicates
        {badgeCount > 0 && (
          <span style={{
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 5,
            background: open ? hexToRgba(palette.backgroundLight.hex, 0.2) : hexToRgba(palette.primaryMagenta.hex, 0.14),
            color: open ? palette.backgroundLight.hex : palette.primaryMagenta.hex,
            fontSize: 10.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
          width: 460,
          background: palette.backgroundLight.hex,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.18)}, 0 2px 8px ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        }}>
          <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--color-border)' }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex }}>
              Duplicate review
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, lineHeight: 1.4, color: hexToRgba(palette.backgroundDark.hex, 0.48) }}>
              Early pipeline only. EMR-onboarded patients are skipped.
            </p>
            {selectedReferral && (
              <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>
                Selected: {selectedReferral.patientName || selectedReferral.patient_id}
                {selectedGroups.length > 0 && (
                  <span style={{ marginLeft: 6, fontWeight: 650, color: palette.primaryMagenta.hex }}>
                    · {selectedGroups.length} group{selectedGroups.length === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {[
                { id: 'pipeline', label: `CareStream (${allEarlyGroups.length})` },
                { id: 'hchb', label: 'HCHB check' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    height: 26, padding: '0 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                    border: `1px solid ${tab === t.id ? palette.primaryDeepPlum.hex : 'var(--color-border)'}`,
                    background: tab === t.id ? hexToRgba(palette.primaryDeepPlum.hex, 0.1) : 'transparent',
                    color: tab === t.id ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'pipeline' && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Sort</span>
                {[
                  { id: 'count', label: 'Matches' },
                  { id: 'name', label: 'Name' },
                  { id: 'stage', label: 'Stage' },
                  { id: 'newest', label: 'Newest' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSortBy(s.id)}
                    style={{
                      height: 24, padding: '0 8px', borderRadius: 5, fontSize: 11, fontWeight: 650, cursor: 'pointer',
                      border: 'none',
                      background: sortBy === s.id ? hexToRgba(palette.backgroundDark.hex, 0.1) : 'transparent',
                      color: sortBy === s.id ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.45),
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: 360, overflowY: 'auto', padding: '8px 10px 12px' }}>
                {sortedGroups.length === 0 ? (
                  <div style={{ padding: '18px 10px', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: palette.accentGreen.hex }}>
                      No early-stage duplicates
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.4 }}>
                      Matching name + DOB or Medicaid across Lead Entry through Hold (before EMR onboarding).
                    </p>
                  </div>
                ) : (
                  sortedGroups.map((group) => {
                    const expanded = expandedId === group.id;
                    const involvesSelected = selectedReferral
                      && group.members.some((r) => r.patient_id === selectedReferral.patient_id);
                    return (
                      <div
                        key={group.id}
                        style={{
                          marginBottom: 6,
                          borderRadius: 8,
                          border: `1px solid ${involvesSelected
                            ? hexToRgba(palette.primaryMagenta.hex, 0.35)
                            : 'var(--color-border)'}`,
                          background: involvesSelected
                            ? hexToRgba(palette.primaryMagenta.hex, 0.03)
                            : 'transparent',
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : group.id)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '9px 10px', border: 'none', background: 'transparent',
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span style={{
                            fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex,
                            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {group.members[0]?.patientName || 'Unknown'}
                          </span>
                          <span style={{
                            fontSize: 10.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4),
                            flexShrink: 0,
                          }}>
                            {group.matchLabel}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 700, flexShrink: 0,
                            color: palette.primaryMagenta.hex,
                          }}>
                            {group.members.length}
                          </span>
                          <span style={{
                            fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.35),
                            transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s',
                          }}>
                            ›
                          </span>
                        </button>

                        {expanded && (
                          <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--color-border)' }}>
                            <p style={{
                              margin: '8px 0 6px', fontSize: 11, lineHeight: 1.4,
                              color: hexToRgba(palette.backgroundDark.hex, 0.48),
                            }}>
                              {canMerge
                                ? 'Merge into one chart, or open and discard the extra as Duplicate referral.'
                                : 'Keep one chart. Open the other and discard as Duplicate referral. Oldest listed first.'}
                            </p>
                            {canMerge && group.members.length >= 2 && (
                              <button
                                type="button"
                                data-testid="merge-duplicates-btn"
                                onClick={() => setMergeMembers(group.members)}
                                style={{
                                  marginBottom: 8, height: 30, width: '100%', borderRadius: 7, border: 'none',
                                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                  background: palette.primaryMagenta.hex,
                                  color: palette.backgroundLight.hex,
                                }}
                              >
                                Merge these charts
                              </button>
                            )}
                            {group.members.map((r, ri) => {
                              const hchbHit = hchbByPatient[r.patient_id];
                              const tone = hchbTone(hchbHit);
                              const caseLine = hchbCaseLines(hchbHit)[0];
                              const isSelected = selectedReferral?._id === r._id;
                              return (
                                <div
                                  key={r._id || r.patient_id}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 0',
                                    borderTop: ri === 0 ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
                                  }}
                                >
                                  <span style={{
                                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                    background: ri === 0 ? palette.accentGreen.hex : hexToRgba(palette.primaryMagenta.hex, 0.45),
                                  }}
                                    title={ri === 0 ? 'Oldest — often keep' : 'Newer — review for discard'}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                      fontSize: 12.5, fontWeight: isSelected ? 700 : 550,
                                      color: palette.backgroundDark.hex,
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                      {r.patientName || r.patient_id}
                                    </div>
                                    <div style={{
                                      fontSize: 10.5, fontWeight: 600, marginTop: 1,
                                      color: hexToRgba(palette.backgroundDark.hex, 0.4),
                                    }}>
                                      {r.current_stage}
                                      {r.division ? ` · ${r.division}` : ''}
                                      {ri === 0 ? ' · oldest' : ''}
                                    </div>
                                    {caseLine && (
                                      <div style={{
                                        fontSize: 10.5, fontWeight: 650, marginTop: 2,
                                        color: palette.backgroundDark.hex,
                                      }}>
                                        {caseLine}
                                      </div>
                                    )}
                                  </div>
                                  <HchbChip tone={tone} />
                                  <button
                                    type="button"
                                    onClick={() => onSelectReferral?.(r)}
                                    style={miniBtn()}
                                  >
                                    Select
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onOpenReferral?.(r)}
                                    style={miniBtn(true)}
                                  >
                                    Open
                                  </button>
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              disabled={batchBusy}
                              onClick={() => runHchbForGroup(group)}
                              style={{
                                marginTop: 8, height: 28, width: '100%', borderRadius: 6, border: 'none',
                                fontSize: 11.5, fontWeight: 650, cursor: batchBusy ? 'wait' : 'pointer',
                                background: hexToRgba(palette.primaryDeepPlum.hex, 0.1),
                                color: palette.primaryDeepPlum.hex,
                                opacity: batchBusy ? 0.6 : 1,
                              }}
                            >
                              {batchBusy ? 'Checking HCHB…' : 'Check group in HCHB'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === 'hchb' && (
            <div style={{ padding: '12px 14px 14px' }}>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.48), margin: '0 0 10px', lineHeight: 1.45 }}>
                Checks HCHB including discharged patients. Shows the latest episode and discharge date. Does not block.
              </p>
              {!selectedReferral && (
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.42), margin: '0 0 10px' }}>
                  Tip: select a row in the module list to prefill, or type a name below.
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                  First
                  <input
                    value={hchbManual.first}
                    onChange={(e) => setHchbManual((p) => ({ ...p, first: e.target.value }))}
                    style={inputStyle()}
                  />
                </label>
                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                  Last
                  <input
                    value={hchbManual.last}
                    onChange={(e) => setHchbManual((p) => ({ ...p, last: e.target.value }))}
                    style={inputStyle()}
                  />
                </label>
              </div>
              <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 10 }}>
                DOB (optional — stronger match)
                <input
                  type="date"
                  value={hchbManual.dob || ''}
                  onChange={(e) => setHchbManual((p) => ({ ...p, dob: e.target.value }))}
                  style={inputStyle()}
                />
              </label>
              <button
                type="button"
                disabled={hchbBusy || !hchbManual.first.trim() || !hchbManual.last.trim()}
                onClick={runHchb}
                style={{
                  height: 32, width: '100%', borderRadius: 7, border: 'none', fontSize: 12.5, fontWeight: 650,
                  cursor: hchbBusy ? 'wait' : 'pointer',
                  background: palette.primaryDeepPlum.hex, color: palette.backgroundLight.hex,
                  opacity: hchbBusy || !hchbManual.first.trim() || !hchbManual.last.trim() ? 0.5 : 1,
                }}
              >
                {hchbBusy ? 'Checking HCHB…' : 'Check HCHB'}
              </button>
              {hchbError && (
                <p style={{ marginTop: 8, fontSize: 12, color: palette.primaryMagenta.hex }}>{hchbError}</p>
              )}
              {hchbResult && (() => {
                const tone = hchbTone(hchbResult);
                const display = `${hchbManual.first} ${hchbManual.last}`.trim();
                const withDob = !!hchbManual.dob;
                const accent = tone === 'strong'
                  ? palette.primaryMagenta.hex
                  : tone === 'former'
                    ? palette.primaryDeepPlum.hex
                    : tone === 'soft'
                      ? palette.accentOrange.hex
                      : palette.accentGreen.hex;
                const caseLines = hchbCaseLines(hchbResult);
                return (
                  <div
                    data-testid="hchb-dup-result"
                    style={{ marginTop: 12, paddingLeft: 10, borderLeft: `3px solid ${accent}` }}
                  >
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>
                      {hchbTitle(tone, { display, withDob, caseStatus: hchbResult?.hchb_case?.case_status })}
                    </p>
                    <p style={{ margin: '3px 0 0', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.4 }}>
                      {hchbBody(tone, { display, withDob })}
                    </p>
                    {caseLines.map((line) => (
                      <p
                        key={line}
                        data-testid="hchb-dup-case-line"
                        style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.4 }}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {mergeMembers && (
        <DuplicateMergeWizard
          members={mergeMembers}
          onClose={() => setMergeMembers(null)}
          onMerged={(survivor) => {
            setMergeMembers(null);
            setOpen(false);
            if (survivor) onOpenReferral?.(survivor);
          }}
        />
      )}
    </div>
  );
}

function miniBtn(primary) {
  return {
    height: 24, padding: '0 8px', borderRadius: 5, flexShrink: 0,
    border: primary ? 'none' : `1px solid var(--color-border)`,
    background: primary ? palette.primaryDeepPlum.hex : 'transparent',
    color: primary ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
    fontSize: 11, fontWeight: 650, cursor: 'pointer',
  };
}

function inputStyle() {
  return {
    display: 'block', width: '100%', marginTop: 4, height: 30, padding: '0 8px',
    borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12.5,
    boxSizing: 'border-box',
  };
}
