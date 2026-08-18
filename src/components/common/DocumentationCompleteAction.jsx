/**
 * Mark post-SOC deferred documentation complete.
 * Offers send-to-clinical (existing) and docs-only complete. The docs hold
 * (and orange DOCS badge) clears immediately; clinical stays a separate job.
 */
import { useState } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import {
  getDocumentationClearChecklist,
  isDocumentationDeferred,
  daysUntilDocumentationDue,
  markDocsCompleteAndSendToClinical,
  clearDocumentationDeferred,
} from '../../utils/documentationDeferred.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import palette from '../../utils/colors.js';

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
 *   offerSendToClinical?: boolean,
 * }} props
 */
export default function DocumentationCompleteAction({
  referral,
  source = 'pending_log',
  onCleared,
  onOpenF2F,
  compact = false,
  offerSendToClinical = true,
}) {
  const { appUserId } = useCurrentAppUser();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  if (!referral || !isDocumentationDeferred(referral)) return null;

  const checklist = getDocumentationClearChecklist(referral);
  const daysLeft = daysUntilDocumentationDue(referral);
  const overdue = daysLeft != null && daysLeft < 0;
  const send = offerSendToClinical && checklist.shouldSendToClinical;

  async function finish(result) {
    if (!result.ok) {
      setError('Could not mark documentation complete.');
      return;
    }
    triggerDataRefresh();
    onCleared?.();
  }

  async function runSendToClinical() {
    if (busy) return;
    setBusy('send');
    setError('');
    try {
      await finish(await markDocsCompleteAndSendToClinical(referral, {
        actorUserId: appUserId,
        source,
      }));
    } catch (err) {
      setError(err?.message || 'Failed to mark complete');
    } finally {
      setBusy(null);
    }
  }

  async function runDocsOnly() {
    if (busy) return;
    setBusy('clear');
    setError('');
    try {
      await finish(await clearDocumentationDeferred(referral, {
        actorUserId: appUserId,
        source,
      }));
    } catch (err) {
      setError(err?.message || 'Failed to mark complete');
    } finally {
      setBusy(null);
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
            {send
              ? 'Get the paperwork, then send to Clinical — or mark docs complete if clinical review is not needed.'
              : 'Paperwork hold is still open. Mark docs complete to drop the orange DOCS badge.'}
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

      {onOpenF2F && (
        <ul style={{
          margin: '10px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <li>
            <button
              type="button"
              onClick={!checklist.f2f ? onOpenF2F : undefined}
              disabled={checklist.f2f}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 8px',
                borderRadius: 8,
                border: 'none',
                background: !checklist.f2f ? '#FFFFFF' : 'transparent',
                textAlign: 'left',
                cursor: !checklist.f2f ? 'pointer' : 'default',
                fontFamily: 'inherit',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { if (!checklist.f2f) e.currentTarget.style.background = '#F3E4D8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = !checklist.f2f ? '#FFFFFF' : 'transparent'; }}
            >
              <StatusCheck complete={checklist.f2f} />
              <span style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                color: palette.backgroundDark.hex,
                lineHeight: 1.3,
              }}>
                F2F / MD orders date logged
              </span>
              {!checklist.f2f && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#8A8494' }}>
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </li>
        </ul>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {send && (
          <button
            type="button"
            data-testid="mark-docs-complete"
            disabled={!!busy}
            onClick={runSendToClinical}
            title="Clear the docs hold and send this case to Clinical Review."
            style={{
              width: '100%',
              minHeight: 36,
              padding: '8px 10px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'inherit',
              lineHeight: 1.25,
              cursor: busy ? 'wait' : 'pointer',
              background: palette.accentGreen.hex,
              color: palette.backgroundLight.hex,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy === 'send' ? 'Sending…' : 'Mark docs complete and send to clinical review'}
          </button>
        )}
        <button
          type="button"
          data-testid={send ? 'mark-docs-complete-only' : 'mark-docs-complete'}
          disabled={!!busy}
          onClick={runDocsOnly}
          title={
            send
              ? 'Clear the docs hold only. Does not send to Clinical Review.'
              : 'Clear the docs hold. Clinical review is already in progress or done.'
          }
          style={{
            width: '100%',
            minHeight: 36,
            padding: '8px 10px',
            borderRadius: 8,
            border: send ? '1.5px solid #C07A3A' : 'none',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'inherit',
            lineHeight: 1.25,
            cursor: busy ? 'wait' : 'pointer',
            background: send ? '#FFFFFF' : palette.accentGreen.hex,
            color: send ? '#9A4E12' : palette.backgroundLight.hex,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy === 'clear' ? 'Clearing…' : 'Mark docs complete'}
        </button>
      </div>

      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: palette.primaryMagenta.hex }}>
          {error}
        </p>
      )}
    </div>
  );
}
