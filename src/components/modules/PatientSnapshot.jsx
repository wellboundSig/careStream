import palette, { hexToRgba } from '../../utils/colors.js';
import { isTriageComplete } from '../../utils/triageCompleteness.js';

const DEMOGRAPHICS_FIELDS = [
  'first_name', 'last_name', 'dob', 'gender', 'phone_primary',
  'address_street', 'address_city', 'address_state', 'address_zip',
  'medicaid_number',
];

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

function isTruthyFlag(val) {
  return val === true || val === 'TRUE' || val === 'true';
}

export function computeSnapshotFlags(patient, referral, triageData, insuranceChecks) {
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

  const insurance =
    Array.isArray(insuranceChecks) && insuranceChecks.length > 0;

  const pecos = isTruthyFlag(r.is_pecos_verified) && isTruthyFlag(r.is_opra_verified);

  return { demographics, triage, f2f, insurance, pecos };
}

const FLAGS_META = [
  { key: 'demographics', label: 'Demographics' },
  { key: 'triage',       label: 'Triage' },
  { key: 'f2f',          label: 'F2F Received' },
  { key: 'insurance',    label: 'Insurance Verified' },
  { key: 'pecos',        label: 'PECOS / OPRA' },
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

export default function PatientSnapshot({ patient, referral, triageData, insuranceChecks }) {
  const flags = computeSnapshotFlags(patient, referral, triageData, insuranceChecks);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {FLAGS_META.map(({ key, label }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <StatusDot complete={flags[key]} />
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: flags[key]
                ? hexToRgba(palette.backgroundDark.hex, 0.75)
                : hexToRgba(palette.backgroundDark.hex, 0.4),
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
