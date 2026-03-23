import { useState, useEffect } from 'react';
import ICD10Lookup from '../clinical/ICD10Lookup.jsx';
import CliniciansPanel from '../staffing/CliniciansPanel.jsx';
import ZipSearchPanel from '../staffing/ZipSearchPanel.jsx';
import RadarPanel from '../staffing/RadarPanel.jsx';
import { getChecksByPatient, createInsuranceCheck } from '../../api/insuranceChecks.js';
import { getAuthorizationsByReferral, createAuthorization, updateAuthorization } from '../../api/authorizations.js';
import { getConflictsByReferral } from '../../api/conflicts.js';
import { updateReferral } from '../../api/referrals.js';
import { createEpisode } from '../../api/episodes.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import { recordTransition } from '../../utils/recordTransition.js';
import { generateEmrPacket } from '../../utils/generateEmrPacket.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { useLookups } from '../../hooks/useLookups.js';
import { CHECK_FLAGS, CHECK_SOURCES, MEDICARE_OPTIONS, MEDICAID_OPTIONS, COMMERCIAL_PLANS, buildCheckFields, EMPTY_CHECK_FORM } from '../../data/eligibilityConfig.js';
import { exportToExcel } from '../../utils/reportEngine.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const PIPELINE_STAGES = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC', 'SOC Scheduled',
];

// Shared panel wrapper ────────────────────────────────────────────────────────
function Panel({ children, width = 280 }) {
  return (
    <div style={{
      width, minWidth: width, borderLeft: `1px solid var(--color-border)`,
      background: hexToRgba(palette.backgroundDark.hex, 0.015),
      overflowY: 'auto', flexShrink: 0, padding: '16px 14px',
    }}>
      {children}
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: highlight || palette.backgroundDark.hex }}>{value || '—'}</span>
    </div>
  );
}

function ActionBtn({ label, variant = 'default', onClick, disabled = false }) {
  // forward = large primary CTA (one per panel), success = small green confirm,
  // warning = yellow caution, danger = orange negative, default = grey utility
  const styles = {
    forward:  { bg: palette.accentGreen.hex,                              color: palette.backgroundLight.hex,   pad: '11px 14px', size: 13.5,  weight: 700 },
    success:  { bg: hexToRgba(palette.accentGreen.hex, 0.13),             color: palette.accentGreen.hex,        pad: '8px 12px',  size: 12.5,  weight: 650 },
    warning:  { bg: palette.highlightYellow.hex,                          color: palette.backgroundDark.hex,     pad: '8px 12px',  size: 12.5,  weight: 650 },
    danger:   { bg: palette.accentOrange.hex,                             color: palette.backgroundLight.hex,    pad: '8px 12px',  size: 12.5,  weight: 650 },
    default:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),          color: hexToRgba(palette.backgroundDark.hex, 0.65), pad: '7px 12px', size: 12, weight: 600 },
    // legacy aliases kept for any inline callers
    primary:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),          color: hexToRgba(palette.backgroundDark.hex, 0.65), pad: '7px 12px', size: 12, weight: 600 },
  };
  const s = styles[variant] || styles.default;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: s.pad, borderRadius: 8,
        fontSize: s.size, fontWeight: s.weight,
        cursor: disabled ? 'not-allowed' : 'pointer', marginBottom: 6,
        background: s.bg, color: s.color, border: 'none',
        textAlign: 'left', transition: 'filter 0.12s',
        opacity: disabled ? 0.45 : 1,
        letterSpacing: variant === 'forward' ? '-0.01em' : 'normal',
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = 'brightness(1.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {label}
    </button>
  );
}

function CheckItem({ label, done, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 12.5, color: done ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex }}>
      <input type="checkbox" checked={!!done} onChange={(e) => onChange?.(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0 }} />
      <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
    </label>
  );
}

