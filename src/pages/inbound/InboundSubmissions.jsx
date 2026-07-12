import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  createInboundSubmission,
  logInboundEvent,
} from '../../api/inboundSubmissions.js';
import { parseInboundEmail } from '../../lib/inboundParse.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'opened', label: 'Opened' },
  { id: 'converting', label: 'Converting' },
  { id: 'converted', label: 'Converted' },
  { id: 'discarded', label: 'Discarded' },
];

const STATUS_STYLE = {
  new: { bg: hexToRgba(palette.accentBlue.hex, 0.15), text: palette.accentBlue.hex },
  opened: { bg: hexToRgba(palette.highlightYellow.hex, 0.25), text: '#7A5F00' },
  converting: { bg: hexToRgba(palette.accentOrange.hex, 0.15), text: palette.accentOrange.hex },
  converted: { bg: hexToRgba(palette.accentGreen.hex, 0.15), text: palette.accentGreen.hex },
  discarded: { bg: hexToRgba(palette.backgroundDark.hex, 0.08), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
  spam: { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
};

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function snippet(text, n = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

export default function InboundSubmissions() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const storeSubs = useCareStore((s) => s.inboundSubmissions);
  const storeUsers = useCareStore((s) => s.users);
  const hydrated = useCareStore((s) => s.hydrated);

  const canView = can(PERMISSION_KEYS.MODULE_INBOUND) || can(PERMISSION_KEYS.INBOUND_VIEW);
  const canCreate = can(PERMISSION_KEYS.INBOUND_CREATE);
  const canManage = can(PERMISSION_KEYS.INBOUND_MANAGE);

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const usersById = useMemo(() => {
    const map = {};
    Object.values(storeUsers || {}).forEach((u) => { map[u.id] = u; });
    return map;
  }, [storeUsers]);

  const submissions = useMemo(() => {
    let list = Object.values(storeSubs || {});
    if (!canManage && appUserId) {
      list = list.filter((s) => !s.assigned_to_id || s.assigned_to_id === appUserId);
    }
    if (statusFilter !== 'all') list = list.filter((s) => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        `${s.subject || ''} ${s.from_name || ''} ${s.from_email || ''} ${s.body_text || ''}`.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0));
  }, [storeSubs, statusFilter, search, canManage, appUserId]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  if (!canView) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 360, textAlign: 'center' }}>
          You need Inbound Submissions permission to view this queue.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Inbound Submissions</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            Emails to referral@inbound.wellboundcarestream.com — convert to leads or referrals
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 36, width: 220 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer' }}
            >
              + New submission
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStatusFilter(s.id)}
            style={{
              padding: '6px 12px', borderRadius: 999, border: '1px solid var(--color-border)',
              background: statusFilter === s.id ? palette.primaryDeepPlum.hex : palette.backgroundLight.hex,
              color: statusFilter === s.id ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.55),
              fontSize: 12, fontWeight: 650, cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)' }}>
        {!hydrated ? (
          <p style={{ padding: 24, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading…</p>
        ) : submissions.length === 0 ? (
          <p style={{ padding: 32, textAlign: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 13.5 }}>
            No inbound submissions yet. When email arrives at referral@inbound.wellboundcarestream.com, tickets appear here.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
                {['Status', 'From', 'Subject', 'Received', 'Assignee', ''].map((h) => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => {
                const st = STATUS_STYLE[sub.status] || STATUS_STYLE.new;
                const assignee = sub.assigned_to_id ? usersById[sub.assigned_to_id] : null;
                return (
                  <tr
                    key={sub._id || sub.id}
                    onClick={() => navigate(`/inbound-submissions/${sub.id || sub._id}`)}
                    style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: st.bg, color: st.text, textTransform: 'capitalize' }}>
                        {sub.status || 'new'}
                      </span>
                      {sub.submission_number != null && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>#{sub.submission_number}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{sub.from_name || sub.from_email || '—'}</p>
                      {sub.from_name && sub.from_email && (
                        <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub.from_email}</p>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', maxWidth: 360 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{sub.subject || '(no subject)'}</p>
                      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>{snippet(sub.body_text)}</p>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), whiteSpace: 'nowrap' }}>
                      {timeAgo(sub.received_at || sub.created_at)}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                      {assignee ? `${assignee.first_name || ''} ${assignee.last_name || ''}`.trim() : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex }}>Open →</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {manualOpen && (
        <ManualCreateModal
          appUserId={appUserId}
          onClose={() => setManualOpen(false)}
          onCreated={(sub) => {
            setManualOpen(false);
            showToast('Submission created');
            navigate(`/inbound-submissions/${sub.id}`);
          }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function ManualCreateModal({ appUserId, onClose, onCreated, onError }) {
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!body.trim() && !subject.trim()) {
      onError('Subject or body is required');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const existing = Object.values(useCareStore.getState().inboundSubmissions || {});
      const maxNum = existing.reduce((m, s) => Math.max(m, Number(s.submission_number) || 0), 0);
      const parsed = parseInboundEmail({
        subject, body_text: body, from_name: fromName, from_email: fromEmail,
      });
      const id = `inb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const fields = {
        id,
        submission_number: maxNum + 1,
        from_email: fromEmail.trim(),
        from_name: fromName.trim(),
        to_addrs: 'referral@inbound.wellboundcarestream.com',
        subject: subject.trim(),
        body_text: body.trim(),
        received_at: now,
        status: 'new',
        source: 'manual',
        provider: 'manual',
        parsed,
        created_at: now,
        updated_at: now,
      };
      const rec = await createInboundSubmission(fields);
      mergeEntities('inboundSubmissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      await logInboundEvent({
        submissionId: id,
        actorId: appUserId,
        action: 'received',
        detail: 'Manual submission created',
      }).catch(() => {});
      onCreated({ id, _id: rec.id, ...rec.fields });
    } catch (err) {
      onError(err.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 9996, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 520, padding: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>New inbound submission</h2>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 14 }}>
          Manual entry for testing or non-email intake. Sender is treated as the referrer, not the patient.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Sender name" style={inputStyle} />
          <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="Sender email" style={inputStyle} />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" style={inputStyle} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body…" rows={8} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: palette.primaryMagenta.hex, color: '#fff', fontWeight: 650, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  fontSize: 13, color: palette.backgroundDark.hex, outline: 'none', width: '100%', boxSizing: 'border-box',
};
