import { useState } from 'react';
import { updatePhysician } from '../../api/physicians.js';
import { mergeEntities } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { verifyPhysicianNpi } from '../../api/cms.js';
import { normalizePhysicianTitle } from '../../utils/physicianName.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Reusable NPI / PECOS / OPRA verification panel.
 *
 * One click runs the free, key-less CMS lookups (NPPES + Order & Referring) and
 * writes the resulting statuses, timestamps, and "checked by" back to the SAME
 * Physicians record in a single update — so it stays in sync everywhere the
 * panel is shown (patient Physician tab + Physicians-directory drawer).
 *
 * Props:
 *   physician  — a Physicians store record ({ _id, npi, npi_status, ... })
 *   readOnly   — hide the "Verify now" action (view-only surfaces)
 *   compact    — tighter layout for the patient drawer tab
 */
export default function PhysicianVerificationPanel({ physician, readOnly = false, compact = false, onUpdated }) {
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  // Holds the fields from the most recent run so the panel reflects results
  // instantly even if the host passes a stale `physician` snapshot.
  const [justVerified, setJustVerified] = useState(null);

  if (!physician) {
    return (
      <div style={emptyBox}>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          No physician linked yet — pick one above to enable NPI / PECOS / OPRA verification.
        </p>
      </div>
    );
  }

  // Effective record = stored physician with the latest in-session result layered on top.
  const p = justVerified ? { ...physician, ...justVerified } : physician;

  const npi = String(p.npi || '').replace(/\D/g, '');
  const hasNpi = npi.length === 10;

  const npiStatus = p.npi_status || (p.npi ? 'unchecked' : 'no_npi');
  const pecos = p.is_pecos_enrolled === true || p.is_pecos_enrolled === 'true';
  const opra = p.is_opra_enrolled === true || p.is_opra_enrolled === 'true';
  const lastRun = p.verification_last_run_at || null;
  const checkedBy = p.verification_checked_by_id ? resolveUser(p.verification_checked_by_id) : null;

  let flags = null;
  try { flags = p.order_refer_flags ? JSON.parse(p.order_refer_flags) : null; } catch { flags = null; }
  let details = null;
  try { details = p.npi_details ? JSON.parse(p.npi_details) : null; } catch { details = null; }

  const rows = [
    { name: 'NPI Registration', descriptor: 'NPPES national provider enumeration', status: npiBadge(npiStatus) },
    { name: 'PECOS Enrollment', descriptor: 'Medicare ordering / referring file', status: pecos ? STATUS.enrolled : lastRun ? STATUS.notFound : STATUS.unchecked },
    { name: 'Order & Refer (OPRA)', descriptor: 'Eligible to order & refer services', status: opra ? STATUS.eligible : lastRun ? STATUS.notEligible : STATUS.unchecked },
  ];

  const activeFlags = flags ? Object.entries(flags).filter(([, v]) => v).map(([k]) => k) : [];
  const detailRows = details ? DETAIL_FIELDS
    .map((f) => ({ label: f.label, hint: f.hint, value: (f.derive ? f.derive(details) : (f.fmt ? f.fmt(details[f.key]) : details[f.key])) }))
    .filter((r) => r.value != null && String(r.value).trim() !== '') : [];

  async function handleVerify() {
    if (!hasNpi || running || readOnly) return;
    setRunning(true);
    setError(null);
    try {
      const r = await verifyPhysicianNpi(npi);
      // Airtable checkbox fields must be `true` to check or `null` to uncheck —
      // sending `false` is silently ignored and would leave a stale ✓.
      const title = normalizePhysicianTitle(r.details?.credential);
      const fields = {
        npi_status: r.npiStatus,
        npi_checked_at: r.checkedAt,
        npi_provider_name: r.providerName || '',
        npi_details: r.details ? JSON.stringify(r.details) : '',
        ...(title ? { title } : {}),
        is_pecos_enrolled: r.pecosEnrolled ? true : null,
        pecos_last_checked: r.checkedAt,
        is_opra_enrolled: r.opraEligible ? true : null,
        opra_last_checked: r.checkedAt,
        order_refer_flags: JSON.stringify(r.flags || {}),
        verification_last_run_at: r.checkedAt,
        verification_checked_by_id: appUserId || 'unknown',
      };
      await updatePhysician(physician._id, fields);
      // Normalize null → false for the local store copy so the UI reflects state.
      const localFields = { ...fields, is_pecos_enrolled: !!r.pecosEnrolled, is_opra_enrolled: !!r.opraEligible };
      mergeEntities('physicians', { [physician._id]: { ...physician, ...localFields } });
      setJustVerified(localFields);
      setShowDetails(true);
      onUpdated?.(fields);
    } catch (e) {
      setError(e.message || 'Verification failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, background: palette.backgroundLight.hex, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: compact ? '12px 14px' : '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            Provider Verification
          </p>
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.42), marginTop: 3 }}>
            {lastRun
              ? `Last checked ${fmtDateTime(lastRun)}${checkedBy && checkedBy !== '—' ? ` · ${checkedBy}` : ''}`
              : 'Not yet verified'}
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={handleVerify}
            disabled={!hasNpi || running}
            title={hasNpi ? 'Run NPPES + CMS Order & Referring checks' : 'Add a 10-digit NPI to verify'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none',
              background: (!hasNpi || running) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
              color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650,
              cursor: (!hasNpi || running) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {running ? 'Checking…' : lastRun ? 'Re-verify' : 'Verify now'}
          </button>
        )}
      </div>

      {!hasNpi && (
        <p style={{ fontSize: 11.5, color: palette.accentOrange.hex, background: hexToRgba(palette.accentOrange.hex, 0.08), padding: '8px 16px', margin: 0 }}>
          A valid 10-digit NPI is required to run automated verification.
        </p>
      )}

      {/* Three equally-spaced status rows, each on its own line. */}
      <div>
        {rows.map((row, i) => (
          <div
            key={row.name}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: compact ? '11px 14px' : '13px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: row.status.dot, flexShrink: 0, boxShadow: `0 0 0 3px ${hexToRgba(row.status.dot, 0.15)}` }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.2 }}>{row.name}</p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>{row.descriptor}</p>
              </div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: row.status.bg, color: row.status.fg, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {row.status.text}
            </span>
          </div>
        ))}
      </div>

      {/* Order & Refer eligibility detail pills (legible, deep-plum tone). */}
      {activeFlags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: compact ? '0 14px 12px' : '0 16px 14px' }}>
          {activeFlags.map((k) => (
            <span key={k} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.01em', padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.primaryDeepPlum.hex, 0.1), color: palette.primaryDeepPlum.hex, border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.22)}` }}>
              {FLAG_LABELS[k] || k} · eligible
            </span>
          ))}
        </div>
      )}

      {/* Expandable NPPES record detail */}
      {details && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => setShowDetails((v) => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: compact ? '10px 14px' : '11px 16px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>NPPES record details</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M2 4.5l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.5)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showDetails && (
            <div style={{ padding: compact ? '0 14px 12px' : '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {detailRows.map((r, i) => (
                <div key={r.label} title={r.hint} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: i === 0 ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                  <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{r.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: palette.backgroundDark.hex, textAlign: 'right', wordBreak: 'break-word' }}>{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, padding: '0 16px 12px', margin: 0 }}>{error}</p>
      )}
    </div>
  );
}