// Collapsible checklist — default closed, never gates any action button
function CollapsibleChecklist({ title, items, doneMap, onToggle }) {
  const [open, setOpen] = useState(false);
  const count = items.filter((i) => !!doneMap[i.key]).length;
  const pct   = items.length > 0 ? Math.round((count / items.length) * 100) : 0;
  const allDone = pct === 100;
  const barColor = allDone ? palette.accentGreen.hex : pct > 50 ? palette.highlightYellow.hex : palette.accentOrange.hex;
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: hexToRgba(palette.backgroundDark.hex, 0.04),
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.07))}
        onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04))}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{title}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {count}/{items.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 40, height: 3, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.1), overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4.5l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.4)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      {open && (
        <div style={{ padding: '6px 4px 0' }}>
          {items.map((item) => (
            <CheckItem key={item.key} label={item.label} done={!!doneMap[item.key]} onChange={() => onToggle(item.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyPanelState({ message }) {
  return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center', paddingTop: 24 }}>{message || 'Select a patient to see details.'}</p>;
}

// ── 1. Lead Entry ─────────────────────────────────────────────────────────────
function LeadEntryPanel({ referrals, resolveSource, onNewReferral }) {
  const [duplicates, setDuplicates] = useState([]);
  const [dupChecked, setDupChecked] = useState(false);

  const today = referrals.filter((r) => {
    const d = new Date(r.referral_date);
    return Date.now() - d.getTime() < 86400000;
  }).length;
  const thisWeek = referrals.filter((r) => {
    const d = new Date(r.referral_date);
    return Date.now() - d.getTime() < 7 * 86400000;
  }).length;

  function checkDuplicates() {
    const seen = {};
    referrals.forEach((r) => {
      const name = (r.patientName || r.patient_id || '').toLowerCase().trim();
      if (!name) return;
      seen[name] = (seen[name] || 0) + 1;
    });
    const dups = referrals.filter((r) => {
      const name = (r.patientName || r.patient_id || '').toLowerCase().trim();
      return seen[name] > 1;
    });
    setDuplicates(dups);
    setDupChecked(true);
  }

  return (
    <Panel>
      <PanelSection title="Intake Stats">
        <InfoRow label="Today" value={today} highlight={today > 0 ? palette.primaryMagenta.hex : null} />
        <InfoRow label="This week" value={thisWeek} />
        <InfoRow label="Total in queue" value={referrals.length} />
      </PanelSection>

      <PanelSection title="Quick Actions">
        <ActionBtn label="+ New Referral"   variant="forward"  onClick={onNewReferral} />
        <ActionBtn label="Check Duplicates" variant="default"  onClick={checkDuplicates} />
      </PanelSection>

      {dupChecked && (
        <PanelSection title="Duplicate Check">
          {duplicates.length === 0 ? (
            <p style={{ fontSize: 12.5, color: palette.accentGreen.hex, fontWeight: 600 }}>No duplicates found.</p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 650, marginBottom: 8 }}>
                {duplicates.length} potential duplicate{duplicates.length !== 1 ? 's' : ''} detected:
              </p>
              {duplicates.map((r) => (
                <div key={r._id} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: hexToRgba(palette.primaryMagenta.hex, 0.07), marginBottom: 4, color: palette.backgroundDark.hex }}>
                  {r.patientName || r.patient_id}
                </div>
              ))}
            </>
          )}
        </PanelSection>
      )}

      <PanelSection title="Source Breakdown">
        {(() => {
          const counts = {};
          referrals.forEach((r) => {
            const raw = r.referral_source_id || 'Unknown';
            const label = resolveSource ? resolveSource(raw) : raw;
            counts[label] = (counts[label] || 0) + 1;
          });
          const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
          return sorted.length === 0
            ? <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No data yet.</p>
            : sorted.slice(0, 7).map(([label, n]) => (
                <InfoRow key={label} label={label} value={n} />
              ));
        })()}
      </PanelSection>
    </Panel>
  );
}

// ── 2. Intake ─────────────────────────────────────────────────────────────────
const INTAKE_DEMO_FIELDS = [
  { key: 'first_name',      label: 'First name' },
  { key: 'last_name',       label: 'Last name' },
  { key: 'dob',             label: 'Date of birth' },
  { key: 'phone_primary',   label: 'Primary phone' },
  { key: 'address_street',  label: 'Street address' },
  { key: 'medicaid_number', label: 'Medicaid number' },
];

function IntakePanel({ referrals, selectedReferral, onOpenTriage, onInitiateTransition }) {
  const p = selectedReferral?.patient;
  const doneMap = Object.fromEntries(INTAKE_DEMO_FIELDS.map(({ key }) => [key, !!(p?.[key])]));
  const isSN = selectedReferral?.division === 'Special Needs';

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Demographics">
            <CollapsibleChecklist
              title="Basic fields"
              items={INTAKE_DEMO_FIELDS}
              doneMap={doneMap}
              onToggle={() => {}}
            />
          </PanelSection>

          <PanelSection title="Actions">
            <ActionBtn
              label="Continue to Eligibility Verification →"
              variant="forward"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Eligibility Verification')}
            />
            {isSN && (
              <ActionBtn
                label="Open Triage Form"
                variant="default"
                onClick={() => onOpenTriage?.(selectedReferral)}
              />
            )}
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 3. Eligibility ────────────────────────────────────────────────────────────

function FlagRow({ label, value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
      {readOnly ? (
        <span style={{ fontSize: 11.5, fontWeight: 650, color: value === true || value === 'true' ? palette.primaryMagenta.hex : value === false || value === 'false' ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>
          {value === true || value === 'true' ? 'Yes' : value === false || value === 'false' ? 'No' : '—'}
        </span>
      ) : (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ fontSize: 11.5, padding: '2px 6px', borderRadius: 5, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontFamily: 'inherit', cursor: 'pointer' }}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )}
    </div>
  );
}

function FormField({ label, children, style }) {
  return (
    <div style={{ marginBottom: 8, ...style }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4, letterSpacing: '0.02em' }}>{label}</p>
      {children}
    </div>
  );
}

function PanelSelect({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', background: palette.backgroundLight.hex, cursor: 'pointer', outline: 'none' }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function EligibilityPanel({ referrals, selectedReferral }) {
  const { appUserId, appUserName } = useCurrentAppUser();
  const { can: canPerm } = usePermissions();
  const { resolveUser } = useLookups();
  const [lastCheck, setLastCheck] = useState(null);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_CHECK_FORM });
  const [flagValues, setFlagValues] = useState({});
  const isSN = selectedReferral?.division === 'Special Needs';

  useEffect(() => {
    if (!selectedReferral?.patient_id) { setLastCheck(null); setShowForm(false); return; }
    setLoadingCheck(true);
    getChecksByPatient(selectedReferral.patient_id)
      .then((recs) => {
        const sorted = recs.map((r) => ({ _id: r.id, ...r.fields }))
          .sort((a, b) => new Date(b.check_date || 0) - new Date(a.check_date || 0));
        setLastCheck(sorted[0] || null);
      })
      .catch(() => {})
      .finally(() => setLoadingCheck(false));
  }, [selectedReferral?.patient_id]);

  function openForm() {
    setFlagValues({});
    setForm({ ...EMPTY_CHECK_FORM });
    setSaveError(null);
    setShowForm(true);
  }

  async function submitCheck() {
    setSaving(true);
    setSaveError(null);
    try {
      const fields = buildCheckFields({
        referralId: selectedReferral.id,
        patientId: selectedReferral.patient_id,
        authorId: appUserId,
        form,
        flagValues,
        isSN,
      });
      const created = await createInsuranceCheck(fields);
      setLastCheck({ _id: created.id, ...created.fields });
      setShowForm(false);
    } catch (err) {
      console.error('Check save failed', err);
      setSaveError(err.message || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const checkedByName = lastCheck?.checked_by_id ? resolveUser(lastCheck.checked_by_id) : null;

  return (
    <Panel>
      {!selectedReferral ? (
        <>
          <PanelSection title="Queue Summary">
            <InfoRow label="Total in queue" value={referrals.length} />
          </PanelSection>
          <EmptyPanelState message="Select a patient to log or view their eligibility check." />
        </>
      ) : (
        <>
          {/* Last check */}
          {loadingCheck ? (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '8px 0' }}>Loading last check…</p>
          ) : lastCheck ? (
            <PanelSection title="Last Check">
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{checkedByName || lastCheck.checked_by_id}</span>
                  <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>·</span>
                  <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{lastCheck.check_source}</span>
                </div>
                {lastCheck.check_date && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
                    {new Date(lastCheck.check_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' at '}
                    {new Date(lastCheck.check_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
                {/* Show Medicare/Medicaid info from result_summary prefix lines */}
                {lastCheck.result_summary && lastCheck.result_summary.split('\n').filter((l) => l.startsWith('Medicare:') || l.startsWith('Medicaid:')).map((line, i) => {
                  const [label, ...rest] = line.split(': ');
                  const val = rest.join(': ');
                  const isMgd = val.includes('Managed') || val.includes('MCO') || val.includes('Advantage');
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 650, color: val.includes('Not enrolled') ? hexToRgba(palette.backgroundDark.hex, 0.35) : isMgd ? palette.accentOrange.hex : palette.accentBlue.hex }}>{val}</span>
                    </div>
                  );
                })}
                {lastCheck.managed_care_plan && (
                  <InfoRow label="Plan" value={lastCheck.managed_care_plan} />
                )}
                {lastCheck.managed_care_id && (
                  <InfoRow label="Exception Code" value={lastCheck.managed_care_id} />
                )}
                {CHECK_FLAGS.filter((f) => lastCheck[f.key] !== undefined && lastCheck[f.key] !== null).map((f) => (
                  <FlagRow key={f.key} label={f.label} value={lastCheck[f.key]} readOnly />
                ))}
                {/* Show user notes portion of summary (non-structured lines) */}
                {lastCheck.result_summary && (() => {
                  const userNotes = lastCheck.result_summary.split('\n').filter((l) => !l.startsWith('Medicare:') && !l.startsWith('Medicaid:') && !l.startsWith('Plan:') && !l.startsWith('Exception Code:')).join('\n').trim();
                  return userNotes ? <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>{userNotes}</p> : null;
                })()}
              </div>
              {canPerm(PERMISSION_KEYS.CLINICAL_ELIGIBILITY) && <ActionBtn label="Log New Check" variant="default" onClick={openForm} />}
            </PanelSection>
          ) : (
            <PanelSection title="Eligibility">
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 10 }}>No check on record.</p>
              {canPerm(PERMISSION_KEYS.CLINICAL_ELIGIBILITY) && <ActionBtn label="Log Eligibility Check →" variant="forward" onClick={openForm} />}
            </PanelSection>
          )}

          {/* Inline check form */}
          {showForm && (
            <PanelSection title="New Manual Check">
              <FormField label="Source">
                <PanelSelect value={form.check_source} onChange={(v) => setForm((p) => ({ ...p, check_source: v }))} options={CHECK_SOURCES} />
              </FormField>

              <FormField label="Third Party / Commercial Plan">
                <PanelSelect
                  value={form.managed_care_plan}
                  onChange={(v) => setForm((p) => ({ ...p, managed_care_plan: v }))}
                  options={COMMERCIAL_PLANS}
                  placeholder="— None / Not applicable —"
                />
              </FormField>

              <FormField label="Medicare Coverage">
                <select
                  value={form.medicare_type}
                  onChange={(e) => setForm((p) => ({ ...p, medicare_type: e.target.value }))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', background: form.medicare_type === 'ffs' ? hexToRgba(palette.accentBlue.hex, 0.08) : form.medicare_type === 'advantage' ? hexToRgba(palette.accentOrange.hex, 0.08) : form.medicare_type === 'none' ? hexToRgba(palette.backgroundDark.hex, 0.05) : palette.backgroundLight.hex, cursor: 'pointer', outline: 'none', fontWeight: form.medicare_type ? 600 : 400 }}
                  onFocus={(e) => (e.target.style.outline = `2px solid ${palette.primaryMagenta.hex}`)}
                  onBlur={(e) => (e.target.style.outline = 'none')}
                >
                  {MEDICARE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>

              <FormField label="Medicaid Coverage">
                <select
                  value={form.medicaid_type}
                  onChange={(e) => setForm((p) => ({ ...p, medicaid_type: e.target.value }))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', background: form.medicaid_type === 'ffs' ? hexToRgba(palette.accentBlue.hex, 0.08) : form.medicaid_type === 'mco' ? hexToRgba(palette.accentOrange.hex, 0.08) : form.medicaid_type === 'none' ? hexToRgba(palette.backgroundDark.hex, 0.05) : palette.backgroundLight.hex, cursor: 'pointer', outline: 'none', fontWeight: form.medicaid_type ? 600 : 400 }}
                  onFocus={(e) => (e.target.style.outline = `2px solid ${palette.primaryMagenta.hex}`)}
                  onBlur={(e) => (e.target.style.outline = 'none')}
                >
                  {MEDICAID_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>

              {isSN && (
                <FormField label="Exception Code (SN / Medicaid)">
                  <input
                    type="text"
                    value={form.exception_code}
                    onChange={(e) => setForm((p) => ({ ...p, exception_code: e.target.value }))}
                    placeholder="e.g. 9, 88, 0A…"
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03) }}
                    onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
                    onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
                  />
                </FormField>
              )}

              <div style={{ marginTop: 4 }}>
                {CHECK_FLAGS.map((f) => (
                  <FlagRow key={f.key} label={f.label} value={flagValues[f.key] || ''} onChange={(v) => setFlagValues((p) => ({ ...p, [f.key]: v }))} />
                ))}
              </div>

              <FormField label="Notes / Summary" style={{ marginTop: 8 }}>
                <textarea
                  value={form.result_summary}
                  onChange={(e) => setForm((p) => ({ ...p, result_summary: e.target.value }))}
                  placeholder="Any findings or observations…"
                  rows={3}
                  style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03) }}
                  onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
                  onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
                />
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4 }}>Logged by {appUserName}</p>
              </FormField>

              {saveError && (
                <p style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, marginTop: 8, padding: '6px 9px', borderRadius: 6, background: hexToRgba(palette.primaryMagenta.hex, 0.07) }}>
                  {saveError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '7px 0', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
                <button onClick={submitCheck} disabled={saving} style={{ flex: 2, padding: '7px 0', borderRadius: 7, background: palette.accentGreen.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : 'Save Check'}
                </button>
              </div>
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 4. Disenrollment ─────────────────────────────────────────────────────────
const DISEN_CHECKLIST = [
  { key: 'contacted_agency',    label: 'Contacted current agency' },
  { key: 'discharge_confirmed', label: 'Discharge date confirmed' },
  { key: 'medicaid_updated',    label: 'Medicaid notified / updated' },
  { key: 'eligibility_clear',   label: 'Eligibility clear post-discharge' },
];

function DisenrollmentPanel({ selectedReferral, onInitiateTransition }) {
  const [checks, setChecks] = useState({});

  useEffect(() => {
    if (!selectedReferral?._id) { setChecks({}); return; }
    const saved = localStorage.getItem(`disen_${selectedReferral._id}`);
    setChecks(saved ? JSON.parse(saved) : {});
  }, [selectedReferral?._id]);

  function toggle(k) {
    setChecks((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      if (selectedReferral?._id) {
        localStorage.setItem(`disen_${selectedReferral._id}`, JSON.stringify(next));
      }
      return next;
    });
  }

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Discharge Steps">
            <CollapsibleChecklist
              title="Disenrollment checklist"
              items={DISEN_CHECKLIST}
              doneMap={checks}
              onToggle={toggle}
            />
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn
              label="Discharge Confirmed → Eligibility Verification"
              variant="forward"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Eligibility Verification')}
            />
            <ActionBtn
              label="Escalate to Conflict"
              variant="warning"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Conflict')}
            />
            <ActionBtn
              label="Move to NTUC"
              variant="danger"
              onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 5. F2F/MD Orders Pending ──────────────────────────────────────────────────
function F2FPanel({ referrals, selectedReferral, onOpenFiles, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate]     = useState('');
  const [saving, setSaving]                 = useState(false);
  const [saveError, setSaveError]           = useState(null);

  // Reset form when patient selection changes
  useEffect(() => {
    setShowDatePicker(false);
    setReceivedDate('');
    setSaveError(null);
  }, [selectedReferral?._id]);

  function daysLeft(exp) {
    if (!exp) return null;
    return Math.ceil((new Date(exp) - Date.now()) / 86400000);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  async function handleLogReceived() {
    if (!receivedDate || !selectedReferral) return;
    setSaving(true);
    setSaveError(null);
    try {
      const expiration = addDays(receivedDate, 90);
      await updateReferral(selectedReferral._id, {
        f2f_date:       receivedDate,
        f2f_expiration: expiration,
      });
      triggerDataRefresh();
      setShowDatePicker(false);
      setReceivedDate('');
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  const ref  = selectedReferral;
  const days = ref ? daysLeft(ref.f2f_expiration) : null;
  const urgencyColor = days === null
    ? null
    : days < 0  ? palette.primaryMagenta.hex
    : days <= 7  ? palette.primaryMagenta.hex
    : days <= 14 ? palette.accentOrange.hex
    : days <= 30 ? palette.highlightYellow.hex
    : palette.accentGreen.hex;

  return (
    <Panel>
      <PanelSection title="Queue Overview">
        <InfoRow label="Expired F2F"   value={referrals.filter((r) => r.f2f_urgency === 'Expired').length} highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <7d"  value={referrals.filter((r) => r.f2f_urgency === 'Red').length}     highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <14d" value={referrals.filter((r) => r.f2f_urgency === 'Orange').length}  highlight={palette.accentOrange.hex} />
        <InfoRow label="No F2F yet"    value={referrals.filter((r) => !r.f2f_date).length} />
      </PanelSection>

      {ref && (
        <>
          <PanelSection title="F2F Status">
            {days !== null ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: urgencyColor, lineHeight: 1 }}>
                  {days < 0 ? 'EXPIRED' : `${days}d`}
                </p>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>
                  {days < 0 ? 'F2F has expired' : 'until F2F expiration'}
                </p>
                {ref.f2f_date && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 3 }}>
                    Received {new Date(ref.f2f_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' · '}
                    Expires {new Date(ref.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>
                No F2F date recorded
              </p>
            )}
            <InfoRow label="PECOS Verified" value={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? 'Yes' : 'No'} highlight={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
            <InfoRow label="OPRA Verified"  value={ref.is_opra_verified  === 'TRUE' || ref.is_opra_verified  === true ? 'Yes' : 'No'} />
          </PanelSection>

          <PanelSection title="Actions">

            {/* ── Log F2F / MD Orders Received ── */}
            {!canPerm(PERMISSION_KEYS.CLINICAL_F2F) ? null : !showDatePicker ? (
              <button
                onClick={() => {
                  // Pre-fill with existing date if available so the user just confirms
                  if (ref.f2f_date) {
                    setReceivedDate(new Date(ref.f2f_date).toISOString().split('T')[0]);
                  }
                  setShowDatePicker(true);
                }}
                style={{
                  width: '100%', padding: '8px 0', marginBottom: 8,
                  borderRadius: 7, border: 'none',
                  background: ref.f2f_date
                    ? hexToRgba(palette.accentGreen.hex, 0.1)
                    : palette.accentGreen.hex,
                  color: ref.f2f_date
                    ? palette.accentGreen.hex
                    : palette.backgroundLight.hex,
                  fontSize: 12, fontWeight: 650, cursor: 'pointer',
                  transition: 'filter 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(0.93)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                {ref.f2f_date ? '↺ Update F2F / MD Orders Date' : '✓ F2F / MD Orders Received'}
              </button>
            ) : (
              <div style={{
                borderRadius: 8,
                border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
                background: hexToRgba(palette.accentGreen.hex, 0.04),
                padding: '10px 11px', marginBottom: 8,
              }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                  {ref.f2f_date ? 'Confirm or update F2F received date' : 'Date documents were received'}
                </p>
                <input
                  type="date"
                  value={receivedDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '6px 9px', borderRadius: 7, marginBottom: 7,
                    border: `1px solid ${receivedDate ? palette.accentGreen.hex : 'var(--color-border)'}`,
                    fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
                    background: palette.backgroundLight.hex,
                    color: palette.backgroundDark.hex,
                  }}
                />
                {receivedDate && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 8 }}>
                    Clock starts {new Date(receivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' — '}
                    expires <strong style={{ color: palette.accentOrange.hex }}>
                      {new Date(addDays(receivedDate, 90)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </strong>
                  </p>
                )}
                {saveError && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{saveError}</p>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleLogReceived}
                    disabled={!receivedDate || saving}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: receivedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: receivedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                      fontSize: 11.5, fontWeight: 650, cursor: receivedDate && !saving ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {saving ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setShowDatePicker(false); setReceivedDate(''); setSaveError(null); }}
                    disabled={saving}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: hexToRgba(palette.backgroundDark.hex, 0.55),
                      fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <ActionBtn
              label="Confirm → Clinical Intake RN Review"
              variant="forward"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Clinical Intake RN Review')}
            />
            <ActionBtn
              label="Upload F2F Document"
              variant="default"
              onClick={() => onOpenFiles?.(selectedReferral)}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

function ApproveButton({ enabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const DESTINATIONS = [
    { label: 'Authorization Pending', sub: 'Managed care / auth required', stage: 'Authorization Pending' },
    { label: 'Staffing Feasibility',  sub: 'No auth needed — go straight to staffing', stage: 'Staffing Feasibility' },
  ];
  return (
    <div style={{ position: 'relative', marginBottom: 6 }}>
      <button
        onClick={() => enabled && setOpen((o) => !o)}
        disabled={!enabled}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
          background: enabled ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
          color: enabled ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
          fontSize: 13.5, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed',
          textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          transition: 'filter 0.12s', letterSpacing: '-0.01em',
        }}
        onMouseEnter={(e) => enabled && (e.currentTarget.style.filter = 'brightness(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
      >
        {enabled ? 'Approve — send to…' : 'Review F2F / MD orders first'}
        {enabled && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 9, overflow: 'hidden', boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
          {DESTINATIONS.map((d) => (
            <button
              key={d.stage}
              onClick={() => { setOpen(false); onSelect(d.stage); }}
              style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.07))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{d.label}</p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{d.sub}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 6. Clinical Intake RN Review ──────────────────────────────────────────────
function ClinicalRNPanel({ selectedReferral, onOpenTriage, onOpenFiles, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [f2fReviewed, setF2fReviewed] = useState(false);
  const [icdCodes, setIcdCodes] = useState([]);

  const allDone = f2fReviewed;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Review">
            <CheckItem
              label="F2F / MD orders reviewed"
              done={f2fReviewed}
              onChange={() => setF2fReviewed((v) => !v)}
            />
          </PanelSection>

          <PanelSection title="ICD-10 Lookup">
            <ICD10Lookup compact onSelect={setIcdCodes} />
            {icdCodes.length > 0 && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 6 }}>
                {icdCodes.length} code{icdCodes.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </PanelSection>

          {canPerm(PERMISSION_KEYS.CLINICAL_RN_REVIEW) && (
          <PanelSection title="Decision">
            <ApproveButton
              enabled={allDone}
              onSelect={(dest) => onInitiateTransition?.(selectedReferral, dest)}
            />
            <ActionBtn label="Escalate to Conflict" variant="warning"  onClick={() => onInitiateTransition?.(selectedReferral, 'Conflict')} />
            {canPerm(PERMISSION_KEYS.REFERRAL_HOLD) && <ActionBtn label="Place on Hold" variant="warning" onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')} />}
            {canPerm(PERMISSION_KEYS.REFERRAL_NTUC) && <ActionBtn label="Mark NTUC" variant="danger" onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')} />}
          </PanelSection>
          )}

          <PanelSection title="Documents">
            <ActionBtn label="Open Triage Form"     variant="default"  onClick={() => onOpenTriage?.(selectedReferral)} />
            <ActionBtn label="View F2F / MD Orders" variant="default"  onClick={() => onOpenFiles?.(selectedReferral)} />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 7. Authorization Pending ──────────────────────────────────────────────────
const AUTH_SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];

function AuthorizationPanel({ selectedReferral, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [auths, setAuths]               = useState([]);
  const [loadingAuths, setLoadingAuths] = useState(false);

  // form mode: null | 'approval' | 'denial'
  const [mode, setMode]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Approval form state
  const [authNumber, setAuthNumber]     = useState('');
  const [approvedDate, setApprovedDate] = useState('');
  const [windowStart, setWindowStart]   = useState('');
  const [windowEnd, setWindowEnd]       = useState('');
  const [servicesAuth, setServicesAuth] = useState([]);

  // Denial form state
  const [denialReason, setDenialReason] = useState('');

  useEffect(() => {
    if (!selectedReferral?.id) { setAuths([]); return; }
    setLoadingAuths(true);
    getAuthorizationsByReferral(selectedReferral.id)
      .then((recs) => setAuths(recs.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoadingAuths(false));
  }, [selectedReferral?.id]);

  // Reset forms when patient changes
  useEffect(() => {
    setMode(null);
    setAuthNumber(''); setApprovedDate(''); setWindowStart(''); setWindowEnd(''); setServicesAuth([]);
    setDenialReason('');
    setSaveError(null);
  }, [selectedReferral?._id]);

  const latestAuth = auths[0];

  function toggleService(s) {
    setServicesAuth((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handleApproval() {
    if (!approvedDate || !selectedReferral || !canPerm(PERMISSION_KEYS.AUTH_DECIDE)) return;
    setSaving(true); setSaveError(null);
    try {
      const fields = {
        referral_id: selectedReferral.id,
        plan_name: selectedReferral.patient?.insurance_plan || '',
        status: 'Approved',
        approved_date: approvedDate,
        ...(authNumber.trim()  && { auth_number: authNumber.trim() }),
        ...(windowStart        && { effective_start: windowStart }),
        ...(windowEnd          && { effective_end: windowEnd }),
        ...(servicesAuth.length && { services_authorized: servicesAuth }),
      };
      if (latestAuth?._id) {
        await updateAuthorization(latestAuth._id, fields);
      } else {
        await createAuthorization(fields);
      }
      onInitiateTransition?.(selectedReferral, 'Staffing Feasibility');
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  async function handleDenial() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.AUTH_DECIDE)) return;
    setSaving(true); setSaveError(null);
    try {
      const fields = {
        referral_id: selectedReferral.id,
        plan_name: selectedReferral.patient?.insurance_plan || '',
        status: 'Denied',
        ...(denialReason.trim() && { denial_reason: denialReason.trim() }),
      };
      if (latestAuth?._id) {
        await updateAuthorization(latestAuth._id, fields);
      } else {
        await createAuthorization(fields);
      }
      onInitiateTransition?.(selectedReferral, 'NTUC');
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '6px 9px', borderRadius: 7, marginBottom: 7,
    border: `1px solid var(--color-border)`,
    fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
    background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex,
  };

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Auth Details">
            <InfoRow label="Plan"      value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="Submitted" value={latestAuth?.submitted_date
              ? new Date(latestAuth.submitted_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : loadingAuths ? '…' : '—'} />
            <InfoRow label="Status"    value={latestAuth?.status || (loadingAuths ? '…' : 'Pending')}
              highlight={latestAuth?.status === 'Approved' ? palette.accentGreen.hex
                : latestAuth?.status === 'Denied' ? palette.primaryMagenta.hex : undefined} />
            {latestAuth?.auth_number && (
              <InfoRow label="Auth #" value={latestAuth.auth_number} />
            )}
            {latestAuth?.effective_start && (
              <InfoRow label="Window"
                value={`${new Date(latestAuth.effective_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${latestAuth.effective_end ? new Date(latestAuth.effective_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?'}`} />
            )}
          </PanelSection>

          <PanelSection title="Actions">
            {mode === null && (
              <>
                {canPerm(PERMISSION_KEYS.AUTH_DECIDE) && <ActionBtn label="Record Approval →" variant="forward"  onClick={() => setMode('approval')} />}
                {canPerm(PERMISSION_KEYS.AUTH_DECIDE) && <ActionBtn label="Record Denial"      variant="danger"   onClick={() => setMode('denial')} />}
                {canPerm(PERMISSION_KEYS.REFERRAL_HOLD) && <ActionBtn label="Place on Hold"      variant="warning"  onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')} />}
              </>
            )}

            {/* ── Approval Form ── */}
            {mode === 'approval' && (
              <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`, background: hexToRgba(palette.accentGreen.hex, 0.03), padding: '10px 11px' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: palette.accentGreen.hex, marginBottom: 8 }}>Record Approval</p>

                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 3 }}>Auth Number (optional)</label>
                <input type="text" placeholder="e.g. AUTH-12345" value={authNumber} onChange={(e) => setAuthNumber(e.target.value)} style={inputStyle} />

                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 3 }}>Approval Date *</label>
                <input type="date" value={approvedDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setApprovedDate(e.target.value)} style={{ ...inputStyle, borderColor: approvedDate ? palette.accentGreen.hex : undefined }} />

                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 3 }}>Auth Window Start</label>
                <input type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={inputStyle} />
                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 3 }}>Auth Window End</label>
                <input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={inputStyle} />

                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 5 }}>Services Authorized</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {AUTH_SERVICES.map((s) => (
                    <button key={s} onClick={() => toggleService(s)} style={{
                      padding: '3px 9px', borderRadius: 5, border: `1px solid var(--color-border)`,
                      fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                      background: servicesAuth.includes(s) ? palette.accentGreen.hex : 'none',
                      color: servicesAuth.includes(s) ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                    }}>{s}</button>
                  ))}
                </div>

                {saveError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{saveError}</p>}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleApproval} disabled={!approvedDate || saving} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: approvedDate && !saving ? 'pointer' : 'not-allowed',
                    background: approvedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                    color: approvedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                    fontSize: 11.5, fontWeight: 650,
                  }}>{saving ? 'Saving…' : 'Confirm Approval'}</button>
                  <button onClick={() => { setMode(null); setSaveError(null); }} disabled={saving} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: hexToRgba(palette.backgroundDark.hex, 0.07),
                    color: hexToRgba(palette.backgroundDark.hex, 0.55),
                    fontSize: 11.5, fontWeight: 650,
                  }}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Denial Form ── */}
            {mode === 'denial' && (
              <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.35)}`, background: hexToRgba(palette.primaryMagenta.hex, 0.03), padding: '10px 11px' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: palette.primaryMagenta.hex, marginBottom: 8 }}>Record Denial</p>

                <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 3 }}>Denial Reason</label>
                <textarea
                  value={denialReason}
                  onChange={(e) => setDenialReason(e.target.value)}
                  rows={3}
                  placeholder="Describe the reason for denial..."
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />

                {saveError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{saveError}</p>}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleDenial} disabled={saving} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: !saving ? 'pointer' : 'not-allowed',
                    background: !saving ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                    color: !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                    fontSize: 11.5, fontWeight: 650,
                  }}>{saving ? 'Saving…' : 'Confirm Denial → NTUC'}</button>
                  <button onClick={() => { setMode(null); setSaveError(null); }} disabled={saving} style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: hexToRgba(palette.backgroundDark.hex, 0.07),
                    color: hexToRgba(palette.backgroundDark.hex, 0.55),
                    fontSize: 11.5, fontWeight: 650,
                  }}>Cancel</button>
                </div>
              </div>
            )}
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 8. Conflict ───────────────────────────────────────────────────────────────
const SEVERITY_PILL = {
  Low:      { bg: hexToRgba(palette.accentBlue.hex, 0.14),     text: palette.accentBlue.hex },
  Medium:   { bg: hexToRgba(palette.highlightYellow.hex, 0.22), text: '#7A5F00' },
  High:     { bg: hexToRgba(palette.accentOrange.hex, 0.18),   text: palette.accentOrange.hex },
  Critical: { bg: hexToRgba(palette.primaryMagenta.hex, 0.18), text: palette.primaryMagenta.hex },
};

const CONFLICT_RESOLVE_DESTINATIONS = [
  { stage: 'Eligibility Verification', sub: 'Insurance conflict resolved — recheck' },
  { stage: 'Clinical Intake RN Review', sub: 'Compliance cleared — return to clinical' },
  { stage: 'Disenrollment Required', sub: 'Overlap found — discharge needed' },
];

function ConflictPanel({ selectedReferral, onOpenEligibility, onOpenFiles, onInitiateTransition }) {
  const [conflicts, setConflicts] = useState([]);
  const [loadingConflicts, setLoadingConflicts] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  useEffect(() => {
    if (!selectedReferral?.id) { setConflicts([]); return; }
    setLoadingConflicts(true);
    getConflictsByReferral(selectedReferral.id)
      .then((recs) => setConflicts(recs.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoadingConflicts(false));
  }, [selectedReferral?.id]);

  const openConflicts = conflicts.filter((c) => c.status === 'Open' || c.status === 'In Progress');
  const resolvedConflicts = conflicts.filter((c) => c.status === 'Resolved' || c.status === 'Waived');

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          {/* Conflict details */}
          {loadingConflicts ? (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '8px 0' }}>Loading…</p>
          ) : (
            <PanelSection title={`Active Conflicts (${openConflicts.length})`}>
              {openConflicts.length === 0 ? (
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontStyle: 'italic' }}>No open conflicts recorded.</p>
              ) : openConflicts.map((c) => {
                const sc = SEVERITY_PILL[c.severity] || SEVERITY_PILL.Medium;
                return (
                  <div key={c._id} style={{ padding: '10px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`, marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{c.type || 'Unknown'}</span>
                      <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.text }}>{c.severity}</span>
                    </div>
                    {c.description && (
                      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6), lineHeight: 1.5 }}>{c.description}</p>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, color: palette.primaryMagenta.hex }}>{c.status}</span>
                  </div>
                );
              })}
              {resolvedConflicts.length > 0 && (
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), marginTop: 6 }}>
                  + {resolvedConflicts.length} resolved
                </p>
              )}
            </PanelSection>
          )}

          {/* Resolution — dropdown button */}
          <PanelSection title="Actions">
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <button
                onClick={() => setResolveOpen((o) => !o)}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                  background: palette.accentGreen.hex, color: palette.backgroundLight.hex,
                  fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'filter 0.12s', letterSpacing: '-0.01em',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                Resolve Conflict — send to…
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: resolveOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
                  <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {resolveOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 9, overflow: 'hidden', boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
                  {CONFLICT_RESOLVE_DESTINATIONS.map((d) => (
                    <button key={d.stage} onMouseDown={(e) => { e.preventDefault(); setResolveOpen(false); onInitiateTransition?.(selectedReferral, d.stage); }}
                      style={{ width: '100%', padding: '9px 13px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.06))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                      <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 1 }}>{d.stage}</p>
                      <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{d.sub}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ActionBtn label="Escalate to Disenrollment" variant="warning"  onClick={() => onInitiateTransition?.(selectedReferral, 'Disenrollment Required')} />
            <ActionBtn label="Mark NTUC"                  variant="danger"   onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')} />
            <ActionBtn label="View Eligibility Check"     variant="default"  onClick={() => onOpenEligibility?.(selectedReferral)} />
            <ActionBtn label="View Related Documents"     variant="default"  onClick={() => onOpenFiles?.(selectedReferral)} />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 9. Staffing Feasibility ───────────────────────────────────────────────────
const STAFFING_TABS = ['Clinicians', 'Zip Search', 'Radar'];

function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', marginBottom: open ? 8 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{title}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4.5l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.4)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && children}
    </div>
  );
}

function StaffingPanel({ selectedReferral, allReferrals, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [contacted, setContacted] = useState(false);
  const [activeTab, setActiveTab] = useState('Clinicians');

  return (
    <Panel width={380}>
      {/* Patient actions — always visible when patient selected */}
      {selectedReferral && (
        <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid var(--color-border)` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
              {selectedReferral.patientName || selectedReferral.patient_id} · {Array.isArray(selectedReferral.services_requested) ? selectedReferral.services_requested.join(', ') : '—'}
            </p>
            {selectedReferral.patient?.address_zip && (
              <span style={{ fontSize: 11, fontWeight: 700, color: palette.accentBlue.hex, background: hexToRgba(palette.accentBlue.hex, 0.1), padding: '2px 8px', borderRadius: 5, flexShrink: 0, marginLeft: 8 }}>
                ZIP {selectedReferral.patient.address_zip}
              </span>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: contacted ? hexToRgba(palette.accentGreen.hex, 0.07) : hexToRgba(palette.backgroundDark.hex, 0.04), cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={contacted} onChange={(e) => setContacted(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>Patient / parent contacted</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => contacted && canPerm(PERMISSION_KEYS.SCHEDULING_STAFFING) && onInitiateTransition?.(selectedReferral, 'Admin Confirmation')}
              disabled={!contacted || !canPerm(PERMISSION_KEYS.SCHEDULING_STAFFING)}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                background: contacted ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: contacted ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                fontSize: 13.5, fontWeight: 700, cursor: contacted ? 'pointer' : 'not-allowed',
                textAlign: 'left', letterSpacing: '-0.01em', transition: 'filter 0.12s',
              }}
              onMouseEnter={(e) => contacted && (e.currentTarget.style.filter = 'brightness(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}>
              Continue to Admin Confirmation →
            </button>
            <button
              onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none',
                background: palette.highlightYellow.hex, color: palette.backgroundDark.hex,
                fontSize: 12.5, fontWeight: 650, cursor: 'pointer', textAlign: 'left', transition: 'filter 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}>
              Place on Hold
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {STAFFING_TABS.map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', fontSize: 11.5, fontWeight: 650, cursor: 'pointer', transition: 'all 0.12s',
              background: activeTab === t ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
              color: activeTab === t ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content — all three stay mounted to preserve state across tab switches */}
      <div style={{ display: activeTab === 'Clinicians' ? 'block' : 'none' }}><CliniciansPanel /></div>
      <div style={{ display: activeTab === 'Zip Search' ? 'block' : 'none' }}><ZipSearchPanel /></div>
      <div style={{ display: activeTab === 'Radar'      ? 'block' : 'none' }}><RadarPanel allReferrals={allReferrals || []} /></div>
    </Panel>
  );
}

// ── 10. Admin Confirmation ────────────────────────────────────────────────────
function AdminConfirmationPanel({ selectedReferral, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Case Summary">
            <InfoRow label="Patient" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Services" value={Array.isArray(selectedReferral.services_requested) ? selectedReferral.services_requested.join(', ') : '—'} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="Days in pipeline" value={Math.floor((Date.now() - new Date(selectedReferral.referral_date).getTime()) / 86400000) + 'd'} />
          </PanelSection>
          {canPerm(PERMISSION_KEYS.SCHEDULING_ADMIN_CONFIRM) && (
          <PanelSection title="Decision">
            <ActionBtn label="Accept → Pre-SOC"  variant="forward"  onClick={() => onInitiateTransition?.(selectedReferral, 'Pre-SOC')} />
            {canPerm(PERMISSION_KEYS.REFERRAL_NTUC) && <ActionBtn label="Decline → NTUC" variant="danger" onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')} />}
          </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 11. Pre-SOC ───────────────────────────────────────────────────────────────
function PreSocPanel({ selectedReferral }) {
  const { can: canPerm } = usePermissions();
  const today = new Date().toISOString().split('T')[0];
  const [socDate, setSocDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset date when selection changes
  useEffect(() => { setSocDate(''); setError(null); }, [selectedReferral?._id]);

  async function handleSchedule() {
    if (!socDate || !selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE)) return;
    setSaving(true);
    setError(null);
    try {
      const enteredAt = new Date().toISOString();
      await updateReferral(selectedReferral._id, {
        current_stage: 'SOC Scheduled',
        soc_scheduled_date: socDate,
      });
      // Best-effort: save stage timer — silently ignored if field doesn't exist in Airtable yet
      updateReferral(selectedReferral._id, { stage_entered_at: enteredAt }).catch(() => {});
      await createEpisode({
        patient_id: selectedReferral.patient_id,
        referral_id: selectedReferral._id,
        soc_date: socDate,
        episode_start: socDate,
      });
      recordTransition({ referral: selectedReferral, fromStage: 'Pre-SOC', toStage: 'SOC Scheduled', authorId: null });
      triggerDataRefresh();
    } catch (err) {
      setError(err.message || 'Failed to schedule SOC');
      setSaving(false);
    }
  }

  const canSchedule = !!socDate && !saving;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Patient">
            <InfoRow label="Name"      value={selectedReferral.patientName} />
            <InfoRow label="Division"  value={selectedReferral.division} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
          </PanelSection>

          <PanelSection title="Schedule SOC">
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.55, marginBottom: 10 }}>
              Select the Start of Care date. Confirming will begin an episode and move this patient to SOC Scheduled.
            </p>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), display: 'block', marginBottom: 5 }}>
              SOC Date
            </label>
            <input
              type="date"
              value={socDate}
              min={today}
              onChange={(e) => setSocDate(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '7px 9px', borderRadius: 7,
                border: `1px solid ${socDate ? palette.accentGreen.hex : 'var(--color-border)'}`,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                background: palette.backgroundLight.hex,
                color: palette.backgroundDark.hex,
                marginBottom: 12,
              }}
            />

            {error && (
              <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>
            )}

            <button
              onClick={handleSchedule}
              disabled={!canSchedule}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 7, border: 'none',
                background: canSchedule ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: canSchedule ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                fontSize: 12.5, fontWeight: 650,
                cursor: canSchedule ? 'pointer' : 'not-allowed',
                transition: 'filter 0.12s',
              }}
              onMouseEnter={(e) => canSchedule && (e.currentTarget.style.filter = 'brightness(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              {saving ? 'Scheduling…' : 'Confirm & Schedule SOC →'}
            </button>
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 12. SOC Scheduled ─────────────────────────────────────────────────────────
function SocScheduledPanel({ selectedReferral, resolveSource, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [pdfLoading, setPdfLoading]       = useState(false);
  const [pdfError, setPdfError]           = useState(null);
  const [confirming, setConfirming]       = useState(false);
  const [onboarding, setOnboarding]       = useState(false);
  const [onboardError, setOnboardError]   = useState(null);

  // Reset state when patient changes
  useEffect(() => {
    setConfirming(false);
    setOnboardError(null);
    setPdfError(null);
  }, [selectedReferral?._id]);

  async function handleDownloadPdf() {
    if (!selectedReferral) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      await generateEmrPacket(selectedReferral, resolveSource);
    } catch (err) {
      setPdfError(err.message || 'Failed to generate PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleOnboarded() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE)) return;
    setOnboarding(true);
    setOnboardError(null);
    try {
      const enteredAt = new Date().toISOString();
      await updateReferral(selectedReferral._id, {
        current_stage: 'SOC Completed',
        soc_completed_date: new Date().toISOString().split('T')[0],
      });
      // Best-effort: save stage timer — silently ignored if field doesn't exist in Airtable yet
      updateReferral(selectedReferral._id, { stage_entered_at: enteredAt }).catch(() => {});
      recordTransition({ referral: selectedReferral, fromStage: 'SOC Scheduled', toStage: 'SOC Completed', authorId: null });
      triggerDataRefresh();
    } catch (err) {
      setOnboardError(err.message || 'Failed to update patient');
      setOnboarding(false);
      setConfirming(false);
    }
  }

  const socDateDisplay = selectedReferral?.soc_scheduled_date
    ? new Date(selectedReferral.soc_scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="SOC Details">
            <InfoRow label="Scheduled date" value={socDateDisplay} />
            <InfoRow label="Patient"        value={selectedReferral.patientName} />
            <InfoRow label="Division"       value={selectedReferral.division} />
          </PanelSection>

          <PanelSection title="Actions">

            {/* ── Download EMR Onboarding Packet ── */}
            <button
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              style={{
                width: '100%', padding: '7px 12px', marginBottom: 8,
                borderRadius: 7, border: 'none',
                background: hexToRgba(palette.backgroundDark.hex, 0.07),
                color: hexToRgba(palette.backgroundDark.hex, 0.65),
                fontSize: 12, fontWeight: 600, cursor: pdfLoading ? 'wait' : 'pointer',
                transition: 'filter 0.12s',
              }}
              onMouseEnter={(e) => !pdfLoading && (e.currentTarget.style.filter = 'brightness(0.92)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              {pdfLoading ? 'Generating…' : '↓ Download EMR Onboarding Packet'}
            </button>
            {pdfError && (
              <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>
            )}

            {/* ── Patient Onboarded to EMR (with inline confirm) ── */}
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                style={{
                  width: '100%', padding: '11px 14px', marginBottom: 8,
                  borderRadius: 8, border: 'none',
                  background: palette.accentGreen.hex,
                  color: palette.backgroundLight.hex,
                  fontSize: 13.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.01em',
                  textAlign: 'left', transition: 'filter 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                Patient Onboarded to EMR
              </button>
            ) : (
              <div style={{
                borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
                background: hexToRgba(palette.accentGreen.hex, 0.05),
                padding: '10px 11px', marginBottom: 8,
              }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4, lineHeight: 1.5 }}>
                  Confirm SOC Completion
                </p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
                  Confirm that <strong>{selectedReferral.patientName}</strong> has had their Start of Care and is now under Wellbound care. This will move them to SOC Completed.
                </p>
                {onboardError && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{onboardError}</p>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleOnboarded}
                    disabled={onboarding}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: onboarding ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex,
                      color: palette.backgroundLight.hex,
                      fontSize: 11.5, fontWeight: 650, cursor: onboarding ? 'wait' : 'pointer',
                    }}
                  >
                    {onboarding ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setOnboardError(null); }}
                    disabled={onboarding}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: hexToRgba(palette.backgroundDark.hex, 0.55),
                      fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Reschedule / Hold ── */}
            <ActionBtn
              label="Reschedule / Hold"
              variant="warning"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 13. SOC Completed ─────────────────────────────────────────────────────────
function SocCompletedPanel({ referrals }) {
  const hchbDone = referrals.filter((r) => r.hchb_entered === true || r.hchb_entered === 'true').length;
  return (
    <Panel>
      <PanelSection title="HCHB Entry Status">
        <InfoRow label="Entered in HCHB" value={hchbDone} highlight={palette.accentGreen.hex} />
        <InfoRow label="Pending HCHB entry" value={referrals.length - hchbDone} highlight={referrals.length - hchbDone > 0 ? palette.accentOrange.hex : null} />
      </PanelSection>
      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          This is a terminal stage. No forward transitions are available. Cases should be fully entered in HCHB.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── 14. Hold ──────────────────────────────────────────────────────────────────
function HoldPanel({ referrals, selectedReferral, resolveUser, onInitiateTransition }) {
  const { appUser } = useCurrentAppUser();
  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.REFERRAL_NTUC);

  const [returnStage, setReturnStage] = useState('');
  const [releasing, setReleasing] = useState(false);

  // Sync return stage from referral data when selection changes
  useEffect(() => {
    setReturnStage(selectedReferral?.hold_return_stage || '');
  }, [selectedReferral?._id, selectedReferral?.hold_return_stage]);

  const overdue = referrals.filter((r) =>
    r.hold_expected_resolution && new Date(r.hold_expected_resolution) < new Date()
  ).length;

  const isOverdue = selectedReferral?.hold_expected_resolution &&
    new Date(selectedReferral.hold_expected_resolution) < new Date();

  async function handleRelease() {
    if (!selectedReferral || !returnStage || releasing) return;
    setReleasing(true);
    try {
      // Clear hold metadata before transitioning
      await updateReferral(selectedReferral._id, {
        hold_reason: '',
        hold_return_stage: '',
        hold_expected_resolution: null,
      });
      onInitiateTransition?.(selectedReferral, returnStage);
    } catch {
      // transition failed — leave state as-is
    } finally {
      setReleasing(false);
    }
  }

  return (
    <Panel>
      <PanelSection title="Hold Summary">
        <InfoRow label="Total on hold" value={referrals.length} />
        <InfoRow
          label="Overdue resolutions"
          value={overdue}
          highlight={overdue > 0 ? palette.primaryMagenta.hex : null}
        />
      </PanelSection>

      {selectedReferral ? (
        <PanelSection title="Hold Details">
          <InfoRow label="Hold reason" value={selectedReferral.hold_reason} />
          <InfoRow
            label="Expected resolution"
            value={
              selectedReferral.hold_expected_resolution
                ? new Date(selectedReferral.hold_expected_resolution).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'
            }
            highlight={isOverdue ? palette.primaryMagenta.hex : null}
          />
          {selectedReferral.hold_owner_id && (
            <InfoRow label="Hold owner" value={resolveUser?.(selectedReferral.hold_owner_id)} />
          )}

          {/* Return stage selector */}
          <div style={{ marginTop: 12, marginBottom: 4 }}>
            <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
              Return to stage
            </p>
            <PanelSelect
              value={returnStage}
              onChange={setReturnStage}
              options={PIPELINE_STAGES}
              placeholder="Select stage…"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <ActionBtn
              label={releasing ? 'Releasing…' : 'Release → Return to Stage'}
              variant="forward"
              onClick={handleRelease}
              disabled={!returnStage || releasing}
            />
            {isAdmin && (
              <ActionBtn
                label="Move to NTUC"
                variant="danger"
                onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')}
              />
            )}
          </div>
        </PanelSection>
      ) : (
        <PanelSection title="Hold Details">
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
            Select a patient from the list to see hold details and release options.
          </p>
        </PanelSection>
      )}
    </Panel>
  );
}

// ── 15. NTUC ──────────────────────────────────────────────────────────────────
function NtucPanel({ referrals }) {
  const [exporting, setExporting] = useState(false);

  // Group by reason
  const byReason = {};
  referrals.forEach((r) => {
    const k = r.ntuc_reason || 'Unspecified';
    byReason[k] = (byReason[k] || 0) + 1;
  });

  // Group by financial impact
  const byImpact = {};
  referrals.forEach((r) => {
    const k = r.ntuc_financial_impact || 'Untagged';
    byImpact[k] = (byImpact[k] || 0) + 1;
  });

  async function handleExport() {
    if (exporting || !referrals.length) return;
    setExporting(true);
    try {
      const columns = [
        { key: 'patientName',           label: 'Patient' },
        { key: 'division',              label: 'Division' },
        { key: 'ntuc_reason',           label: 'NTUC Reason' },
        { key: 'ntuc_financial_impact', label: 'Financial Impact' },
        { key: 'referral_date',         label: 'Referral Date' },
        { key: 'services_requested',    label: 'Services' },
        { key: 'current_stage',         label: 'Stage' },
      ];
      const rows = referrals.map((r) => ({
        patientName:           r.patientName || r.patient_id || '',
        division:              r.division || '',
        ntuc_reason:           r.ntuc_reason || '',
        ntuc_financial_impact: r.ntuc_financial_impact || '',
        referral_date:         r.referral_date
          ? new Date(r.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '',
        services_requested:    Array.isArray(r.services_requested)
          ? r.services_requested.join(', ')
          : (r.services_requested || ''),
        current_stage:         r.current_stage || '',
      }));
      exportToExcel(rows, columns, 'NTUC Report', `${referrals.length} records · exported ${new Date().toLocaleDateString()}`);
    } catch (e) {
      console.error('NTUC export failed:', e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Panel>
      <PanelSection title="Breakdown by Reason">
        {Object.entries(byReason).length === 0 ? (
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No data</p>
        ) : (
          Object.entries(byReason).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
            <InfoRow key={reason} label={reason} value={count} />
          ))
        )}
      </PanelSection>

      {Object.keys(byImpact).some((k) => k !== 'Untagged') && (
        <PanelSection title="Financial Impact">
          {Object.entries(byImpact).sort(([, a], [, b]) => b - a).map(([tag, count]) => (
            <InfoRow key={tag} label={tag} value={count} />
          ))}
        </PanelSection>
      )}

      <PanelSection title="Actions">
        <ActionBtn
          label={exporting ? 'Exporting…' : 'Export NTUC Report'}
          variant="default"
          onClick={handleExport}
          disabled={exporting || referrals.length === 0}
        />
      </PanelSection>

      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          Terminal state. No forward transitions available. NTUC records are preserved for reporting and attribution.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function StagePanel({ stage, referrals, allReferrals, selectedReferral, resolveUser, resolveSource, onNewReferral, onOpenTriage, onOpenFiles, onOpenEligibility, onInitiateTransition }) {
  const props = { referrals, allReferrals, selectedReferral, resolveUser, resolveSource, onNewReferral, onOpenTriage, onOpenFiles, onOpenEligibility, onInitiateTransition };
  switch (stage) {
    case 'Lead Entry':                return <LeadEntryPanel {...props} />;
    case 'Intake':                    return <IntakePanel {...props} />;
    case 'Eligibility Verification':  return <EligibilityPanel {...props} />;
    case 'Disenrollment Required':    return <DisenrollmentPanel {...props} />;
    case 'F2F/MD Orders Pending':     return <F2FPanel {...props} />;
    case 'Clinical Intake RN Review': return <ClinicalRNPanel {...props} />;
    case 'Authorization Pending':     return <AuthorizationPanel {...props} />;
    case 'Conflict':                  return <ConflictPanel {...props} />;
    case 'Staffing Feasibility':      return <StaffingPanel {...props} />;
    case 'Admin Confirmation':        return <AdminConfirmationPanel {...props} />;
    case 'Pre-SOC':                   return <PreSocPanel {...props} />;
    case 'SOC Scheduled':             return <SocScheduledPanel {...props} />;
    case 'SOC Completed':             return <SocCompletedPanel {...props} />;
    case 'Hold':                      return <HoldPanel {...props} />;
    case 'NTUC':                      return <NtucPanel {...props} />;
    default: return null;
  }
}
