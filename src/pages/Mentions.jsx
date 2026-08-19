import { useMemo, useState } from 'react';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { extractUserMentionIds } from '../utils/mentions.js';
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

/**
 * All Mentions — every note where the signed-in user is @mentioned, newest
 * first. Unlike the notification bell (which caps its list and fades once
 * read), this page is the permanent record: the note, who wrote it, and a
 * synopsis card of the patient it belongs to. Click to open the patient.
 */
export default function Mentions() {
  const { appUserId } = useCurrentAppUser();
  const { resolveUser, resolveFacility, resolveMarketer } = useLookups();
  const { open: openPatient } = usePatientDrawer();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');

  const storeNotes = useCareStore((s) => s.notes);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);

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
      })
      .sort((a, b) => new Date(b.note.created_at || 0) - new Date(a.note.created_at || 0));
  }, [appUserId, storeNotes, patientsByBusinessId, referralsList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mentions;
    return mentions.filter((m) => {
      const author = m.note.author_id ? resolveUser(m.note.author_id) : '';
      const hay = [m.patientName, m.note.content, author].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [mentions, search, resolveUser]);

  function handleOpen(m) {
    const patient = m.patient || { id: m.note.patient_id, _id: m.note.patient_id };
    openPatient(patient, m.referral, 'notes', { focusNoteId: m.note.id || m.note._id || null });
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>
            Mentions
          </h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
            Every note where you are @mentioned.
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient, note, author…"
          style={{
            padding: '7px 12px', borderRadius: 8, border: `1px solid var(--color-border)`,
            fontSize: 12.5, width: isMobile ? '100%' : 240, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

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
          No mentions match “{search}”.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {filtered.length} mention{filtered.length !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((m) => (
              <MentionCard
                key={m.note._id || m.note.id}
                m={m}
                isMobile={isMobile}
                resolveUser={resolveUser}
                resolveFacility={resolveFacility}
                resolveMarketer={resolveMarketer}
                appUserId={appUserId}
                onOpen={() => handleOpen(m)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MentionCard({ m, isMobile, resolveUser, resolveFacility, resolveMarketer, appUserId, onOpen }) {
  const { note, patient, referral, patientName } = m;
  const author = note.author_id ? resolveUser(note.author_id) : 'Unknown';
  const age = ageFromDob(patient?.dob);

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 0,
        borderRadius: 12, border: `1px solid var(--color-border)`,
        background: palette.backgroundLight.hex, overflow: 'hidden',
        cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 16px ${hexToRgba(palette.backgroundDark.hex, 0.08)}`;
        e.currentTarget.style.borderColor = hexToRgba(palette.primaryMagenta.hex, 0.3);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      {/* The note */}
      <div style={{ flex: 1, minWidth: 0, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>{author}</span>
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{timeAgo(note.created_at)}</span>
          {(note.is_pinned === true || note.is_pinned === 'true') && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: hexToRgba(palette.highlightYellow.hex, 0.2), color: '#7A5F00', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pinned
            </span>
          )}
        </div>
        <MentionText
          content={note.content}
          resolveUser={resolveUser}
          highlightUserId={appUserId}
          style={{ fontSize: 13, lineHeight: 1.55, color: hexToRgba(palette.backgroundDark.hex, 0.85) }}
        />
      </div>

      {/* Patient synopsis */}
      <div style={{
        width: isMobile ? '100%' : 250, flexShrink: 0,
        padding: '14px 16px',
        background: hexToRgba(palette.primaryDeepPlum.hex, 0.035),
        borderLeft: isMobile ? 'none' : `1px solid var(--color-border)`,
        borderTop: isMobile ? `1px solid var(--color-border)` : 'none',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
          {patientName}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {referral?.division && <DivisionBadge division={referral.division} size="small" />}
          {referral?.current_stage && <StageBadge stage={referral.current_stage} size="small" />}
        </div>
        <div style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.6 }}>
          {patient?.dob && (
            <div>DOB {fmtCalendarDate(patient.dob, '—')}{age != null ? ` · ${age} yrs` : ''}</div>
          )}
          {referral?.facility_id && resolveFacility(referral.facility_id) !== '—' && (
            <div>Facility: {resolveFacility(referral.facility_id)}</div>
          )}
          {referral?.marketer_id && resolveMarketer(referral.marketer_id) !== '—' && (
            <div>Marketer: {resolveMarketer(referral.marketer_id)}</div>
          )}
          {referral?.intake_owner_id && resolveUser(referral.intake_owner_id) !== '—' && (
            <div>Intake: {resolveUser(referral.intake_owner_id)}</div>
          )}
          {referral?.referral_date && (
            <div>Referred {fmtCalendarDate(referral.referral_date, '—')}</div>
          )}
        </div>
        <span style={{ marginTop: 'auto', fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex }}>
          Open patient →
        </span>
      </div>
    </div>
  );
}
