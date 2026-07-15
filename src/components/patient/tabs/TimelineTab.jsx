import { useState, useEffect } from 'react';
import { getStageHistory } from '../../../api/stageHistory.js';
import { getNotesByPatient } from '../../../api/notes.js';
import { getConflictsByReferral } from '../../../api/conflicts.js';
import { getTriageAdult, getTriagePediatric } from '../../../api/triage.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { conflictCategoryLabel, normalizeSeverity } from '../../../utils/conflictFlagging.js';
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

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

// Format a calendar date (YYYY-MM-DD or ISO) without a timezone shift.
function fmtCalendarDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Build milestone timeline entries from the referral's own persisted
// timestamp fields. This is the resilient source of truth for the clinical /
// scheduling journey — it does not depend on StageHistory (whose writes can be
// blocked by legacy locked select columns).
function referralMilestones(referral) {
  if (!referral) return [];
  const r = referral;
  const out = [];
  const push = (id, ts, title, detail, actor) => {
    if (!ts) return;
    out.push({ _id: id, type: 'milestone', timestamp: ts, title, detail: detail || null, actor: actor || null });
  };

  push('ms-clin-pushed', r.clinical_review_pushed_at, 'Pushed to Clinical RN Review', null, null);

  if (r.clinical_review_completed_at) {
    const decision = (r.clinical_review_decision || '').toLowerCase();
    const decLabel = decision === 'accept' ? 'Accepted'
      : decision === 'conditional' ? 'Accepted (conditional)'
      : decision ? decision.charAt(0).toUpperCase() + decision.slice(1)
      : null;
    push('ms-clin-done', r.clinical_review_completed_at, 'Clinical RN review completed',
      decLabel ? `Decision: ${decLabel}` : null,
      r.clinical_review_completed_by_id || r.clinical_review_by || null);
  }

  push('ms-elig-done', r.eligibility_completed_at, 'Eligibility completed', null, r.eligibility_completed_by_id || null);
  push('ms-emr-initial', r.emr_initial_onboarded_at, 'Initial EMR onboarding completed', 'HCHB chart created during Intake', r.emr_initial_onboarded_by_id || null);
  push('ms-emr', r.emr_onboarded_at, 'EMR onboarding completed', null, r.emr_onboarded_by_id || null);
  push('ms-staffing', r.staffing_confirmed_at, 'Staffing confirmed — clinician matched', 'Sent to Pre-SOC', r.staffing_confirmed_by_id || null);
  // Prefer the precise scheduling timestamp; fall back to the SOC date itself
  // for referrals scheduled before `soc_scheduled_at` was captured.
  push('ms-soc-sched', r.soc_scheduled_at || r.soc_scheduled_date, 'SOC scheduled',
    r.soc_scheduled_date ? `SOC date: ${fmtCalendarDate(r.soc_scheduled_date)}` : null,
    r.soc_scheduled_by_id || null);
  push('ms-soc-done', r.soc_completed_date, 'SOC completed', null, null);

  if (r.recent_hospitalization === true || r.recent_hospitalization === 'true') {
    // Hospitalization has no event timestamp; anchor it to the hospitalization
    // date so it lands in chronological context.
    push('ms-hosp', r.hospitalization_date, 'Recent hospitalization',
      r.hospitalization_date ? `Hospitalized ${fmtCalendarDate(r.hospitalization_date)}` : null, null);
  }

  return out;
}

// Replace bare `usr_###` tokens in free text with the resolved user name.
// Historical notes (e.g. "Owner assigned: usr_006") were written before
// the codebase started resolving names at write time. Sanitizing at
// render time keeps human-facing text human, with no data migration.
function humanizeUserIds(text, resolveUser) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\busr_[A-Za-z0-9_-]+\b/g, (id) => {
    const name = resolveUser?.(id);
    return name && name !== '—' ? name : id;
  });
}

