import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  updateInboundSubmission,
  logInboundEvent,
} from '../../api/inboundSubmissions.js';
import { parseInboundEmail } from '../../lib/inboundParse.js';
import ParseSuggestionChips from '../../components/inbound/ParseSuggestionChips.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { isUserOoo, oooOptionSuffix, oooWindowLabel } from '../../utils/outOfOffice.js';

const ghostBtn = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: hexToRgba(palette.backgroundDark.hex, 0.04), fontSize: 13, fontWeight: 600,
  color: hexToRgba(palette.backgroundDark.hex, 0.65), cursor: 'pointer',
};
const primaryBtn = {
  padding: '9px 16px', borderRadius: 8, border: 'none',
  background: palette.primaryMagenta.hex, fontSize: 13, fontWeight: 650,
  color: '#fff', cursor: 'pointer',
};

function sanitizeBasicHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

function readParsed(sub) {
  if (!sub?.parsed) return null;
  if (typeof sub.parsed === 'object') return sub.parsed;
  try { return JSON.parse(sub.parsed); } catch { return null; }
}

export default function InboundSubmissionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const storeSubs = useCareStore((s) => s.inboundSubmissions);
  const storeUsers = useCareStore((s) => s.users);
  const storeAtts = useCareStore((s) => s.inboundSubmissionAttachments);

  const canView = can(PERMISSION_KEYS.MODULE_INBOUND) || can(PERMISSION_KEYS.INBOUND_VIEW);
  const canAssign = can(PERMISSION_KEYS.INBOUND_ASSIGN) || can(PERMISSION_KEYS.INBOUND_MANAGE);
  const canConvertLead = can(PERMISSION_KEYS.INBOUND_CONVERT_LEAD);
  const canConvertRef = can(PERMISSION_KEYS.INBOUND_CONVERT_REFERRAL);
  const canDiscard = can(PERMISSION_KEYS.INBOUND_DISCARD);
  const canManage = can(PERMISSION_KEYS.INBOUND_MANAGE);

  const sub = useMemo(
    () => Object.values(storeSubs || {}).find((s) => s.id === id || s._id === id) || null,
    [storeSubs, id],
  );

  const attachments = useMemo(
    () => Object.values(storeAtts || {}).filter((a) => a.inbound_submission_id === sub?.id),
    [storeAtts, sub?.id],
  );

  const users = useMemo(
    () => Object.values(storeUsers || {}).filter((u) => u.status === 'Active' || !u.status)
      .sort((a, b) => `${a.first_name}`.localeCompare(`${b.first_name}`)),
    [storeUsers],
  );

  const [working, setWorking] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [toast, setToast] = useState(null);
  const [localParsed, setLocalParsed] = useState(null);

  const parsed = localParsed || readParsed(sub);

  useEffect(() => {
    if (!sub?._id || !appUserId || !canView) return;
    if (sub.opened_at) return;
    if (['converted', 'discarded', 'spam'].includes(sub.status)) return;
    let cancelled = false;
    (async () => {
      const now = new Date().toISOString();
      const fields = {
        opened_by_id: appUserId,
        opened_at: now,
        status: sub.status === 'new' ? 'opened' : sub.status,
        updated_at: now,
      };
      try {
        await updateInboundSubmission(sub._id, fields);
        if (cancelled) return;
        mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, ...fields } });
        await logInboundEvent({
          submissionId: sub.id,
          actorId: appUserId,
          action: 'opened',
          detail: 'First opened',
        });
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [sub?._id, sub?.opened_at, appUserId, canView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView) {
    return <div style={{ padding: 48 }}><p>Access restricted.</p></div>;
  }

  if (!sub) {
    return (
      <div style={{ padding: 28 }}>
        <button type="button" onClick={() => navigate('/inbound-submissions')} style={ghostBtn}>← Back</button>
        <p style={{ marginTop: 16, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Submission not found.</p>
      </div>
    );
  }

  const isTerminal = ['converted', 'discarded', 'spam'].includes(sub.status);
  const opener = sub.opened_by_id ? users.find((u) => u.id === sub.opened_by_id) : null;
  const converter = sub.converted_by_id ? users.find((u) => u.id === sub.converted_by_id) : null;

  async function assignTo(userId) {
    setWorking(true);
    try {
      const now = new Date().toISOString();
      const fields = { assigned_to_id: userId || '', updated_at: now };
      await updateInboundSubmission(sub._id, fields);
      mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, ...fields } });
      await logInboundEvent({
        submissionId: sub.id, actorId: appUserId, action: 'assigned',
        detail: userId ? `Assigned to ${userId}` : 'Unassigned',
      });
      setToast('Assignment updated');
    } catch (e) {
      setToast(`Error: ${e.message}`);
    } finally {
      setWorking(false);
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function reparse() {
    const next = parseInboundEmail({
      subject: sub.subject,
      body_text: sub.body_text,
      body_html: sub.body_html,
      from_name: sub.from_name,
      from_email: sub.from_email,
    });
    setLocalParsed(next);
    if (!canManage && !canView) return;
    try {
      await updateInboundSubmission(sub._id, { parsed: next, updated_at: new Date().toISOString() });
      mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, parsed: next } });
      await logInboundEvent({
        submissionId: sub.id, actorId: appUserId, action: 'parse_updated', detail: 'Re-ran heuristic parse',
      });
    } catch { /* */ }
  }

  async function discard(asSpam = false) {
    setWorking(true);
    try {
      const now = new Date().toISOString();
      const fields = {
        status: asSpam ? 'spam' : 'discarded',
        discard_reason: discardReason || (asSpam ? 'spam' : 'discarded'),
        discard_explanation: discardReason,
        discarded_by_id: appUserId,
        discarded_at: now,
        updated_at: now,
      };
      await updateInboundSubmission(sub._id, fields);
      mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, ...fields } });
      await logInboundEvent({
        submissionId: sub.id, actorId: appUserId, action: 'discarded',
        detail: fields.discard_reason,
      });
      setDiscardOpen(false);
      setToast(asSpam ? 'Marked as spam' : 'Discarded');
    } catch (e) {
      setToast(`Error: ${e.message}`);
    } finally {
      setWorking(false);
      setTimeout(() => setToast(null), 2500);
    }
  }

  return (
    <div style={{ padding: '20px 28px', maxWidth: 960, margin: '0 auto' }}>
      <button type="button" onClick={() => navigate('/inbound-submissions')} style={{ ...ghostBtn, marginBottom: 14 }}>← Back to queue</button>

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', background: palette.primaryDeepPlum.hex }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba('#fff', 0.55), marginBottom: 4 }}>
            Inbound #{sub.submission_number || '—'} · {sub.status}
          </p>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{sub.subject || '(no subject)'}</h1>
          <p style={{ fontSize: 12.5, color: hexToRgba('#fff', 0.6) }}>
            Received {sub.received_at ? new Date(sub.received_at).toLocaleString() : '—'}
            {sub.source === 'manual' ? ' · Manual entry' : ' · Email'}
          </p>
        </div>

        <div style={{ padding: '18px 22px', display: 'grid', gap: 16 }}>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.accentBlue.hex, 0.08), borderLeft: `3px solid ${palette.accentBlue.hex}` }}>
            <p style={{ fontSize: 10.5, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.accentBlue.hex, marginBottom: 4 }}>
              Sender / referrer (not the patient)
            </p>
            <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>
              {sub.from_name || 'Unknown name'}
            </p>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{sub.from_email || '—'}</p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            {opener && <span>Opened by {opener.first_name} {opener.last_name}{sub.opened_at ? ` · ${new Date(sub.opened_at).toLocaleString()}` : ''}</span>}
            {converter && <span>Converted by {converter.first_name} {converter.last_name}{sub.converted_at ? ` · ${new Date(sub.converted_at).toLocaleString()}` : ''}</span>}
            {sub.converted_referral_id && (
              <span>Referral {sub.converted_referral_id} ({sub.convert_mode || 'lead'})</span>
            )}
          </div>

          {canAssign && !isTerminal && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Assign to</span>
                <select
                  value={sub.assigned_to_id || ''}
                  disabled={working}
                  onChange={(e) => assignTo(e.target.value)}
                  style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13 }}
                >
                  <option value="">— unassigned —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name}{oooOptionSuffix(u)}</option>
                  ))}
                </select>
              </div>
              {(() => {
                const assignee = users.find((u) => u.id === sub.assigned_to_id);
                if (!isUserOoo(assignee)) return null;
                return (
                  <p style={{
                    margin: 0, fontSize: 12, fontWeight: 550, color: palette.accentOrange.hex,
                    padding: '6px 10px', borderRadius: 8,
                    background: hexToRgba(palette.accentOrange.hex, 0.1),
                  }}>
                    Assignee is out of office{oooWindowLabel(assignee) ? ` (${oooWindowLabel(assignee)})` : ''}. Assignment still allowed.
                  </p>
                );
              })()}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 750, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Suggested fields (heuristic — confirm before use)
              </p>
              <button type="button" onClick={reparse} style={{ ...ghostBtn, fontSize: 11 }}>Re-parse</button>
            </div>
            <ParseSuggestionChips parsed={parsed} />
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 750, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
              Message
            </p>
            {sub.body_html ? (
              <div
                style={{ padding: 14, borderRadius: 10, border: '1px solid var(--color-border)', fontSize: 13.5, lineHeight: 1.55, color: palette.backgroundDark.hex, maxHeight: 420, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: sanitizeBasicHtml(sub.body_html) }}
              />
            ) : (
              <pre style={{ margin: 0, padding: 14, borderRadius: 10, border: '1px solid var(--color-border)', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: palette.backgroundDark.hex, maxHeight: 420, overflow: 'auto' }}>
                {sub.body_text || '(empty body)'}
              </pre>
            )}
          </div>

          {attachments.length > 0 && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 750, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
                Attachments
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {attachments.map((a) => (
                  <li key={a._id || a.id}>{a.file_name || a.id} {a.content_type ? `(${a.content_type})` : ''}</li>
                ))}
              </ul>
            </div>
          )}

          {!isTerminal && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
              {canConvertLead && (
                <button type="button" onClick={() => navigate(`/inbound-submissions/${sub.id}/convert?mode=lead`)} style={primaryBtn}>
                  Convert to Lead
                </button>
              )}
              {canConvertRef && (
                <button type="button" onClick={() => navigate(`/inbound-submissions/${sub.id}/convert?mode=referral`)} style={{ ...primaryBtn, background: palette.accentGreen.hex }}>
                  Convert to Referral
                </button>
              )}
              {canDiscard && (
                <button type="button" onClick={() => setDiscardOpen(true)} style={ghostBtn}>
                  Discard…
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {discardOpen && (
        <div onClick={(e) => e.target === e.currentTarget && setDiscardOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9996, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 400 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Discard this submission?</h3>
            <textarea value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} placeholder="Reason (optional)" rows={3} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={() => setDiscardOpen(false)} style={ghostBtn}>Cancel</button>
              <button type="button" disabled={working} onClick={() => discard(true)} style={ghostBtn}>Spam</button>
              <button type="button" disabled={working} onClick={() => discard(false)} style={{ ...primaryBtn, background: palette.primaryMagenta.hex }}>Discard</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: palette.backgroundDark.hex, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
