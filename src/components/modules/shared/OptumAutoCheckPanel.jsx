import { useEffect, useMemo, useRef, useState } from 'react';
import palette, { hexToRgba } from '../../../utils/colors.js';
import {
  runSmartEligibilityCheck,
  buildOptumPrefill,
} from '../../../api/optumEligibility.js';
import { VERIFICATION_STATUS } from '../../../data/eligibilityEnums.js';

const LEVEL_COLOR = {
  ok: palette.accentGreen.hex,
  info: palette.accentBlue.hex,
  debug: hexToRgba(palette.backgroundDark.hex, 0.45),
  error: palette.primaryMagenta.hex,
};

const CLEARINGHOUSE_LABEL = { optum: 'Optum', availity: 'Availity', waystar: 'Waystar' };

/**
 * Auto eligibility check — prefills from patient/insurance/org, auto-runs
 * when ready, and routes to the right clearinghouse per payer (Optum /
 * Availity / Waystar) with automatic fallback. Verbose log + full payloads.
 */
export default function OptumAutoCheckPanel({
  patient,
  insurance,
  referral,
  onApplySuggestion,
  onClose,
}) {
  const prefill = useMemo(
    () => buildOptumPrefill({ patient, insurance, referral }),
    [patient, insurance, referral],
  );

  const [payerId, setPayerId] = useState(prefill.payerId);
  const [providerNpi, setProviderNpi] = useState(prefill.providerNpi);
  const [providerName, setProviderName] = useState(prefill.providerName);
  const [memberId, setMemberId] = useState(prefill.memberId);
  const [showAdvanced, setShowAdvanced] = useState(!prefill.ready);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [showDev, setShowDev] = useState(false);
  const autoRan = useRef(false);

  // Keep fields in sync if the insurance/patient props change
  useEffect(() => {
    setPayerId(prefill.payerId);
    setProviderNpi(prefill.providerNpi);
    setProviderName(prefill.providerName);
    setMemberId(prefill.memberId);
    setShowAdvanced(!prefill.ready);
  }, [prefill]);

  const canRun = Boolean(
    payerId.trim()
    && providerNpi.trim().length === 10
    && memberId.trim()
    && prefill.firstName
    && prefill.lastName
    && prefill.dob,
  );

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      if (providerNpi.trim()) localStorage.setItem('wb_optum_provider_npi', providerNpi.trim());
      if (providerName.trim()) localStorage.setItem('wb_optum_provider_name', providerName.trim());
      const data = await runSmartEligibilityCheck({
        patient: {
          first_name: prefill.firstName || patient?.first_name,
          last_name: prefill.lastName || patient?.last_name,
          dob: prefill.dob || patient?.dob,
          gender: prefill.gender || patient?.gender,
        },
        insurance: {
          member_id: memberId.trim(),
          payer_display_name: insurance?.payer_display_name,
          insurance_category: insurance?.insurance_category,
          plan_name: insurance?.plan_name,
          payer_id: insurance?.payer_id,
          group_number: insurance?.group_number || prefill.groupNumber,
        },
        payerId: payerId.trim() || undefined,
        providerNpi: providerNpi.trim(),
        providerName: providerName.trim(),
        serviceTypeCodes: ['30'],
      });
      // Smart envelope → show the deciding attempt, keep the trail.
      const attempts = Array.isArray(data?.attempts) ? data.attempts : null;
      const single = data?.result
        || (attempts ? [...attempts].reverse().find((a) => !a.skipped) : null)
        || data;
      setResult({
        ...single,
        _smart: attempts ? { route: data.route, conclusive: data.conclusive, attempts } : null,
      });
    } catch (err) {
      setResult({
        ok: false,
        logs: [{ at: new Date().toISOString(), level: 'error', message: err.message || 'Request failed' }],
        summary: { suggestedStatus: 'unable_to_verify', error: err.message },
        error: err.message,
      });
    } finally {
      setRunning(false);
    }
  }

  // Auto-run once when everything is already on file
  useEffect(() => {
    if (autoRan.current) return;
    if (!canRun) return;
    autoRan.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun]);

  const overview = useMemo(() => {
    if (!result) return null;
    const s = result.summary || {};
    const usable = !!result.ok && !s.enrollmentBlock && (s.benefitCount > 0 || s.activeCoverage || s.inactiveCoverage);
    return {
      ok: !!result.ok,
      usable,
      clearinghouse: CLEARINGHOUSE_LABEL[result.clearinghouse] || null,
      smart: result._smart || null,
      enrollmentBlock: !!s.enrollmentBlock,
      env: result.env,
      status: s.suggestedStatus,
      active: s.activeCoverage,
      inactive: s.inactiveCoverage,
      plan: s.planLabel || (s.payerName && s.payerName !== 'Unknown' ? s.payerName : '—'),
      benefits: s.benefitCount ?? 0,
      aaa: s.aaaErrorCount ?? 0,
      ms: result.elapsedMs,
      error: result.error || s.error,
      plainEnglish: s.plainEnglish || null,
      aaaErrors: s.aaaErrors || [],
    };
  }, [result]);

  return (
    <div style={{
      marginTop: 10,
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      background: palette.backgroundLight.hex,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px',
        borderBottom: '1px solid var(--color-border)',
        background: hexToRgba(palette.backgroundDark.hex, 0.03),
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>
            Auto Eligibility Check
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            Prefills from chart · routes to the right clearinghouse per payer
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5),
          }}>Close</button>
        )}
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          padding: '8px 10px', borderRadius: 8,
          background: hexToRgba(palette.backgroundDark.hex, 0.03),
          border: '1px solid var(--color-border)',
          fontSize: 12, lineHeight: 1.45, color: palette.backgroundDark.hex,
        }}>
          <div><b>Patient:</b> {prefill.firstName || '—'} {prefill.lastName || ''}{prefill.dob ? ` · DOB ${prefill.dob}` : ''}{prefill.gender ? ` · ${prefill.gender}` : ''}</div>
          <div><b>Payer:</b> {prefill.payerDisplayName || '—'}{payerId ? ` · ID ${payerId}` : ''}</div>
          <div>
            <b>Member:</b> {memberId || '—'}
            {prefill.memberSource ? <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45) }}> ({prefill.memberSource})</span> : null}
            {prefill.groupNumber ? ` · Group ${prefill.groupNumber}` : ''}
          </div>
          <div><b>Provider:</b> {providerName || '—'} · NPI {providerNpi || '—'}</div>
          {!canRun && prefill.missing.length > 0 && (
            <div style={{ marginTop: 6, color: palette.primaryMagenta.hex }}>
              Missing: {prefill.missing.join(', ')} — fill below then Run.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={run}
            disabled={running || !canRun}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: running || !canRun ? hexToRgba(palette.primaryMagenta.hex, 0.45) : palette.primaryMagenta.hex,
              color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: running || !canRun ? 'wait' : 'pointer',
            }}
          >
            {running ? 'Checking…' : (result ? 'Re-run Auto Check' : 'Run Auto Check')}
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              padding: '7px 10px', borderRadius: 7,
              border: '1px solid var(--color-border)', background: '#fff',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              color: hexToRgba(palette.backgroundDark.hex, 0.65),
            }}
          >
            {showAdvanced ? 'Hide overrides' : 'Edit overrides'}
          </button>
        </div>

        {showAdvanced && (
          <>
            <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              Trading partner / payer ID
              <input
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
                placeholder="CMS · MCDNY · 87726 · 05178…"
                style={fieldStyle()}
              />
            </label>
            <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              Member ID
              <input
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="From insurance or patient medicaid/medicare #"
                style={fieldStyle()}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                Provider NPI
                <input
                  value={providerNpi}
                  onChange={(e) => setProviderNpi(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit NPI"
                  style={{ ...fieldStyle(), fontFamily: 'ui-monospace, Menlo, monospace' }}
                />
              </label>
              <label style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                Provider name
                <input
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  style={fieldStyle()}
                />
              </label>
            </div>
          </>
        )}
      </div>

      {overview && (
        <div style={{
          margin: '0 12px 12px',
          padding: 12,
          borderRadius: 8,
          background: overview.usable ? '#F0FDF4' : hexToRgba(palette.primaryMagenta.hex, 0.06),
          border: `1px solid ${overview.usable ? '#BBF7D0' : hexToRgba(palette.primaryMagenta.hex, 0.3)}`,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 750, color: overview.usable ? '#15803d' : palette.backgroundDark.hex }}>
            {overview.usable
              ? 'Eligibility result usable'
              : overview.enrollmentBlock
                ? 'Not usable yet — clearinghouse enrollment / access block'
                : overview.ok
                  ? `${overview.clearinghouse || 'Clearinghouse'} responded, but no usable eligibility`
                  : 'Check failed / incomplete'}
            <span style={{ fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              {' '}· {[overview.clearinghouse, overview.env, overview.ms != null ? `${overview.ms}ms` : null].filter(Boolean).join(' · ') || '—'}
            </span>
          </p>
          {overview.smart?.attempts?.length > 1 && (
            <p style={{ margin: '0 0 8px', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              {overview.smart.route ? `Route: ${overview.smart.route} — ` : ''}
              {overview.smart.attempts.map((a) => {
                const name = CLEARINGHOUSE_LABEL[a.clearinghouse] || a.clearinghouse;
                if (a.skipped) return `${name} (skipped: ${a.reason})`;
                return `${name} (${a.summary?.suggestedStatus || (a.ok ? 'ok' : 'failed')})`;
              }).join(' → ')}
            </p>
          )}
          {overview.plainEnglish && (
            <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.45, color: palette.backgroundDark.hex }}>
              {overview.plainEnglish}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
            <div><b>Suggested status:</b> {overview.status || '—'}</div>
            <div><b>Plan / payer:</b> {overview.plan}</div>
            <div><b>Active flag:</b> {overview.active ? 'yes' : 'no'}</div>
            <div><b>Inactive flag:</b> {overview.inactive ? 'yes' : 'no'}</div>
            <div><b>Benefits rows:</b> {overview.benefits}</div>
            <div><b>AAA errors:</b> {overview.aaa}</div>
          </div>
          {overview.aaaErrors?.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>
              {overview.aaaErrors.map((e, i) => (
                <li key={i}>
                  {e.code ? `AAA ${e.code}: ` : ''}{e.description || 'Error'}
                  {e.location ? ` (${e.location})` : ''}
                </li>
              ))}
            </ul>
          )}
          {overview.error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: palette.primaryMagenta.hex }}>{overview.error}</p>
          )}
          {onApplySuggestion && overview.usable && overview.status && overview.status !== VERIFICATION_STATUS.UNREVIEWED && (
            <button
              type="button"
              onClick={() => onApplySuggestion({
                status: overview.status,
                note: buildNoteFromResult(result),
              })}
              style={{
                marginTop: 10, padding: '7px 12px', borderRadius: 7, border: 'none',
                background: palette.primaryMagenta.hex, color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Apply suggestion to Log Check form
            </button>
          )}
        </div>
      )}

      {/* Human-readable coverage report — what the payer actually returned,
          formatted like the clearinghouse portal would show it. */}
      {result?.response && typeof result.response === 'object' && (
        <div style={{ padding: '0 12px 12px' }}>
          <EligibilityReportView response={result.response} />
        </div>
      )}

      {/* Raw payloads + wire log for troubleshooting — hidden by default. */}
      {(result?.logs?.length > 0 || result?.request || result?.response) && (
        <div style={{ padding: '0 12px 12px' }}>
          <button
            type="button"
            onClick={() => setShowDev((v) => !v)}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45),
              textDecoration: 'underline',
            }}
          >
            {showDev ? 'Hide technical details' : 'Technical details'}
          </button>

          {showDev && result?.logs?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                Live log
              </p>
              <div style={{
                maxHeight: 220, overflow: 'auto', borderRadius: 8,
                background: '#0f172a', color: '#e2e8f0',
                padding: 10, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, lineHeight: 1.45,
              }}>
                {result.logs.map((line, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <span style={{ color: '#94a3b8' }}>{String(line.at || '').slice(11, 19)}</span>
                    {' '}
                    <span style={{ color: LEVEL_COLOR[line.level] || '#e2e8f0', fontWeight: 700 }}>
                      [{String(line.level || 'info').toUpperCase()}]
                    </span>
                    {' '}
                    <span>{line.message}</span>
                    {line.data !== undefined && (
                      <pre style={{
                        margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        color: '#94a3b8', fontSize: 10.5,
                      }}>
                        {typeof line.data === 'string' ? line.data : JSON.stringify(line.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showDev && (result?.request || result?.response) && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <JsonBlock title="Request sent" value={result.request} />
              <JsonBlock title="Full clearinghouse response" value={result.response} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Portal-style coverage report ─────────────────────────────────────────────
// Renders the parsed 271 the way a clearinghouse portal would: plan header,
// member details, then one row per benefit with amounts and network flags.

function fmtDate8(v) {
  const s = String(v || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`;
  if (/^\d{8}-\d{8}$/.test(s)) return `${fmtDate8(s.slice(0, 8))} – ${fmtDate8(s.slice(9))}`;
  return s || null;
}

function fmtMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
}

function ReportRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.5), minWidth: 92, flexShrink: 0 }}>{label}</span>
      <span style={{ color: palette.backgroundDark.hex, fontWeight: 550 }}>{value}</span>
    </div>
  );
}

function EligibilityReportView({ response }) {
  const benefits = Array.isArray(response?.benefitsInformation) ? response.benefitsInformation : [];
  const sub = response?.subscriber || {};
  const payer = response?.payer || {};
  const planInfo = response?.planInformation || {};
  const planDates = response?.planDateInformation || {};
  const planStatus = Array.isArray(response?.planStatus) ? response.planStatus : [];

  const subscriberName = [sub.firstName, sub.middleName, sub.lastName].filter(Boolean).join(' ');
  const planLabel = planStatus[0]?.statusDescription
    || benefits.find((b) => b.planCoverage)?.planCoverage
    || null;

  if (!benefits.length && !subscriberName && !payer.name) return null;

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        padding: '9px 12px', borderBottom: '1px solid var(--color-border)',
        background: hexToRgba(palette.backgroundDark.hex, 0.03),
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
      }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: palette.backgroundDark.hex }}>
          Coverage report
        </p>
        {payer.name && (
          <p style={{ margin: 0, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            {payer.name}{payer.payorIdentification ? ` · ${payer.payorIdentification}` : ''}
          </p>
        )}
      </div>

      {/* Member + plan header */}
      <div style={{
        padding: '10px 12px', borderBottom: benefits.length ? '1px solid var(--color-border)' : 'none',
        display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 2,
      }}>
        <ReportRow label="Member" value={subscriberName || null} />
        <ReportRow label="Member ID" value={sub.memberId || null} />
        <ReportRow label="DOB" value={fmtDate8(sub.dateOfBirth)} />
        <ReportRow label="Gender" value={sub.gender || null} />
        <ReportRow label="Plan" value={planLabel} />
        <ReportRow label="Group #" value={planInfo.groupNumber || null} />
        <ReportRow label="Plan dates" value={fmtDate8(planDates.plan) || fmtDate8(planDates.planBegin) || null} />
        <ReportRow label="Eligibility" value={fmtDate8(planDates.eligibility) || fmtDate8(planDates.eligibilityBegin) || null} />
      </div>

      {/* Benefit rows */}
      {benefits.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {benefits.map((b, i) => {
            const amount = fmtMoney(b.benefitAmount)
              || (b.benefitPercent != null && b.benefitPercent !== '' ? `${Math.round(Number(b.benefitPercent) * 100)}%` : null);
            const services = Array.isArray(b.serviceTypes) && b.serviceTypes.length
              ? b.serviceTypes.join(', ')
              : (Array.isArray(b.serviceTypeCodes) ? b.serviceTypeCodes.join(', ') : null);
            const notes = Array.isArray(b.additionalInformation)
              ? b.additionalInformation.map((n) => n?.description).filter(Boolean).join(' · ')
              : null;
            const isActive = String(b.code || '') === '1';
            const isInactive = String(b.code || '') === '6';
            return (
              <div key={i} style={{
                padding: '8px 12px',
                borderBottom: i < benefits.length - 1 ? `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` : 'none',
                background: i % 2 ? hexToRgba(palette.backgroundDark.hex, 0.015) : 'transparent',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: isActive ? '#15803d' : isInactive ? '#B91C1C' : palette.backgroundDark.hex,
                  }}>
                    {b.name || `Benefit ${b.code || ''}`}
                    {b.coverageLevel ? <span style={{ fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}> · {b.coverageLevel}</span> : null}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 650, color: palette.backgroundDark.hex, flexShrink: 0 }}>
                    {amount || ''}
                    {b.timeQualifier && amount ? <span style={{ fontWeight: 450, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}> / {b.timeQualifier}</span> : null}
                  </span>
                </div>
                {(services || b.insuranceType || b.inPlanNetworkIndicator) && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4 }}>
                    {[
                      b.insuranceType || null,
                      services,
                      b.inPlanNetworkIndicator && b.inPlanNetworkIndicator !== 'Not Applicable'
                        ? `${b.inPlanNetworkIndicator === 'Yes' ? 'In network' : b.inPlanNetworkIndicator === 'No' ? 'Out of network' : b.inPlanNetworkIndicator}`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
                {notes && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.4 }}>
                    {notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fieldStyle() {
  return {
    display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box',
    padding: '7px 9px', borderRadius: 7, border: '1px solid var(--color-border)',
    fontSize: 12.5,
  };
}

function JsonBlock({ title, value }) {
  return (
    <div>
      <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
        {title}
      </p>
      <pre style={{
        margin: 0, maxHeight: 240, overflow: 'auto', borderRadius: 8,
        background: hexToRgba(palette.backgroundDark.hex, 0.04),
        border: '1px solid var(--color-border)',
        padding: 8, fontSize: 10.5, lineHeight: 1.4,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function buildNoteFromResult(result) {
  if (!result) return '';
  const s = result.summary || {};
  const ch = CLEARINGHOUSE_LABEL[result.clearinghouse] || 'Optum';
  const lines = [
    `${ch} auto-check (${result.env || 'prod'})`,
    `Suggested: ${s.suggestedStatus || '—'}`,
    s.planLabel || s.payerName ? `Plan/payer: ${s.planLabel || s.payerName}` : null,
    `Benefits rows: ${s.benefitCount ?? 0}`,
    result.tradingPartnerServiceId ? `Payer ID: ${result.tradingPartnerServiceId}` : null,
    result.httpStatus ? `HTTP ${result.httpStatus}` : null,
  ].filter(Boolean);
  return lines.join(' · ');
}
