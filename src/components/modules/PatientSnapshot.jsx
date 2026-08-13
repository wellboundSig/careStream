import { useState, useEffect } from 'react';
import palette from '../../utils/colors.js';
import { isTriageComplete } from '../../utils/triageCompleteness.js';
import { hasInsuranceDetails } from '../../utils/insuranceDetails.js';
import UrgentCareIcon from '../common/UrgentCareIcon.jsx';
import {
  setUrgentCare,
  setUrgentCareType,
  isUrgentCare,
  getUrgentCareTypes,
  urgentCareTypeLabel,
} from '../../utils/urgentCare.js';
import UrgentCareTypePicker from '../common/UrgentCareTypePicker.jsx';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { ageFromDob, fmtCalendarDate, parseCalendarDate } from '../../utils/dateFormat.js';

// Fields required for the demographics readiness dot to turn green. Aligned
// with what the Demographics tab actually edits — `medicaid_number` is NOT
// captured there (it lives on insurance records), so requiring it here meant
// the dot could never go green from the demographics surface alone.
const DEMOGRAPHICS_FIELDS = [
  'first_name', 'last_name', 'dob', 'gender', 'phone_primary',
  'address_street', 'address_city', 'address_state', 'address_zip',
];

// Returns the hospitalization Date when the patient had a hospitalization
// within the last 14 days (per the cursory review), else null. Drives the
// hospital indicator in the snapshot.
export function recentHospitalizationDate(referral) {
  const date = parseCalendarDate(referral?.hospitalization_date);
  if (!date) return null;
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
      const age = ageFromDob(p.dob);
      const type = age !== null && age < 18 ? 'pediatric' : 'adult';
      const result = isTriageComplete(triageData, type);
      triage = result.complete === true && result.missing.length === 0;
    }
  }

  const f2f = !!r.f2f_date;
  const f2fDate = r.f2f_date || null;
  const insurance = hasInsuranceDetails(p);
  const initialEmr = !!r.emr_initial_onboarded_at;
  const initialEmrDate = r.emr_initial_onboarded_at || null;

  return { demographics, triage, f2f, f2fDate, insurance, initialEmr, initialEmrDate };
}

