import { useState, useEffect } from 'react';
import { getStageHistory } from '../../../api/stageHistory.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const ACTION_ICONS = {
  'Stage Change': '→',
  'Note Added': '✎',
  'File Uploaded': '↑',
  'Task Created': '☐',
  'Task Completed': '✓',
  'Insurance Check': '◎',
  'Conflict Flagged': '!',
  'Conflict Resolved': '✓',
  'Auth Submitted': '◈',
  'Auth Updated': '◈',
  'Hold Placed': '⏸',
  'Hold Released': '▶',
  'NTUC Recorded': '✕',
  'Patient Created': '★',
  'Referral Created': '★',
  'Triage Submitted': '✎',
  'Field Updated': '✎',
};

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function TimelineTab({ patient, referral }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!referral?.id) { setLoading(false); return; }
    setLoading(true);
    getStageHistory(referral.id)
      .then((records) => setHistory(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id]);

  if (loading) return <LoadingState message="Loading timeline..." size="small" />;

  const referralDate = referral?.referral_date;

  const entries = [
    ...(referralDate ? [{
      _id: 'referral-created',
      type: 'Referral Created',
      timestamp: referralDate,
      detail: `Referral entered into system at Lead Entry stage`,
      actor: referral.marketer_id || 'System',
    }] : []),
    ...history.map((h) => ({
      _id: h._id,
      type: 'Stage Change',
      timestamp: h.timestamp,
      detail: `${h.from_stage ? `${h.from_stage} → ` : ''}${h.to_stage}${h.reason ? ` — ${h.reason}` : ''}`,
      actor: h.changed_by_id || 'Unknown',
      from: h.from_stage,
      to: h.to_stage,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: hexToRgba(palette.backgroundDark.hex, 0.35), fontSize: 13, fontStyle: 'italic' }}>
          No timeline events recorded yet.
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 15, top: 4, bottom: 0, width: 1, background: `var(--color-border)` }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {entries.map((entry, i) => (
              <TimelineEntry key={entry._id} entry={entry} isLast={i === entries.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ entry, isLast }) {
  const isStageChange = entry.type === 'Stage Change';

  return (
    <div style={{ display: 'flex', gap: 16, paddingBottom: isLast ? 0 : 20, position: 'relative' }}>
      <div
        style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${isStageChange ? hexToRgba(palette.primaryMagenta.hex, 0.3) : hexToRgba(palette.accentBlue.hex, 0.2)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13,
          color: isStageChange ? palette.primaryMagenta.hex : palette.accentBlue.hex,
          zIndex: 1,
          background: palette.backgroundLight.hex,
        }}
      >
        {ACTION_ICONS[entry.type] || '·'}
      </div>
      <div style={{ flex: 1, paddingTop: 4 }}>
        <p style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex, marginBottom: 3, lineHeight: 1.4 }}>
          {entry.detail}
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {formatDateTime(entry.timestamp)}
          </p>
          {entry.actor && entry.actor !== 'System' && (
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
              by {entry.actor}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
