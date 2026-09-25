import { useMemo, useState } from 'react';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { extractUserMentionIds } from '../utils/mentions.js';
import {
  attachMentionStates,
  sortMentionInbox,
  applyMentionFilter,
  MENTION_FILTERS,
} from '../utils/mentionInbox.js';
import { setMentionState } from '../api/mentionStates.js';
import MentionText from '../components/common/MentionText.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import { fmtCalendarDate } from '../utils/dateFormat.js';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function PinIcon({ filled }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" /><path d="M9 10.76V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3.76a2 2 0 0 0 .59 1.41l1.7 1.7a1 1 0 0 1 .29.71V16a1 1 0 0 1-1 1H7.42a1 1 0 0 1-1-1v-1.42a1 1 0 0 1 .3-.7l1.7-1.71a2 2 0 0 0 .58-1.41Z" />
    </svg>
  );
}

function CheckIcon({ filled }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" fill={filled ? 'currentColor' : 'none'} />
      <path d="m8.5 12 2.3 2.3L15.5 9.7" stroke={filled ? '#fff' : 'currentColor'} />
    </svg>
  );
}

/**
 * All Mentions — inbox of every note where the signed-in user is @mentioned.
 * Pinned rows stay on top, open rows next (newest first), Done rows sink to
 * the bottom with a grey background. Done/pinned are personal state
 * (mention_states), never touching the note itself.
 */