const emptyBox = { border: '1px dashed var(--color-border)', borderRadius: 10, padding: 14, background: hexToRgba(palette.backgroundDark.hex, 0.02) };

// Legible, premium status tones (solid hexes with matching dot).
const TONE = {
  green: { bg: '#E7F8EE', fg: '#157347', dot: '#1B9E5A' },
  red:   { bg: '#FCEAEA', fg: '#B42318', dot: '#D92D20' },
  amber: { bg: '#FEF4E5', fg: '#92400E', dot: '#E08600' },
  gray:  { bg: '#F0F0F2', fg: '#667085', dot: '#98A2B3' },
};

const STATUS = {
  enrolled:    { text: 'Enrolled',     ...TONE.green },
  eligible:    { text: 'Eligible',     ...TONE.green },
  notFound:    { text: 'Not found',    ...TONE.red },
  notEligible: { text: 'Not eligible', ...TONE.red },
  unchecked:   { text: 'Unchecked',    ...TONE.gray },
};

function npiBadge(status) {
  switch (status) {
    case 'active':      return { text: 'Active',      ...TONE.green };
    case 'deactivated': return { text: 'Deactivated', ...TONE.red };
    case 'not_found':   return { text: 'Not found',   ...TONE.red };
    case 'no_npi':      return { text: 'No NPI',       ...TONE.gray };
    default:            return { text: 'Unchecked',    ...TONE.gray };
  }
}

const FLAG_LABELS = { PARTB: 'Part B', DME: 'DME', HHA: 'HHA', HOSPICE: 'Hospice', PMD: 'PMD' };

const DETAIL_FIELDS = [
  { key: 'number',            label: 'NPI',            hint: 'The 10-digit NPI' },
  { key: 'enumeration_type',  label: 'Type',           hint: 'NPI-1 (individual) or NPI-2 (organization)', fmt: (v) => v === 'NPI-1' ? 'NPI-1 · Individual' : v === 'NPI-2' ? 'NPI-2 · Organization' : v },
  { key: 'name',              label: 'Legal name',     hint: 'Legal name (individual) or business name (org)', derive: (d) => d.organization_name || [d.first_name, d.last_name].filter(Boolean).join(' ') },
  { key: 'credential',        label: 'Credential',     hint: 'MD, DO, NP, PA, RN, LCSW, etc.' },
  { key: 'gender',            label: 'Gender',         hint: 'Provider gender (individuals only)', fmt: (v) => v === 'M' ? 'Male' : v === 'F' ? 'Female' : v },
  { key: 'status',            label: 'NPPES status',   hint: '"A" (active) or "D" (deactivated)', fmt: (v) => v === 'A' ? 'Active' : v === 'D' ? 'Deactivated' : v },
  { key: 'enumeration_date',  label: 'Enumerated',     hint: 'When the NPI was first issued', fmt: fmtDate },
  { key: 'last_updated',      label: 'Last updated',   hint: 'Last NPPES record update date', fmt: fmtDate },
  { key: 'sole_proprietor',   label: 'Sole proprietor', hint: 'Y/N — individual operating as org', fmt: (v) => /^(y|yes)$/i.test(String(v)) ? 'Yes' : /^(n|no)$/i.test(String(v)) ? 'No' : v },
];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