export default function TimelineTab({ patient, referral }) {
  const { resolveUser, resolveMarketer } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const [history, setHistory]   = useState([]);
  const [notes, setNotes]       = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [triage, setTriage]     = useState(null);
  const [loading, setLoading]   = useState(true);

  const isSpecialNeeds = patient?.division === 'Special Needs';
  const age            = calcAge(patient?.dob);
  const isPediatric    = age !== null && age < 18;

  useEffect(() => {
    if (!patient?.id) { setLoading(false); return; }
    setLoading(true);

    const histFetch = referral?.id
      ? getStageHistory(referral.id)
          .then((recs) => recs.map((r) => ({ _id: r.id, ...r.fields })))
          .catch(() => [])
      : Promise.resolve([]);

    const noteFetch = getNotesByPatient(patient.id)
      .then((recs) => recs.map((r) => ({ _id: r.id, ...r.fields })))
      .catch(() => []);

    const conflictFetch = referral?.id
      ? getConflictsByReferral(referral.id)
          .then((recs) => recs.map((r) => ({ _id: r.id, ...r.fields })))
          .catch(() => [])
      : Promise.resolve([]);

    // Fetch triage record for Special Needs patients so we can mark completion
    const triageFetch = (isSpecialNeeds && referral?.id)
      ? (isPediatric ? getTriagePediatric : getTriageAdult)(referral.id)
          .then((recs) => recs.length ? { _id: recs[0].id, ...recs[0].fields } : null)
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([histFetch, noteFetch, conflictFetch, triageFetch])
      .then(([hist, nts, cflicts, tri]) => {
        setHistory(hist);
        setNotes(nts);
        setConflicts(cflicts);
        setTriage(tri);
      })
      .finally(() => setLoading(false));
  }, [patient?.id, referral?.id, isSpecialNeeds, isPediatric]);

  // ── Stage-transition notes ───────────────────────────────────────────────
  // `recordTransition` writes BOTH a StageHistory row AND a Note formatted
  // like `[Lead Entry → Intake]\n<reason>`. To avoid showing two entries
  // for one transition (and to drop the misleading "Note added" header),
  // we parse stage-transition notes and merge them into the corresponding
  // StageHistory entry. Plain (non-transition) notes still render normally.
  function parseStageTransitionNote(content) {
    if (!content) return null;
    const m = content.match(/^\[([^\]]+?)\s*(?:→|->)\s*([^\]]+?)\]\s*\n?([\s\S]*)$/);
    if (!m) return null;
    return { fromStage: m[1].trim(), toStage: m[2].trim(), body: (m[3] || '').trim() };
  }

  const stageNotes = [];
  const plainNotes = [];
  for (const n of notes) {
    const parsed = parseStageTransitionNote(n.content);
    if (parsed) stageNotes.push({ note: n, ...parsed });
    else plainNotes.push(n);
  }

  const matchedNoteIds = new Set();
  const stageEntries = history.map((h) => {
    const histTime = new Date(h.timestamp || 0).getTime();
    const match = stageNotes.find(
      (sn) =>
        !matchedNoteIds.has(sn.note._id) &&
        sn.toStage === h.to_stage &&
        Math.abs(new Date(sn.note.created_at || 0).getTime() - histTime) < 60_000,
    );
    if (match) matchedNoteIds.add(match.note._id);
    return {
      _id: h._id,
      type: 'stage',
      timestamp: h.timestamp,
      title: h.to_stage
        ? `Stage change: ${h.from_stage || '—'} → ${h.to_stage}`
        : 'Stage updated',
      // Render any reason text as expandable body (same look as a note)
      noteContent: match?.body || h.reason || null,
      actor: match?.note.author_id || h.changed_by_id || null,
      fromStage: h.from_stage || null,
      toStage: h.to_stage || null,
    };
  });

  // Stage-transition notes that didn't pair with a StageHistory row
  // (e.g. history failed to write, or ordering is off). Show them anyway
  // so the user never loses the audit trail.
  const orphanStageNotes = stageNotes
    .filter((sn) => !matchedNoteIds.has(sn.note._id))
    .map((sn) => ({
      _id: sn.note._id,
      type: 'stage',
      timestamp: sn.note.created_at,
      title: `Stage change: ${sn.fromStage} → ${sn.toStage}`,
      noteContent: sn.body || null,
      actor: sn.note.author_id || null,
      fromStage: sn.fromStage,
      toStage: sn.toStage,
    }));

  const entries = [
    // Referral created — actor is a marketer, resolve with resolveMarketer
    ...(referral?.referral_date ? [{
      _id: 'referral-created',
      type: 'referral',
      timestamp: referral.referral_date,
      title: 'Referral created',
      detail: 'Entered at Lead Entry stage',
      actor: referral.marketer_id || null,
      actorResolved: referral.marketer_id ? resolveMarketer(referral.marketer_id) : null,
    }] : []),

    // Stage transitions (StageHistory + paired notes)
    ...stageEntries,
    ...orphanStageNotes,

    // Plain notes (not stage-transition notes)
    ...plainNotes.map((n) => ({
      _id: n._id,
      type: 'note',
      timestamp: n.created_at,
      title: 'Note added',
      noteContent: n.content,
      actor: n.author_id,
    })),

    // Conflicts (flagged + resolved)
    ...conflicts.flatMap((c) => {
      const categoryLabel = conflictCategoryLabel(c.type);
      const description   = c.description || c.details || '';
      const displaySeverity = normalizeSeverity(c.severity);
      const out = [{
        _id: `conflict-flagged-${c._id}`,
        type: 'conflict',
        timestamp: c.created_at,
        title: `${categoryLabel} conflict`,
        detail: displaySeverity ? `Severity: ${displaySeverity}` : null,
        noteContent: description || null,
        actor: c.flagged_by_id || c.created_by_id || null,
        severity: displaySeverity || null,
        status: c.status || 'Unaddressed',
      }];
      if (c.resolved_at && (c.status === 'Resolved' || c.status === 'Waived')) {
        out.push({
          _id: `conflict-resolved-${c._id}`,
          type: 'conflict-resolved',
          timestamp: c.resolved_at,
          title: `${categoryLabel} conflict ${c.status === 'Waived' ? 'waived' : 'resolved'}`,
          // Render the resolution note as expandable body content (same look
          // as a Note entry) so the full text is visible on the timeline.
          noteContent: c.resolution_note || null,
          actor: c.resolved_by_id || null,
        });
      }
      return out;
    }),

    // Triage milestone — only for Special Needs patients that have a completed form
    ...(triage?.created_at ? [{
      _id: 'triage-completed',
      type: 'milestone',
      timestamp: triage.created_at,
      title: 'Initial Triage Completed',
      detail: isPediatric ? 'Pediatric Special Needs triage form' : 'Adult Special Needs triage form',
      actor: triage.filled_by_id || null,
    }] : []),

    // Clinical / scheduling milestones synthesised from the referral's own
    // persisted timestamps. These are reliable even when a StageHistory row
    // failed to write, so the journey (clinical accepted, eligibility done,
    // EMR onboarded, staffing confirmed, SOC scheduled/completed) always shows.
    ...referralMilestones(referral),
  ].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

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

  // actorResolved takes precedence (used for marketers and pre-resolved names)
  const actorName = entry.actorResolved || (entry.actor ? resolveUser(entry.actor) : null);
  const isMe = entry.actor === appUserId;

  const isMilestone       = entry.type === 'milestone';
  const isNote            = entry.type === 'note';
  const isStage           = entry.type === 'stage';
  const isConflict        = entry.type === 'conflict';
  const isConflictResolved = entry.type === 'conflict-resolved';

  const dotColor =
    isConflict         ? palette.primaryMagenta.hex :
    isConflictResolved ? palette.accentGreen.hex :
    isMilestone        ? palette.accentGreen.hex :
    isNote             ? palette.accentBlue.hex :
    isStage            ? palette.primaryDeepPlum.hex :
    entry.type === 'referral' ? palette.accentGreen.hex :
    palette.primaryMagenta.hex;

  const hasLongContent = (isNote || isStage || isConflict || isConflictResolved) && (entry.noteContent || '').length > 120;

  const isFilledDot = isMilestone || isConflict || isConflictResolved || isStage;

  return (
    <div style={{ display: 'flex', gap: 14, paddingBottom: isLast ? 0 : 22, position: 'relative' }}>
      {/* Dot */}
      <div style={{
        width: isFilledDot ? 32 : 28,
        height: isFilledDot ? 32 : 28,
        borderRadius: '50%', flexShrink: 0,
        background: isFilledDot ? dotColor : palette.backgroundLight.hex,
        border: `2px solid ${isFilledDot ? dotColor : hexToRgba(dotColor, 0.4)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1, marginTop: 1,
        marginLeft: isFilledDot ? -2 : 0,
        boxShadow: isFilledDot ? `0 0 0 3px ${hexToRgba(dotColor, 0.18)}` : 'none',
      }}>
        {isConflict ? (
          // Triangle-with-bang icon for active conflict
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l10 18H2L12 3z" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"/>
            <path d="M12 10v5M12 18.5v.01" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        ) : isConflictResolved ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : isStage ? (
          // Right-arrow icon for a stage change
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 5l7 7-7 7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : isMilestone ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : isNote ? (
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
      <div style={{ flex: 1, paddingTop: isFilledDot ? 5 : 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: isNote || isStage || isConflict ? 6 : 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{
              fontSize: isFilledDot ? 13.5 : 13,
              fontWeight: isFilledDot ? 700 : 650,
              color: isFilledDot ? dotColor : palette.backgroundDark.hex,
              lineHeight: 1.3,
            }}>
              {entry.title}
            </p>
            {isConflict && entry.severity && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                color: palette.primaryMagenta.hex,
                letterSpacing: '0.04em',
              }}>
                {entry.severity}
              </span>
            )}
            {isConflict && entry.status && entry.status !== 'Unaddressed' && entry.status !== 'Open' && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                background: hexToRgba(palette.backgroundDark.hex, 0.07),
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
                letterSpacing: '0.04em',
              }}>
                {entry.status}
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38), whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtFull(entry.timestamp)}</p>
        </div>

        {/* Note / stage / conflict / resolution description content */}
        {(isNote || isStage || isConflict || isConflictResolved) && entry.noteContent && (
          <div style={{ marginBottom: 5 }}>
            {isConflictResolved && (
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 3 }}>
                Resolution note
              </p>
            )}
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: expanded ? 'block' : '-webkit-box', WebkitLineClamp: expanded ? undefined : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {humanizeUserIds(entry.noteContent, resolveUser)}
            </p>
            {hasLongContent && (
              <button onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11.5, color: palette.accentBlue.hex, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {/* Milestone / referral detail (non-note, non-conflict, non-stage types) */}
        {!isNote && !isStage && !isConflict && !isConflictResolved && entry.detail && (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.4, marginBottom: 4, fontStyle: 'italic' }}>{entry.detail}</p>
        )}

        {/* Actor */}
        {actorName && actorName !== '—' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
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