export default function Mentions() {
  const { appUserId } = useCurrentAppUser();
  const { resolveUser, resolveFacility, resolveMarketer } = useLookups();
  const { open: openPatient } = usePatientDrawer();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  const storeNotes = useCareStore((s) => s.notes);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);
  const storeMentionStates = useCareStore((s) => s.mentionStates);

  const patientsByBusinessId = useMemo(() => {
    const map = {};
    for (const p of Object.values(storePatients || {})) {
      if (p?.id) map[p.id] = p;
    }
    return map;
  }, [storePatients]);

  const referralsList = useMemo(() => Object.values(storeReferrals || {}), [storeReferrals]);

  const mentions = useMemo(() => {
    if (!appUserId) return [];
    return Object.values(storeNotes || {})
      .filter((n) => n?.content && extractUserMentionIds(n.content).includes(appUserId))
      .map((note) => {
        const patient = patientsByBusinessId[note.patient_id] || null;
        const referral =
          (note.referral_id && referralsList.find((r) => r.id === note.referral_id))
          || referralsList.find((r) => r.patient_id === note.patient_id)
          || null;
        const patientName = patient
          ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || note.patient_id
          : (note.patient_id || 'Unknown patient');
        return { note, patient, referral, patientName };
      });
  }, [appUserId, storeNotes, patientsByBusinessId, referralsList]);

  const inbox = useMemo(
    () => sortMentionInbox(attachMentionStates(mentions, storeMentionStates, appUserId)),
    [mentions, storeMentionStates, appUserId],
  );

  const filtered = useMemo(() => {
    let list = applyMentionFilter(inbox, filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const author = m.note.author_id ? resolveUser(m.note.author_id) : '';
        const hay = [m.patientName, m.note.content, author].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [inbox, filter, search, resolveUser]);

  function handleOpen(m) {
    const patient = m.patient || { id: m.note.patient_id, _id: m.note.patient_id };
    openPatient(patient, m.referral, 'notes', { focusNoteId: m.note.id || m.note._id || null });
  }

  async function toggleDone(m) {
    const next = !m.isDone;
    const now = new Date().toISOString();
    try {
      await setMentionState(appUserId, m.noteId, { is_done: next, done_at: next ? now : null });
    } catch (err) {
      setError(err?.message || 'Could not save');
      setTimeout(() => setError(null), 3000);
    }
  }

  async function togglePin(m) {
    const next = !m.isPinned;
    const now = new Date().toISOString();
    try {
      await setMentionState(appUserId, m.noteId, { is_pinned: next, pinned_at: next ? now : null });
    } catch (err) {
      setError(err?.message || 'Could not save');
      setTimeout(() => setError(null), 3000);
    }
  }

  const openCount = inbox.filter((m) => !m.isDone).length;

  return (
    <div style={{ padding: isMobile ? '16px 0 0' : '24px 0 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap', padding: isMobile ? '0 16px' : '0 24px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>
            Mentions
          </h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
            Every note where you are @mentioned. {openCount > 0 ? `${openCount} open.` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {MENTION_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  padding: '5px 11px', borderRadius: 16, border: 'none', cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 650,
                  background: filter === f.id ? hexToRgba(palette.primaryMagenta.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.05),
                  color: filter === f.id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, note, author…"
            style={{
              padding: '7px 12px', borderRadius: 8, border: `1px solid var(--color-border)`,
              fontSize: 12.5, width: isMobile ? '100%' : 230, outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: palette.accentOrange.hex, margin: '0 0 10px', padding: isMobile ? '0 16px' : '0 24px' }}>{error}</p>
      )}

      {mentions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <p style={{ fontSize: 14, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: 0 }}>
            No mentions yet
          </p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '8px 0 0', lineHeight: 1.5 }}>
            When a teammate @mentions you in a patient note, it will appear here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '32px 0', fontStyle: 'italic' }}>
          No mentions match.
        </p>
      ) : (
        <div style={{ borderTop: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, width: '100%' }}>
          {filtered.map((m, i) => (
            <MentionRow
              key={m.note._id || m.note.id}
              m={m}
              isLast={i === filtered.length - 1}
              isMobile={isMobile}
              resolveUser={resolveUser}
              resolveFacility={resolveFacility}
              resolveMarketer={resolveMarketer}
              appUserId={appUserId}
              onOpen={() => handleOpen(m)}
              onToggleDone={() => toggleDone(m)}
              onTogglePin={() => togglePin(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MentionRow({ m, isLast, isMobile, resolveUser, resolveFacility, resolveMarketer, appUserId, onOpen, onToggleDone, onTogglePin }) {
  const { note, patient, referral, patientName, isDone, isPinned } = m;
  const [hovered, setHovered] = useState(false);
  const author = note.author_id ? resolveUser(note.author_id) : 'Unknown';
  const age = ageFromDob(patient?.dob);

  const baseBg = isDone
    ? hexToRgba(palette.backgroundDark.hex, 0.045)
    : palette.backgroundLight.hex;
  // Hover: a subtle but clearly pink tint, distinct from the grey Done rows.
  const bg = hovered ? hexToRgba(palette.primaryMagenta.hex, 0.07) : baseBg;
  const mainOpacity = isDone ? 0.62 : 1;

  const showActions = hovered || isMobile;
  const iconBtn = (active, activeColor) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
    background: 'transparent',
    color: active ? activeColor : hexToRgba(palette.backgroundDark.hex, 0.45),
    // Inactive buttons appear on hover (Outlook-style); active ones always show.
    opacity: active || showActions ? 1 : 0,
    transition: 'opacity 0.12s',
    flexShrink: 0,
  });

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'stretch', gap: 0,
        background: bg, cursor: 'pointer',
        borderBottom: isLast ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
        transition: 'background 0.1s',
      }}
    >
      {/* The note */}
      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '11px 14px' : '11px 14px 11px 24px', opacity: mainOpacity }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
          {isPinned && (
            <span style={{ color: palette.primaryMagenta.hex, position: 'relative', top: 2 }}><PinIcon filled /></span>
          )}
          <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>{author}</span>
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{timeAgo(note.created_at)}</span>
        </div>
        <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          <MentionText
            content={note.content}
            resolveUser={resolveUser}
            highlightUserId={appUserId}
            style={{ fontSize: 12.5, lineHeight: 1.5, color: hexToRgba(palette.backgroundDark.hex, 0.82) }}
          />
        </div>
      </div>

      {/* Patient facts, on the side */}
      {!isMobile && (
        <div style={{
          width: 264, flexShrink: 0, padding: '11px 14px',
          borderLeft: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
          opacity: mainOpacity,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>{patientName}</span>
            {referral?.division && <DivisionBadge division={referral.division} size="small" />}
            {referral?.current_stage && <StageBadge stage={referral.current_stage} referral={referral} size="small" />}
          </div>
          <div style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.55 }}>
            {patient?.dob && <span>DOB {fmtCalendarDate(patient.dob, '—')}{age != null ? ` · ${age} yrs` : ''}</span>}
            {referral?.facility_id && resolveFacility(referral.facility_id) !== '—' && (
              <span> · {resolveFacility(referral.facility_id)}</span>
            )}
            <br />
            {referral?.marketer_id && resolveMarketer(referral.marketer_id) !== '—' && (
              <span>Marketer: {resolveMarketer(referral.marketer_id)} · </span>
            )}
            {referral?.intake_owner_id && resolveUser(referral.intake_owner_id) !== '—' && (
              <span>Intake: {resolveUser(referral.intake_owner_id)} · </span>
            )}
            {referral?.referral_date && <span>Referred {fmtCalendarDate(referral.referral_date, '—')}</span>}
          </div>
        </div>
      )}

      {/* Actions column at the far right: pin top-right, done bottom-right */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          alignItems: 'center', padding: '6px 8px', flexShrink: 0, alignSelf: 'stretch',
        }}
      >
        <button
          type="button"
          title={isPinned ? 'Unpin' : 'Pin to top'}
          onClick={onTogglePin}
          style={iconBtn(isPinned, palette.primaryMagenta.hex)}
        >
          <PinIcon filled={isPinned} />
        </button>
        <button
          type="button"
          title={isDone ? 'Mark as open' : 'Mark done'}
          onClick={onToggleDone}
          style={iconBtn(isDone, palette.accentGreen.hex)}
        >
          <CheckIcon filled={isDone} />
        </button>
      </div>
    </div>
  );
}
