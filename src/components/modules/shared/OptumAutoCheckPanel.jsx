import { useEffect, useMemo, useRef, useState } from 'react';
import palette, { hexToRgba } from '../../../utils/colors.js';
import {
  runOptumEligibilityCheck,
  buildOptumPrefill,
} from '../../../api/optumEligibility.js';
import { VERIFICATION_STATUS } from '../../../data/eligibilityEnums.js';

const LEVEL_COLOR = {
  ok: palette.accentGreen.hex,
  info: palette.accentBlue.hex,
  debug: hexToRgba(palette.backgroundDark.hex, 0.45),
  error: palette.primaryMagenta.hex,
};

/**
 * Auto eligibility check via Optum — prefills from patient/insurance/org,
 * auto-runs when ready, verbose log + full request/response.
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
      const data = await runOptumEligibilityCheck({
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
        tradingPartnerServiceId: payerId.trim(),
        providerNpi: providerNpi.trim(),
        providerName: providerName.trim(),
        serviceTypeCodes: ['30'],
      });
      setResult(data);
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
      border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.35)}`,
      borderRadius: 10,
      background: hexToRgba(palette.accentBlue.hex, 0.04),
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px',
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        background: hexToRgba(palette.accentBlue.hex, 0.08),
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>
            Optum Auto Check
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            Prefills from chart · auto-runs when ready · Log Check still available
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
              background: running || !canRun ? hexToRgba(palette.accentBlue.hex, 0.45) : palette.accentBlue.hex,
              color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: running || !canRun ? 'wait' : 'pointer',
            }}
          >
            {running ? 'Checking Optum…' : (result ? 'Re-run Auto Check' : 'Run Auto Check')}
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
          background: overview.usable
            ? hexToRgba(palette.accentGreen.hex, 0.1)
            : hexToRgba(palette.primaryMagenta.hex, 0.08),
          border: `1px solid ${overview.usable ? hexToRgba(palette.accentGreen.hex, 0.35) : hexToRgba(palette.primaryMagenta.hex, 0.3)}`,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 750, color: palette.backgroundDark.hex }}>
            {overview.usable
              ? 'Eligibility result usable'
              : overview.enrollmentBlock
                ? 'Not usable yet — Optum enrollment / access block'
                : overview.ok
                  ? 'Optum responded, but no usable eligibility'
                  : 'Check failed / incomplete'}
            <span style={{ fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              {' '}· {overview.env} · {overview.ms != null ? `${overview.ms}ms` : '—'}
            </span>
          </p>
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
                background: palette.accentGreen.hex, color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Apply suggestion to Log Check form
            </button>
          )}
        </div>
      )}

      {result?.logs?.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
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

      {(result?.request || result?.response) && (
        <div style={{ padding: '0 12px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <JsonBlock title="Request sent" value={result.request} />
          <JsonBlock title="Full Optum response" value={result.response} />
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
  const lines = [
    `Optum auto-check (${result.env || 'prod'})`,
    `Suggested: ${s.suggestedStatus || '—'}`,
    s.planLabel || s.payerName ? `Plan/payer: ${s.planLabel || s.payerName}` : null,
    `Benefits rows: ${s.benefitCount ?? 0}`,
    result.tradingPartnerServiceId ? `Payer ID: ${result.tradingPartnerServiceId}` : null,
    result.httpStatus ? `HTTP ${result.httpStatus}` : null,
  ].filter(Boolean);
  return lines.join(' · ');
}