function StatusCheck({ complete }) {
  if (complete) {
    return (
      <span
        style={{
          width: 18, height: 18, borderRadius: 9, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: palette.accentGreen.hex,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2l2.4 2.4 4.6-5.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      style={{
        width: 18, height: 18, borderRadius: 9, flexShrink: 0,
        boxSizing: 'border-box',
        border: '1.5px solid #C4C0CC',
        background: '#FFFFFF',
      }}
    />
  );
}

function FlagIcon({ name, color }) {
  const c = color || '#5A5466';
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { flexShrink: 0 } };
  if (name === 'person') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" stroke={c} strokeWidth="1.8" />
        <path d="M5.5 19c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'clipboard') {
    return (
      <svg {...common}>
        <rect x="6" y="5" width="12" height="15" rx="2" stroke={c} strokeWidth="1.8" />
        <path d="M9 5.2V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v.7" stroke={c} strokeWidth="1.8" />
        <path d="M9 11h6M9 15h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'doc') {
    return (
      <svg {...common}>
        <path d="M7 4h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 4v4h4" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'card') {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" stroke={c} strokeWidth="1.8" />
        <path d="M3 10h18" stroke={c} strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'monitor') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" stroke={c} strokeWidth="1.8" />
        <path d="M8 20h8M12 16v4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}

const FLAGS_META = [
  { key: 'demographics', label: 'Demographics',      tab: 'demographics', icon: 'person' },
  { key: 'triage',       label: 'Triage',            tab: 'triage',       icon: 'clipboard' },
  { key: 'f2f',          label: 'F2F Received',      tab: 'f2f',          icon: 'doc' },
  { key: 'insurance',    label: 'Insurance Details', tab: 'demographics', icon: 'card' },
  { key: 'initialEmr',   label: 'Initial EMR',       tab: null, alfOnly: true, icon: 'monitor' },
];

export default function PatientSnapshot({ patient, referral, triageData, insuranceChecks, onOpenTab }) {
  const flags = computeSnapshotFlags(patient, referral, triageData, insuranceChecks);
  const { appUserId } = useCurrentAppUser();
  const urgent = isUrgentCare(referral);
  const urgentTypes = getUrgentCareTypes(referral);
  const hospDate = recentHospitalizationDate(referral);
  const [busy, setBusy] = useState(false);
  const [pickType, setPickType] = useState(false);
  const [draftTypes, setDraftTypes] = useState([]);

  useEffect(() => {
    setPickType(false);
    setDraftTypes([]);
  }, [referral?._id]);

  // We intentionally do NOT gate the toggle on a permission check at the UI
  // layer. The user explicitly asked for the urgent care control to always be
  // available; the underlying write goes through `setUrgentCare`, which
  // optimistically updates the store and reverts on rejection. Permission
  // enforcement happens server-side (or via Worker policies) — this UI is the
  // surface, not the guard.
  async function markUrgent(types) {
    if (!referral?._id || busy || !types?.length) return;
    setBusy(true);
    try {
      await setUrgentCare({ referral, next: true, actorUserId: appUserId, type: types });
      setPickType(false);
      setDraftTypes([]);
    } catch {
      // Optimistic mutation reverts on failure; nothing more to do.
    } finally {
      setBusy(false);
    }
  }

  async function clearUrgent() {
    if (!referral?._id || busy) return;
    setBusy(true);
    try {
      await setUrgentCare({ referral, next: false, actorUserId: appUserId });
      setPickType(false);
      setDraftTypes([]);
    } catch {
      // no-op
    } finally {
      setBusy(false);
    }
  }

  async function changeTypes(types) {
    if (!referral?._id || busy) return;
    setBusy(true);
    try {
      await setUrgentCareType({ referral, types, actorUserId: appUserId });
    } catch {
      // no-op
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          marginBottom: 4,
          borderRadius: 8,
          background: urgent ? '#F8E8EF' : 'transparent',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {urgent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px' }}>
            <button
              type="button"
              onClick={clearUrgent}
              disabled={busy || !referral?._id}
              title="Clear urgent care"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: 'none', background: 'transparent', padding: 0,
                textAlign: 'left', cursor: busy ? 'wait' : 'pointer',
                color: palette.primaryMagenta.hex, fontFamily: 'inherit',
                fontWeight: 700, fontSize: 12.5,
              }}
            >
              <UrgentCareIcon size={15} />
              <span>
                Urgent care
                {urgentTypes.length ? ` · ${urgentCareTypeLabel(urgentTypes)}` : ''}
              </span>
            </button>
            <UrgentCareTypePicker
              types={urgentTypes}
              disabled={busy || !referral?._id}
              onChange={changeTypes}
            />
          </div>
        ) : pickType ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px' }}>
            <div style={{
              fontSize: 11, fontWeight: 750, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: '#4A4458',
              padding: '4px 6px 6px',
            }}>
              Mark urgent care
            </div>
            <UrgentCareTypePicker
              types={draftTypes}
              disabled={busy || !referral?._id}
              onChange={setDraftTypes}
            />
            <button
              type="button"
              disabled={busy || !referral?._id || draftTypes.length === 0}
              onClick={() => markUrgent(draftTypes)}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '8px',
                borderRadius: 7,
                border: 'none',
                background: draftTypes.length ? palette.primaryMagenta.hex : '#E8E6ED',
                color: draftTypes.length ? '#FFFFFF' : '#8A8494',
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: draftTypes.length && !busy ? 'pointer' : 'not-allowed',
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setPickType(false); setDraftTypes([]); }}
              style={{
                border: 'none', background: 'transparent', padding: '6px 8px',
                fontSize: 12, fontWeight: 600, color: '#5A5466',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setDraftTypes([]); setPickType(true); }}
            disabled={busy || !referral?._id}
            title="Flag this patient for urgent care"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 8px',
              borderRadius: 8,
              border: 'none',
              textAlign: 'left',
              cursor: busy ? 'wait' : 'pointer',
              background: '#EEECEF',
              color: '#3A3545',
              fontFamily: 'inherit',
              fontWeight: 650,
              fontSize: 12.5,
              width: '100%',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = '#E4E1E8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#EEECEF'; }}
          >
            <UrgentCareIcon size={15} muted />
            <span>Mark urgent care</span>
          </button>
        )}
      </div>

      {hospDate && (
        <button
          type="button"
          onClick={() => onOpenTab?.('f2f')}
          title="Open F2F document review"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px', marginBottom: 4, borderRadius: 8, border: 'none',
            textAlign: 'left', cursor: onOpenTab ? 'pointer' : 'default',
            background: '#F8E8EF',
            color: palette.primaryMagenta.hex,
            fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#F3D7E3'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#F8E8EF'; }}
        >
          <HospitalIcon size={15} color={palette.primaryMagenta.hex} />
          <span>Hospitalized {hospDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </button>
      )}

      {FLAGS_META.filter((m) => !m.alfOnly || referral?.division === 'ALF').map(({ key, label, tab, icon }) => {
        const clickable = !!onOpenTab && !!tab;
        const complete = !!flags[key];
        let secondary = null;
        if (key === 'f2f' && flags.f2fDate) {
          secondary = fmtCalendarDate(flags.f2fDate, null);
        }
        if (key === 'initialEmr' && flags.initialEmrDate) {
          secondary = fmtCalendarDate(flags.initialEmrDate, null);
        }
        const iconColor = complete ? '#2F6B2A' : '#6B6575';
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
              padding: '7px 8px',
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              cursor: clickable ? 'pointer' : 'default',
              fontFamily: 'inherit',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = '#EEECEF'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <StatusCheck complete={complete} />
            <FlagIcon name={icon} color={iconColor} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: complete ? palette.backgroundDark.hex : '#3A3545',
                flex: 1,
                lineHeight: 1.3,
              }}
            >
              {label}
              {secondary && (
                <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 550, color: '#5A5466' }}>
                  · {secondary}
                </span>
              )}
            </span>
            {clickable && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#8A8494' }}>
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
