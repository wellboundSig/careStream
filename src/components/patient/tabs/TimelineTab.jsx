import { useState, useEffect } from 'react';
import { getStageHistory } from '../../../api/stageHistory.js';
import { getNotesByPatient } from '../../../api/notes.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function fmtFull(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export default function TimelineTab({ patient, referral }) {
  const { resolveUser } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const [history, setHistory] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patient?.id) { setLoading(false); return; }
    setLoading(true);

    const fetches = [
      referral?.id
        ? getStageHistory(referral.id).then((recs) => recs.map((r) => ({ _id: r.id, ...r.fields }))).catch(() => [])
        : Promise.resolve([]),
      getNotesByPatient(patient.id).then((recs) => recs.map((r) => ({ _id: r.id, ...r.fields }))).catch(() => []),
    ];

    Promise.all(fetches)
      .then(([hist, nts]) => { setHistory(hist); setNotes(nts); })
      .finally(() => setLoading(false));
  }, [patient?.id, referral?.id]);

  const entries = [
    // Referral created
    ...(referral?.referral_date ? [{
      _id: 'referral-created',
      type: 'referral',
      timestamp: referral.referral_date,
      title: 'Referral created',
      detail: `Entered at Lead Entry stage`,
      actor: referral.marketer_id || null,
    }] : []),
    // Stage transitions
    ...history.map((h) => ({
      _id: h._id,
      type: 'stage',
      timestamp: h.timestamp,
      title: h.to_stage ? `→ ${h.to_stage}` : 'Stage updated',
      detail: h.reason || null,
      actor: h.changed_by_id || null,
      fromStage: h.from_stage,
    })),
    // Notes
    ...notes.map((n) => ({
      _id: n._id,
      type: 'note',
      timestamp: n.created_at,
      title: 'Note added',
      noteContent: n.content,
      actor: n.author_id,
    })),
  ].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0)); // oldest first

  if (loading) return <LoadingState message="Loading timeline..." size="small" />;

  if (entries.length === 0) {
    return <p style={{ padding: '32px 20px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), textAlign: 'center', fontStyle: 'italic' }}>No timeline events yet.</p>;
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 20 }}>
        Showing {entries.length} event{entries.length !== 1 ? 's' : ''} · oldest first
      </p>

      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 1.5, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {entries.map((entry, i) => (
            <TimelineEntry
              key={entry._id}
              entry={entry}
              resolveUser={resolveUser}
              appUserId={appUserId}
              isLast={i === entries.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineEntry({ entry, resolveUser, appUserId, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const actorName = entry.actor ? resolveUser(entry.actor) : null;
  const isMe = entry.actor === appUserId;

  const dotColor =
    entry.type === 'note' ? palette.accentBlue.hex :
    entry.type === 'referral' ? palette.accentGreen.hex :
    palette.primaryMagenta.hex;

  const isNote = entry.type === 'note';
  const hasLongContent = isNote && (entry.noteContent || '').length > 120;

  return (
    <div style={{ display: 'flex', gap: 14, paddingBottom: isLast ? 0 : 22, position: 'relative' }}>
      {/* Dot */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: palette.backgroundLight.hex,
        border: `2px solid ${hexToRgba(dotColor, 0.4)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1, marginTop: 1,
      }}>
        {isNote ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={dotColor} strokeWidth="2" strokeLinejoin="round"/>
          </svg>
        ) : entry.type === 'referral' ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke={dotColor} strokeWidth="2"/>
            <path d="M12 8v4l3 3" stroke={dotColor} strokeWidth="2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" stroke={dotColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: isNote ? 6 : 2 }}>
          <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.3 }}>{entry.title}</p>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFull(entry.timestamp)}</p>
        </div>

        {/* Note content */}
        {isNote && entry.noteContent && (
          <div style={{ marginBottom: 5 }}>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: expanded ? 'block' : '-webkit-box', WebkitLineClamp: expanded ? undefined : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {entry.noteContent}
            </p>
            {hasLongContent && (
              <button onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11.5, color: palette.accentBlue.hex, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {/* Stage detail */}
        {!isNote && entry.detail && (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4, marginBottom: 4, fontStyle: 'italic' }}>{entry.detail}</p>
        )}

        {/* Actor */}
        {actorName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              background: isMe ? hexToRgba(palette.primaryMagenta.hex, 0.14) : hexToRgba(palette.accentBlue.hex, 0.12),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8.5, fontWeight: 800,
              color: isMe ? palette.primaryMagenta.hex : palette.accentBlue.hex,
            }}>
              {initials(actorName)}
            </div>
            <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
              {isMe ? `${actorName} (you)` : actorName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
