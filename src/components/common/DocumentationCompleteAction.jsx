/**
 * Mark post-SOC deferred documentation complete.
 * Default: F2F + clinical required.
 * Quiet override: "Mark complete anyway" → Are you sure?
 * Case stays on SOC/ROC Completed; only the deferred flag clears.
 */
import { useState } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import {
  clearDocumentationDeferred,
  getDocumentationClearChecklist,
  isDocumentationDeferred,
  daysUntilDocumentationDue,
} from '../../utils/documentationDeferred.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const CHECK_LABELS = {
  f2f: 'F2F / MD orders date logged',
  clinical: 'Clinical RN review completed',
};

/**
 * @param {{
 *   referral: object,
 *   source?: string,
 *   onCleared?: () => void,
 *   onOpenF2F?: () => void,
 *   onOpenClinical?: () => void,
 *   compact?: boolean,
 * }} props
 */
export default function DocumentationCompleteAction({
  referral,
  source = 'pending_log',
  onCleared,
  onOpenF2F,
  onOpenClinical,
  compact = false,
}) {
  const { appUserId } = useCurrentAppUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmAnyway, setConfirmAnyway] = useState(false);

  if (!referral || !isDocumentationDeferred(referral)) return null;

  const checklist = getDocumentationClearChecklist(referral);
  const daysLeft = daysUntilDocumentationDue(referral);
  const overdue = daysLeft != null && daysLeft < 0;

  async function runClear({ force = false } = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await clearDocumentationDeferred(referral, {
        actorUserId: appUserId,
        source,
        force,
      });
      if (!result.ok) {
        setError(
          result.reason === 'need_f2f' ? 'Log the F2F date first.'
            : result.reason === 'need_clinical' ? 'Clinical RN must complete review first.'
              : result.reason === 'need_f2f_and_clinical' ? 'F2F and clinical review are both still required.'
                : 'Could not clear documentation hold.',
        );
        return;
      }
      setConfirmAnyway(false);
      triggerDataRefresh();
      onCleared?.();
    } catch (err) {
      setError(err?.message || 'Failed to mark complete');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="documentation-complete-action"
      style={{
        marginTop: compact ? 0 : 4,
        marginBottom: compact ? 0 : 16,
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 8,
        background: hexToRgba(palette.accentOrange.hex, 0.06),
      }}
    >
      <p style={{
        margin: 0,
        fontSize: 12.5,
        fontWeight: 700,
        color: palette.accentOrange.hex,
      }}>
        Waiting for post-SOC documentation
      </p>
      <p style={{
        margin: '4px 0 0',
        fontSize: 11.5,
        lineHeight: 1.4,
        color: hexToRgba(palette.backgroundDark.hex, 0.55),
      }}>
        Mark complete when F2F and clinical are both done. Stays on Completed.
        {referral.documentation_due_date && (
          <>
            {' '}Due {fmtCalendarDate(referral.documentation_due_date)}
            {overdue ? (
              <span style={{ color: palette.primaryMagenta.hex, fontWeight: 700 }}> · overdue</span>
            ) : daysLeft != null ? (
              <span> · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
            ) : null}
          </>
        )}
      </p>

      <ul style={{
        margin: '10px 0 0',
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {[
          { key: 'f2f', done: checklist.f2f, onClick: onOpenF2F },
          { key: 'clinical', done: checklist.clinical, onClick: onOpenClinical },
        ].map((item) => (
          <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: item.done ? palette.accentGreen.hex : 'transparent',
                border: item.done
                  ? 'none'
                  : `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
                color: palette.backgroundLight.hex,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {item.done ? '✓' : ''}
            </span>
            <span style={{
              flex: 1,
              fontSize: 12,
              fontWeight: item.done ? 550 : 650,
              color: item.done
                ? hexToRgba(palette.backgroundDark.hex, 0.55)
                : palette.backgroundDark.hex,
            }}>
              {CHECK_LABELS[item.key]}
            </span>
            {!item.done && item.onClick && (
              <button
                type="button"
                onClick={item.onClick}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  fontSize: 11,
                  fontWeight: 650,
                  color: palette.primaryDeepPlum.hex,
                  cursor: 'pointer',
                }}
              >
                Open
              </button>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="mark-docs-complete"
        disabled={!checklist.canClear || busy}
        onClick={() => runClear({ force: false })}
        title={
          checklist.canClear
            ? 'Clear the deferred-docs hold. Case remains on SOC/ROC Completed.'
            : 'Both F2F and clinical review must be done first.'
        }
        style={{
          marginTop: 12,
          width: '100%',
          height: 34,
          borderRadius: 7,
          border: 'none',
          fontSize: 12.5,
          fontWeight: 650,
          cursor: checklist.canClear && !busy ? 'pointer' : 'not-allowed',
          background: checklist.canClear ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
          color: checklist.canClear ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy && checklist.canClear ? 'Clearing…' : 'Mark documentation complete'}
      </button>

      {!checklist.canClear && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          {!confirmAnyway ? (
            <button
              type="button"
              data-testid="mark-docs-anyway"
              disabled={busy}
              onClick={() => { setError(''); setConfirmAnyway(true); }}
              style={{
                border: 'none',
                background: 'none',
                padding: 0,
                fontSize: 11,
                fontWeight: 500,
                color: hexToRgba(palette.backgroundDark.hex, 0.38),
                cursor: busy ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >
              Mark complete anyway
            </button>
          ) : (
            <div
              data-testid="mark-docs-anyway-confirm"
              style={{
                padding: '8px 10px',
                borderRadius: 7,
                background: hexToRgba(palette.backgroundDark.hex, 0.04),
                textAlign: 'left',
              }}
            >
              <p style={{
                margin: 0,
                fontSize: 12,
                fontWeight: 650,
                color: palette.backgroundDark.hex,
              }}>
                Are you sure?
              </p>
              <p style={{
                margin: '4px 0 0',
                fontSize: 11.5,
                lineHeight: 1.4,
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
              }}>
                F2F and/or clinical are still open. This clears the docs hold only.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAnyway(false)}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '4px 8px',
                    fontSize: 12,
                    fontWeight: 550,
                    color: hexToRgba(palette.backgroundDark.hex, 0.5),
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="mark-docs-anyway-confirm-yes"
                  disabled={busy}
                  onClick={() => runClear({ force: true })}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 650,
                    background: hexToRgba(palette.backgroundDark.hex, 0.12),
                    color: palette.backgroundDark.hex,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? 'Clearing…' : 'Yes, clear hold'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: palette.primaryMagenta.hex }}>
          {error}
        </p>
      )}
    </div>
  );
}
