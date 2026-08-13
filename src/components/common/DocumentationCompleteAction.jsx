/**
 * Mark post-SOC deferred documentation complete.
 * Default: F2F + clinical required.
 * Override: confirm, then clear the hold only. Case stays on SOC/ROC Completed.
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
import palette from '../../utils/colors.js';

const CHECK_LABELS = {
  f2f: 'F2F / MD orders date logged',
  clinical: 'Clinical RN review completed',
};

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
        padding: compact ? '10px 12px' : '12px 12px 12px',
        borderRadius: 10,
        background: '#F8EDE4',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M7 4h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9A4E12" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 4v4h4" stroke="#9A4E12" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 750,
            color: '#9A4E12',
            lineHeight: 1.3,
          }}>
            Post-SOC documentation
          </p>
          <p style={{
            margin: '4px 0 0',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: '#3A3545',
          }}>
            Finish F2F and clinical review.
          </p>
          {referral.documentation_due_date && (
            <p style={{
              margin: '6px 0 0',
              fontSize: 12.5,
              fontWeight: 650,
              color: overdue ? palette.primaryMagenta.hex : '#5A5466',
            }}>
              Due {fmtCalendarDate(referral.documentation_due_date)}
              {overdue
                ? ' · overdue'
                : daysLeft != null
                  ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
                  : ''}
            </p>
          )}
        </div>
      </div>

      <ul style={{
        margin: '10px 0 0',
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {[
          { key: 'f2f', done: checklist.f2f, onClick: onOpenF2F },
          { key: 'clinical', done: checklist.clinical, onClick: onOpenClinical },
        ].map((item) => {
          const clickable = !item.done && !!item.onClick;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={clickable ? item.onClick : undefined}
                disabled={!clickable}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: 8,
                  border: 'none',
                  background: clickable ? '#FFFFFF' : 'transparent',
                  textAlign: 'left',
                  cursor: clickable ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = '#F3E4D8'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = clickable ? '#FFFFFF' : 'transparent'; }}
              >
                <StatusCheck complete={item.done} />
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: palette.backgroundDark.hex,
                  lineHeight: 1.3,
                }}>
                  {CHECK_LABELS[item.key]}
                </span>
                {clickable && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#8A8494' }}>
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
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
          marginTop: 10,
          width: '100%',
          height: 36,
          borderRadius: 8,
          border: 'none',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: checklist.canClear && !busy ? 'pointer' : 'not-allowed',
          background: checklist.canClear ? palette.accentGreen.hex : '#E8E6ED',
          color: checklist.canClear ? palette.backgroundLight.hex : '#5A5466',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy && checklist.canClear ? 'Clearing…' : 'Mark documentation complete'}
      </button>

      {!checklist.canClear && (
        <div style={{ marginTop: 8 }}>
          {!confirmAnyway ? (
            <button
              type="button"
              data-testid="mark-docs-anyway"
              disabled={busy}
              onClick={() => { setError(''); setConfirmAnyway(true); }}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                padding: '8px 4px',
                fontSize: 12.5,
                fontWeight: 650,
                color: '#5A5466',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Complete without F2F and clinical
            </button>
          ) : (
            <div
              data-testid="mark-docs-anyway-confirm"
              style={{
                padding: '10px 10px',
                borderRadius: 8,
                background: '#FFFFFF',
              }}
            >
              <p style={{
                margin: 0,
                fontSize: 12.5,
                lineHeight: 1.45,
                color: '#3A3545',
              }}>
                F2F or clinical review is still open. This only clears the documentation hold.
              </p>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button
                  type="button"
                  data-testid="mark-docs-anyway-confirm-yes"
                  disabled={busy}
                  onClick={() => runClear({ force: true })}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 7,
                    padding: '8px 10px',
                    fontSize: 12.5,
                    fontWeight: 650,
                    background: '#E8E6ED',
                    color: '#3A3545',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? 'Clearing…' : 'Clear hold'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAnyway(false)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 7,
                    padding: '8px 10px',
                    fontSize: 12.5,
                    fontWeight: 650,
                    background: '#E8E6ED',
                    color: '#3A3545',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: palette.primaryMagenta.hex }}>
          {error}
        </p>
      )}
    </div>
  );
}
