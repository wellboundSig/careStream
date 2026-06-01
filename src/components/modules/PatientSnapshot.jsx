import { useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { isTriageComplete } from '../../utils/triageCompleteness.js';
import { hasInsuranceDetails } from '../../utils/insuranceDetails.js';
import UrgentCareIcon from '../common/UrgentCareIcon.jsx';
import { setUrgentCare, isUrgentCare } from '../../utils/urgentCare.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';

// Fields required for the demographics readiness dot to turn green. Aligned
// with what the Demographics tab actually edits — `medicaid_number` is NOT
// captured there (it lives on insurance records), so requiring it here meant
// the dot could never go green from the demographics surface alone.
const DEMOGRAPHICS_FIELDS = [
  'first_name', 'last_name', 'dob', 'gender', 'phone_primary',
  'address_street', 'address_city', 'address_state', 'address_zip',
];

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

// Returns the hospitalization Date when the patient had a hospitalization
// within the last 14 days (per the cursory review), else null. Drives the
// hospital indicator in the snapshot.
export function recentHospitalizationDate(referral) {
  const raw = referral?.hospitalization_date;
  if (!raw) return null;
  // Parse the calendar date in LOCAL time (not UTC midnight) so the day count
  // and display don't shift by a day in negative-UTC timezones.
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(raw);
  if (isNaN(date.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - date.getTime()) / 86400000);
  if (days < 0 || days > 14) return null;
  return date;
}

function HospitalIcon({ size = 13, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M12 8v6M9 11h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// The fourth arg (formerly `insuranceChecks`) is preserved as a positional
// placeholder so older callers don't break, but we no longer consult it —
// the Insurance Details readiness flag is sourced from Demographics now
// (insurance plan + member ID). PECOS/OPRA was dropped from this panel in
// the 2026-05-27 intake-UX revision: nothing in software can act on those
// verifications, so they don't belong in the readiness snapshot.
export function computeSnapshotFlags(patient, referral, triageData /*, _legacyInsuranceChecks */) {
  const p = patient || {};
  const r = referral || {};

  const demographics = DEMOGRAPHICS_FIELDS.every(
    (f) => p[f] != null && String(p[f]).trim() !== '',
  );

  let triage = false;
  if (r.division === 'ALF') {
    triage = true;
  } else if (r.division === 'Special Needs') {
    if (!triageData || typeof triageData !== 'object') {
      triage = false;
    } else {
      const age = calcAge(p.dob);
      const type = age !== null && age < 18 ? 'pediatric' : 'adult';
      const result = isTriageComplete(triageData, type);
      triage = result.complete === true && result.missing.length === 0;
    }
  }

  const f2f = !!r.f2f_date;
  const f2fDate = r.f2f_date || null;
  const insurance = hasInsuranceDetails(p);

  return { demographics, triage, f2f, f2fDate, insurance };
}

// Each flag row knows which patient-drawer tab to jump to when clicked. The
// snapshot doubles as a quick navigation surface — clicking a row opens the
// corresponding tab in the patient drawer.
const FLAGS_META = [
  { key: 'demographics', label: 'Demographics',      tab: 'demographics' },
  { key: 'triage',       label: 'Triage',            tab: 'triage'       },
  { key: 'f2f',          label: 'F2F Received',      tab: 'f2f'          },
  // Insurance Details lives in Demographics — clicking jumps there, not to
  // the Eligibility tab (eligibility verification is a separate workflow,
  // and the readiness dot tracks data capture only).
  { key: 'insurance',    label: 'Insurance Details', tab: 'demographics' },
];

function StatusDot({ complete }) {
  const size = 8;
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        ...(complete
          ? { background: palette.accentGreen.hex }
          : {
              background: 'transparent',
              border: `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
            }),
      }}
    />
  );
}

export default function PatientSnapshot({ patient, referral, triageData, insuranceChecks, onOpenTab }) {
  const flags = computeSnapshotFlags(patient, referral, triageData, insuranceChecks);
  const { appUserId } = useCurrentAppUser();
  const urgent = isUrgentCare(referral);
  const hospDate = recentHospitalizationDate(referral);
  const [busy, setBusy] = useState(false);

  // We intentionally do NOT gate the toggle on a permission check at the UI
  // layer. The user explicitly asked for the urgent care control to always be
  // available; the underlying write goes through `setUrgentCare`, which
  // optimistically updates the store and reverts on rejection. Permission
  // enforcement happens server-side (or via Worker policies) — this UI is the
  // surface, not the guard.
  async function toggleUrgent() {
    if (!referral?._id || busy) return;
    setBusy(true);
    try {
      await setUrgentCare({ referral, next: !urgent, actorUserId: appUserId });
    } catch {
      // Optimistic mutation reverts on failure; nothing more to do.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Urgent care toggle — always rendered, always clickable. */}
      <button
        type="button"
        onClick={toggleUrgent}
        disabled={busy || !referral?._id}
        title={urgent ? 'Click to clear the urgent care flag' : 'Click to flag this patient for urgent care'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 8px',
          marginBottom: 2,
          borderRadius: 7,
          border: 'none',
          textAlign: 'left',
          cursor: busy ? 'wait' : 'pointer',
          background: urgent ? hexToRgba(palette.primaryMagenta.hex, 0.1) : 'transparent',
          color: urgent ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
          fontFamily: 'inherit',
          fontWeight: urgent ? 650 : 550,
          fontSize: 11.5,
          transition: 'background 0.12s',
          opacity: busy ? 0.6 : 1,
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = urgent ? hexToRgba(palette.primaryMagenta.hex, 0.16) : hexToRgba(palette.backgroundDark.hex, 0.05); }}
        onMouseLeave={(e) => { e.currentTarget.style.background = urgent ? hexToRgba(palette.primaryMagenta.hex, 0.1) : 'transparent'; }}
      >
        <UrgentCareIcon size={13} muted={!urgent} />
        <span>{urgent ? 'Urgent care required' : 'Mark urgent care'}</span>
      </button>

      {/* Recent hospitalization indicator — shown when the cursory review
          flagged a hospitalization within the last 14 days. Informational
          (not clickable); opens the F2F tab where the review lives. */}
      {hospDate && (
        <button
          type="button"
          onClick={() => onOpenTab?.('f2f')}
          title="Recent hospitalization — see Document Review (F2F tab)"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 8px', marginBottom: 2, borderRadius: 7, border: 'none',
            textAlign: 'left', cursor: onOpenTab ? 'pointer' : 'default',
            background: hexToRgba(palette.primaryMagenta.hex, 0.1),
            color: palette.primaryMagenta.hex,
            fontFamily: 'inherit', fontWeight: 650, fontSize: 11.5,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.16); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.1); }}
        >
          <HospitalIcon size={13} color={palette.primaryMagenta.hex} />
          <span>Hospitalized {hospDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </button>
      )}

      {/* Snapshot flag rows — each is a button that opens the matching tab
          in the patient drawer (when an onOpenTab callback is wired). */}
      {FLAGS_META.map(({ key, label, tab }) => {
        const clickable = !!onOpenTab && !!tab;
        const complete = !!flags[key];
        // The F2F row doubles as a quick read-out of the recorded visit date,
        // so the moment a date is logged (Files tab during intake, or from
        // the F2F panel itself) the snapshot reflects it without waiting for
        // the patient to move into the F2F stage.
        const isF2FRow = key === 'f2f';
        let secondary = null;
        if (isF2FRow && flags.f2fDate) {
          try {
            secondary = new Date(flags.f2fDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          } catch { /* malformed date → omit */ }
        }
        return (
          <button
            key={key}
            type="button"
            onClick={clickable ? () => onOpenTab(tab) : undefined}
            disabled={!clickable}
            title={clickable ? `Open ${label}` : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 6px',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              cursor: clickable ? 'pointer' : 'default',
              fontFamily: 'inherit',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.04); }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <StatusDot complete={complete} />
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: complete
                  ? hexToRgba(palette.backgroundDark.hex, 0.75)
                  : hexToRgba(palette.backgroundDark.hex, 0.45),
                flex: 1,
              }}
            >
              {label}
              {secondary && (
                <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                  · {secondary}
                </span>
              )}
            </span>
            {clickable && (
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
