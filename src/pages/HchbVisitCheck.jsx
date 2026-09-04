import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import AccessDenied from '../components/common/AccessDenied.jsx';
import EpisodeTypeBadge from '../components/common/EpisodeTypeBadge.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { completeVisit } from '../utils/completeVisit.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { fmtCalendarDate } from '../utils/dateFormat.js';
import { runHchbVisitCheck } from '../api/hchbVisitCheck.js';
import {
  collectVisitCheckCandidates,
  isPendingScheduledVisit,
  mergeVisitCheckRows,
  statusLabel,
  VISIT_DATE_WINDOW_DAYS,
} from '../utils/hchbVisitCheck.js';

function offsetLabel(offset) {
  if (offset == null) return '—';
  if (offset === 0) return 'Same day';
  if (offset === 1) return '+1 day';
  if (offset === -1) return '−1 day';
  return `${offset > 0 ? '+' : ''}${offset} days`;
}

export default function HchbVisitCheck() {
  const { can } = usePermissions();
  const canOpen = can(PERMISSION_KEYS.MODULE_SCHEDULING);
  const canComplete = can(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE);
  const { data: referrals, loading } = usePipelineData();
  const { appUserId } = useCurrentAppUser();

  const [rows, setRows] = useState(null);
  const [checking, setChecking] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState(null);
  const [doneMsg, setDoneMsg] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const pending = useMemo(
    () => (referrals || []).filter(isPendingScheduledVisit),
    [referrals],
  );

  const stats = useMemo(() => {
    const list = rows || [];
    return {
      pending: pending.length,
      matched: list.filter((r) => r.match?.matched).length,
      strong: list.filter((r) => r.match?.matched && r.match?.confidence === 'strong').length,
      soft: list.filter((r) => r.match?.matched && r.match?.confidence === 'soft').length,
      selected: list.filter((r) => r.selected && r.match?.matched).length,
      none: list.filter((r) => r.match && !r.match.matched).length,
    };
  }, [rows, pending.length]);

  if (!canOpen) {
    return <AccessDenied message="You need Scheduling module access to check HCHB visits." />;
  }

  async function runCheck() {
    setChecking(true);
    setError(null);
    setDoneMsg(null);
    setConfirming(false);
    try {
      const candidates = collectVisitCheckCandidates(pending);
      if (!candidates.length) {
        setRows([]);
        setError('No scheduled SOC/ROC visits are waiting to be marked complete.');
        return;
      }
      const result = await runHchbVisitCheck({ candidates });
      if (!result?.ok) {
        throw new Error(result?.error || 'HCHB visit check failed');
      }
      setRows(mergeVisitCheckRows(pending, result.results || []));
    } catch (err) {
      setRows(null);
      setError(err.message || 'HCHB visit check failed');
    } finally {
      setChecking(false);
    }
  }

  function toggle(token, on) {
    setRows((prev) => (prev || []).map((row) => (
      row.token === token ? { ...row, selected: on } : row
    )));
  }

  function selectStrongOnly() {
    setRows((prev) => (prev || []).map((row) => ({
      ...row,
      selected: !!(row.match?.matched && row.match?.confidence === 'strong'),
    })));
  }

  function selectAllMatches() {
    setRows((prev) => (prev || []).map((row) => ({
      ...row,
      selected: !!row.match?.matched,
    })));
  }

  async function markSelected() {
    if (!canComplete) return;
    const chosen = (rows || []).filter((r) => r.selected && r.match?.matched && r.referral?._id);
    if (!chosen.length) return;
    setMarking(true);
    setError(null);
    setDoneMsg(null);
    let ok = 0;
    const failures = [];
    const succeeded = new Set();
    try {
      for (let i = 0; i < chosen.length; i++) {
        const row = chosen[i];
        const completedDate = row.match.visit_date || row.referral.soc_scheduled_date;
        try {
          let lastErr = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const result = await completeVisit({
                referral: row.referral,
                appUserId,
                completedDate,
              });
              if (!result.ok) throw new Error(result.reason || 'Failed');
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              const transient = /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''));
              if (!transient || attempt === 2) throw err;
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
          }
          if (lastErr) throw lastErr;
          succeeded.add(row.token);
          ok += 1;
        } catch (err) {
          failures.push(`${row.referral.patientName || row.token}: ${err.message || 'failed'}`);
        }
        if (i < chosen.length - 1) {
          // Each complete also fires StageHistory / note / activity in the
          // background. Space PATCHes so the browser does not drop them
          // ("Failed to fetch") against API Gateway.
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      triggerDataRefresh();
      setRows((prev) => (prev || []).filter((r) => !succeeded.has(r.token)));
      setConfirming(false);
      setDoneMsg(
        failures.length
          ? `Marked ${ok} complete. ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}. Failed patients are still on the list — keep them checked and mark again.`
          : `Marked ${ok} visit${ok === 1 ? '' : 's'} complete using the HCHB visit date.`,
      );
    } finally {
      setMarking(false);
    }
  }

  const th = {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    color: hexToRgba(palette.backgroundDark.hex, 0.45),
    padding: '8px 10px',
    borderBottom: `1px solid var(--color-border)`,
    whiteSpace: 'nowrap',
  };
  const td = {
    padding: '9px 10px',
    borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
    fontSize: 12.5,
    color: palette.backgroundDark.hex,
    verticalAlign: 'middle',
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <p style={{ fontSize: 12, margin: '0 0 10px' }}>
        <Link to="/modules/pre-soc" style={{ color: palette.accentBlue.hex, fontWeight: 650, textDecoration: 'none' }}>
          ← SOC/ROC module
        </Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px' }}>
        HCHB visit check
      </h1>
      <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '0 0 18px', lineHeight: 1.5, maxWidth: 760 }}>
        Checks scheduled SOC/ROC visits against HCHB logshipping on the closet PC.
        Visit type must match (SOC vs ROC). Dates may be {VISIT_DATE_WINDOW_DAYS} day earlier or later
        because HCHB often posts a day off. Manual complete on the SOC/ROC panel still works.
      </p>

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, marginBottom: 16,
        color: hexToRgba(palette.backgroundDark.hex, 0.5),
      }}>
        <span style={{
          padding: '3px 8px', borderRadius: 999,
          background: hexToRgba(palette.accentGreen.hex, 0.12), color: '#3A6E00', fontWeight: 650,
        }}>
          {loading ? '…' : stats.pending} scheduled, not completed
        </span>
        {rows && (
          <>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: hexToRgba(palette.accentGreen.hex, 0.12), color: '#3A6E00', fontWeight: 650 }}>
              {stats.strong} strong
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: hexToRgba(palette.highlightYellow.hex, 0.18), color: '#7A5F00', fontWeight: 650 }}>
              {stats.soft} name-only
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: hexToRgba(palette.backgroundDark.hex, 0.06), fontWeight: 650 }}>
              {stats.none} not found
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button
          type="button"
          data-testid="hchb-visit-check-run"
          onClick={runCheck}
          disabled={checking || marking || loading || pending.length === 0}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: checking || pending.length === 0 ? hexToRgba(palette.accentBlue.hex, 0.4) : palette.accentBlue.hex,
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: checking || pending.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {checking ? 'Checking HCHB…' : `Check ${pending.length} scheduled visit${pending.length === 1 ? '' : 's'}`}
        </button>
        {rows && stats.matched > 0 && (
          <>
            <button type="button" onClick={selectStrongOnly} disabled={marking} style={ghostBtn}>
              Strong only
            </button>
            <button type="button" onClick={selectAllMatches} disabled={marking} style={ghostBtn}>
              All matches
            </button>
          </>
        )}
      </div>

      {error && (
        <p data-testid="hchb-visit-check-error" style={{ color: palette.primaryMagenta.hex, fontSize: 13, margin: '0 0 12px' }}>{error}</p>
      )}
      {doneMsg && (
        <p style={{ color: palette.accentGreen.hex, fontSize: 13, margin: '0 0 12px', fontWeight: 650 }}>{doneMsg}</p>
      )}

      {!canComplete && rows && (
        <p style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 14,
          background: hexToRgba(palette.highlightYellow.hex, 0.15),
          color: '#7A5F00', fontSize: 12.5, lineHeight: 1.45,
        }}>
          You can review matches, but marking complete needs the “Mark SOC completed” permission.
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10, marginBottom: 16 }}>
            <table data-testid="hchb-visit-check-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Mark</th>
                  <th style={th}>Patient</th>
                  <th style={th}>Type</th>
                  <th style={th}>Scheduled</th>
                  <th style={th}>HCHB visit</th>
                  <th style={th}>Offset</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const canSelect = !!row.match?.matched;
                  return (
                    <tr key={row.token}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          data-testid={`hchb-visit-check-cb-${row.token}`}
                          checked={!!row.selected}
                          disabled={!canSelect || marking}
                          onChange={(e) => toggle(row.token, e.target.checked)}
                        />
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 650 }}>{row.referral.patientName || row.token}</div>
                        <div style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                          {row.referral.division || ''}
                        </div>
                      </td>
                      <td style={td}><EpisodeTypeBadge referral={row.referral} size="tiny" /></td>
                      <td style={td}>{fmtCalendarDate(row.referral.soc_scheduled_date) || '—'}</td>
                      <td style={td}>
                        {fmtCalendarDate(row.match?.visit_date) || '—'}
                        {row.match?.visit_type ? (
                          <div style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                            {row.match.visit_type}
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>{offsetLabel(row.match?.day_offset)}</td>
                      <td style={{
                        ...td,
                        color: row.match?.matched
                          ? (row.match.confidence === 'strong' ? palette.accentGreen.hex : '#7A5F00')
                          : hexToRgba(palette.backgroundDark.hex, 0.5),
                        fontWeight: 650,
                      }}>
                        {statusLabel(row.match)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canComplete && stats.selected > 0 && !confirming && (
            <button
              type="button"
              data-testid="hchb-visit-check-mark"
              onClick={() => setConfirming(true)}
              disabled={marking}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: palette.accentGreen.hex, color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Mark {stats.selected} completed
            </button>
          )}

          {confirming && (
            <div style={{
              maxWidth: 480, padding: '12px 14px', borderRadius: 10,
              border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
              background: hexToRgba(palette.accentGreen.hex, 0.06),
            }}>
              <p style={{ fontSize: 13, fontWeight: 650, margin: '0 0 6px', color: palette.backgroundDark.hex }}>
                Mark {stats.selected} visit{stats.selected === 1 ? '' : 's'} complete?
              </p>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '0 0 12px', lineHeight: 1.5 }}>
                Uses the HCHB visit date as the completed date. Unchecked rows are left scheduled. You can still mark visits complete one-by-one in the SOC/ROC module.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={markSelected}
                  disabled={marking}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                    background: marking ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex,
                    color: '#fff', fontSize: 12.5, fontWeight: 700,
                    cursor: marking ? 'wait' : 'pointer',
                  }}
                >
                  {marking ? 'Saving…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={marking}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                    background: hexToRgba(palette.backgroundDark.hex, 0.07),
                    color: hexToRgba(palette.backgroundDark.hex, 0.55),
                    fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {rows && rows.length === 0 && !error && (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          Nothing to review — no scheduled visits are waiting.
        </p>
      )}
    </div>
  );
}

const ghostBtn = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'none',
  fontSize: 12.5,
  fontWeight: 650,
  cursor: 'pointer',
  color: hexToRgba(palette.backgroundDark.hex, 0.6),
};
