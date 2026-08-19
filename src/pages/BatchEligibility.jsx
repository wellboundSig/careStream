import { useMemo, useRef, useState } from 'react';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import AccessDenied from '../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import { runOptumEligibilityCheck, resolveProviderOrg } from '../api/optumEligibility.js';
import {
  parseUploadedSpreadsheet,
  planRowChecks,
  runQueuedChecks,
  buildExportRows,
  workbookFromExportRows,
  downloadWorkbook,
  maskSsn,
  ELIGIBILITY_NETWORKS,
} from '../utils/batchEligibility.js';

export default function BatchEligibility() {
  const { can } = usePermissions();
  const canOpen = can(PERMISSION_KEYS.CLINICAL_ELIGIBILITY_BATCH);
  const canRunOptum = can(PERMISSION_KEYS.CLINICAL_ELIGIBILITY_OPTUM_AUTO);
  const inputRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [runError, setRunError] = useState(null);

  const stats = useMemo(() => {
    const checks = rows.flatMap((r) => r.checks || []);
    return {
      people: rows.length,
      runnable: checks.filter((c) => c.status === 'queued').length,
      skipped: checks.filter((c) => c.status === 'skipped').length,
      unsupported: checks.filter((c) => c.status === 'unsupported').length,
      done: checks.filter((c) => c.status === 'done').length,
      errors: checks.filter((c) => c.status === 'error').length,
    };
  }, [rows]);

  if (!canOpen) {
    return <AccessDenied message="You do not have permission to run batch eligibility. Ask an admin for “Batch eligibility spreadsheet.”" />;
  }

  async function onFile(file) {
    if (!file) return;
    setParseError(null);
    setRunError(null);
    setProgress(null);
    setFileName(file.name);
    try {
      const parsed = await parseUploadedSpreadsheet(file);
      setRows(parsed.map((row) => ({ ...row, checks: planRowChecks(row) })));
    } catch (err) {
      setRows([]);
      setParseError(err.message || 'Could not read that file.');
    }
  }

  async function runBatch() {
    if (!canRunOptum) {
      setRunError('Optum Auto Check permission is also required to hit the live eligibility API.');
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      await runQueuedChecks(rows, {
        concurrency: 2,
        delayMs: 400,
        onProgress: setProgress,
        runCheck: async (row, check) => {
          const provider = resolveProviderOrg({
            referral: { division: /special|sn\b|wbii/i.test(row.residentType || '') ? 'Special Needs' : 'ALF' },
          });
          return runOptumEligibilityCheck({
            patient: {
              first_name: row.firstName,
              last_name: row.lastName,
              dob: row.dob,
              gender: row.gender,
              medicaid_number: row.medicaidId,
              medicare_number: row.medicareId,
            },
            insurance: {
              member_id: check.memberId,
              insurance_category: check.category,
              payer_display_name: check.payerName,
            },
            tradingPartnerServiceId: check.payerId,
            providerNpi: provider.npi,
            providerName: provider.name,
            dateOfService: check.dateOfService,
            serviceTypeCodes: ['30'],
          });
        },
      });
      setRows([...rows]);
    } catch (err) {
      setRunError(err.message || 'Batch failed.');
    } finally {
      setRunning(false);
    }
  }

  async function downloadResults() {
    const wb = await workbookFromExportRows(buildExportRows(rows));
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadWorkbook(wb, `eligibility-batch-${stamp}.xlsx`);
  }

  const finished = !running && rows.some((r) => (r.checks || []).some((c) => c.status === 'done' || c.status === 'error'));

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px' }}>
        Batch eligibility
      </h1>
      <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '0 0 18px', lineHeight: 1.5, maxWidth: 720 }}>
        Upload a CSV or Excel roster. We run every payer Optum can answer today (Medicare → CMS, Medicaid → MCDNY, plus mapped commercials). Empty IDs are skipped. Unknown plans are marked for Waystar / eSolutions later. Nothing is written to a patient chart.
      </p>

      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5,
        color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 16,
      }}>
        {Object.values(ELIGIBILITY_NETWORKS).map((n) => (
          <span key={n.id} style={{
            padding: '3px 8px', borderRadius: 999,
            background: n.supported ? hexToRgba(palette.accentGreen.hex, 0.12) : hexToRgba(palette.backgroundDark.hex, 0.06),
            color: n.supported ? '#3A6E00' : hexToRgba(palette.backgroundDark.hex, 0.45),
            fontWeight: 650,
          }}>
            {n.label}{n.supported ? ' · live' : ' · coming later'}
          </span>
        ))}
      </div>

      {!canRunOptum && (
        <p style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 14,
          background: hexToRgba(palette.highlightYellow.hex, 0.15),
          color: '#7A5F00', fontSize: 12.5, lineHeight: 1.45,
        }}>
          You can preview a file here, but live checks need the Optum Auto Check permission as well.
        </p>
      )}

      <div style={{
        border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
        borderRadius: 12, padding: 18, marginBottom: 16,
        background: hexToRgba(palette.backgroundDark.hex, 0.02),
      }}>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={running}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: palette.primaryDeepPlum.hex, color: '#fff',
            fontSize: 13, fontWeight: 650, cursor: 'pointer',
          }}
        >
          Choose CSV or Excel
        </button>
        <span style={{ marginLeft: 10, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          {fileName || 'Columns: Patient Name, SSN, Resident Type, Gender, DOB, DOA, Medicaid ID, Medicare ID, Other Insurance, Skill Need'}
        </span>
      </div>

      {parseError && (
        <p style={{ color: palette.primaryMagenta.hex, fontSize: 13, margin: '0 0 12px' }}>{parseError}</p>
      )}
      {runError && (
        <p style={{ color: palette.primaryMagenta.hex, fontSize: 13, margin: '0 0 12px' }}>{runError}</p>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <button
              type="button"
              onClick={runBatch}
              disabled={running || !canRunOptum || stats.runnable === 0}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: running || !canRunOptum || stats.runnable === 0
                  ? hexToRgba(palette.accentBlue.hex, 0.4)
                  : palette.accentBlue.hex,
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: running || !canRunOptum || stats.runnable === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {running
                ? `Checking… ${progress?.done || 0}/${progress?.total || stats.runnable}`
                : `Run ${stats.runnable} Optum check${stats.runnable === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={downloadResults}
              disabled={!finished && stats.done === 0 && stats.errors === 0}
              style={{
                padding: '8px 14px', borderRadius: 8,
                border: `1px solid var(--color-border)`,
                background: palette.backgroundLight.hex,
                fontSize: 13, fontWeight: 650, cursor: 'pointer',
                color: palette.backgroundDark.hex,
              }}
            >
              Download Excel results
            </button>
            <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {stats.people} patients · {stats.runnable} ready · {stats.skipped} skipped · {stats.unsupported} unsupported
              {stats.done || stats.errors ? ` · ${stats.done} done · ${stats.errors} errors` : ''}
            </span>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.04), textAlign: 'left' }}>
                  {['#', 'Patient', 'DOB', 'Medicare', 'Medicaid', 'Other', 'Skill'].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 10px', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{row.rowNumber}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ fontWeight: 650 }}>{row.nameRaw || '—'}</div>
                      <div style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                        {row.gender || '—'}{row.ssn ? ` · ${maskSsn(row.ssn)}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{row.dob || '—'}</td>
                    <td style={{ padding: '8px 10px' }}><CheckCell check={row.checks?.find((c) => c.key === 'medicare')} /></td>
                    <td style={{ padding: '8px 10px' }}><CheckCell check={row.checks?.find((c) => c.key === 'medicaid')} /></td>
                    <td style={{ padding: '8px 10px' }}><CheckCell check={row.checks?.find((c) => c.key === 'other')} /></td>
                    <td style={{ padding: '8px 10px' }}>{row.skillNeed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CheckCell({ check }) {
  if (!check) return '—';
  const tone = check.status === 'done' && check.summary?.usable
    ? palette.accentGreen.hex
    : check.status === 'error' || (check.status === 'done' && !check.summary?.usable)
      ? palette.primaryMagenta.hex
      : check.status === 'unsupported'
        ? palette.accentOrange.hex
        : hexToRgba(palette.backgroundDark.hex, 0.45);
  const label = check.status === 'done'
    ? (check.summary?.status || 'done')
    : check.status === 'skipped'
      ? 'skipped'
      : check.status === 'unsupported'
        ? 'not supported yet'
        : check.status;
  return (
    <div>
      <div style={{ fontWeight: 650, color: tone }}>{label}</div>
      <div style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), maxWidth: 220 }}>
        {check.summary?.plainEnglish || check.reason || (check.memberId ? `ID ${check.memberId}` : '')}
      </div>
    </div>
  );
}
