import { useState, useMemo, useRef } from 'react';
import { useUser } from '@clerk/react';
import { useCareStore } from '../../../store/careStore.js';
import {
  createNoteOptimistic,
  updateNoteOptimistic,
  createMentionNotifications,
} from '../../../store/mutations.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { extractMentionUserIds } from '../../../utils/mentions.js';
import LoadingState from '../../common/LoadingState.jsx';
import MentionComposer from '../../common/MentionComposer.jsx';
import MentionText from '../../common/MentionText.jsx';

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function generateNoteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function NotesTab({ patient, referral, readOnly = false }) {
  const { appUserId, appUserName, validAuthorIds, isValidAuthor } = useCurrentAppUser();
  const { user: clerkUser } = useUser();
  const { resolveUser, resolveUserImage } = useLookups();
  const allNotes = useCareStore((s) => s.notes);
  const hydrated = useCareStore((s) => s.hydrated);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [error, setError] = useState(null);
  const composerRef = useRef(null);
  const { can } = usePermissions();

  const notes = useMemo(() => {
    if (!patient?.id) return [];
    return Object.values(allNotes)
      .filter((n) => n.patient_id === patient.id)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [allNotes, patient?.id]);

  const loading = !hydrated;

  function submitNote() {
    if (!can(PERMISSION_KEYS.NOTE_CREATE)) return;
    const content = composerRef.current?.getValue?.()?.trim() || '';
    if (!content) return;
    setError(null);

    if (!appUserId) {
      setError('Your user account was not found in Airtable. See the banner above for instructions.');
      return;
    }

    if (!isValidAuthor) {
      setError(
        `Your user ID (${appUserId}) is not a valid author option in Airtable. ` +
        `See the banner above for how to fix this.`
      );
      return;
    }

    const noteId = generateNoteId();
    const fields = {
      id: noteId,
      patient_id: patient.id,
      author_id: appUserId,
      content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(referral?.id ? { referral_id: referral.id } : {}),
    };

    createNoteOptimistic(fields).catch((err) => {
      setError(`Failed to save note: ${err.message}`);
    });

    const mentioned = extractMentionUserIds(content);
    if (mentioned.length) {
      const patientLabel = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
      createMentionNotifications({
        mentionedUserIds: mentioned,
        actorUserId: appUserId,
        noteId,
        patientId: patient.id,
        referralId: referral?.id || null,
        noteContent: content,
        actorName: appUserName,
        patientLabel,
      });
    }

    composerRef.current?.clear?.();
    setComposerEmpty(true);
  }

  function togglePin(note) {
    if (!can(PERMISSION_KEYS.NOTE_PIN)) return;
    const wasPinned = note.is_pinned === true || note.is_pinned === 'true';
    updateNoteOptimistic(note._id, { is_pinned: !wasPinned }).catch(() => {});
  }

  const pinned = notes.filter((n) => n.is_pinned === true || n.is_pinned === 'true');
  const unpinned = notes.filter((n) => !n.is_pinned || n.is_pinned === 'false');
  const sorted = [...pinned, ...unpinned];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {!isValidAuthor && appUserId && validAuthorIds && (
      <div style={{
        padding: '12px 20px', background: hexToRgba(palette.highlightYellow.hex, 0.1),
        borderBottom: `1px solid ${hexToRgba(palette.highlightYellow.hex, 0.4)}`,
        flexShrink: 0,
      }}>
        <p style={{ fontSize: 12.5, fontWeight: 650, color: '#7A5F00', marginBottom: 4 }}>
          Action required — your user ID is not in the Notes author options
        </p>
        <p style={{ fontSize: 12, color: '#7A5F00', lineHeight: 1.55, marginBottom: 8 }}>
          Your ID <code style={{ background: hexToRgba(palette.highlightYellow.hex, 0.25), padding: '1px 5px', borderRadius: 3 }}>{appUserId}</code> needs to be added as a select option
          in the <strong>Notes → author_id</strong> field in Airtable.
        </p>
        <p style={{ fontSize: 12, color: '#7A5F00', marginBottom: 4 }}>
          <strong>Fix (2 options):</strong>
        </p>
        <p style={{ fontSize: 12, color: '#7A5F00', lineHeight: 1.55, marginBottom: 4 }}>
          1. In Airtable: open <strong>Notes</strong> table → click the <strong>author_id</strong> column header → Edit field → add{' '}
          <code style={{ background: hexToRgba(palette.highlightYellow.hex, 0.25), padding: '1px 5px', borderRadius: 3 }}>{appUserId}</code> as a new option.
        </p>
        <p style={{ fontSize: 12, color: '#7A5F00', lineHeight: 1.55 }}>
          2. Or in <code style={{ background: hexToRgba(palette.highlightYellow.hex, 0.25), padding: '1px 5px', borderRadius: 3 }}>.env</code>: set{' '}
          <code style={{ background: hexToRgba(palette.highlightYellow.hex, 0.25), padding: '1px 5px', borderRadius: 3 }}>
            VITE_DEFAULT_AUTHOR_ID=
          </code>
          to one of the existing valid options:{' '}
          <code style={{ background: hexToRgba(palette.highlightYellow.hex, 0.25), padding: '1px 5px', borderRadius: 3 }}>
            {validAuthorIds.join(' | ')}
          </code>
        </p>
      </div>
    )}

    {!readOnly && can(PERMISSION_KEYS.NOTE_CREATE) && <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
        <MentionComposer
          ref={composerRef}
          rows={3}
          excludeUserId={appUserId}
          onSubmit={submitNote}
          onEmptyChange={setComposerEmpty}
          placeholder="Write a note… Type @ to mention staff (Cmd+Enter to save)"
        />

        {error && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 7,
            background: hexToRgba(palette.primaryMagenta.hex, 0.08),
            border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
            fontSize: 12, color: palette.primaryMagenta.hex,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Posting as{' '}
            <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
              {appUserName}
            </strong>
            <span style={{ marginLeft: 8, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
              · @ to mention
            </span>
          </span>
          <button
            onClick={submitNote}
            disabled={composerEmpty}
            style={{
              padding: '7px 18px', borderRadius: 7,
              background: !composerEmpty
                ? palette.primaryMagenta.hex
                : hexToRgba(palette.primaryMagenta.hex, 0.3),
              border: 'none', fontSize: 12.5, fontWeight: 650,
              color: palette.backgroundLight.hex,
              cursor: !composerEmpty ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            Add Note
          </button>
        </div>
      </div>}

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 32px' }}>
        {loading ? (
          <LoadingState message="Loading notes..." size="small" />
        ) : sorted.length === 0 ? (
          <p style={{
            fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35),
            textAlign: 'center', padding: '32px 0', fontStyle: 'italic',
          }}>
            No notes yet. Add the first one above.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map((note) => (
              <NoteCard
                key={note._id}
                note={note}
                onTogglePin={readOnly ? undefined : togglePin}
                currentUserId={appUserId}
                resolveUser={resolveUser}
                resolveUserImage={resolveUserImage}
                currentClerkImageUrl={clerkUser?.imageUrl || null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({ note, onTogglePin, currentUserId, resolveUser, resolveUserImage, currentClerkImageUrl }) {
  const isPinned = note.is_pinned === true || note.is_pinned === 'true';
  const isOwn = note.author_id === currentUserId;
  const authorName = resolveUser ? resolveUser(note.author_id) : note.author_id || 'Unknown';

  const initials = authorName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const lookupImage = resolveUserImage ? resolveUserImage(note.author_id) : null;
  const photoUrl = lookupImage || (isOwn ? currentClerkImageUrl : null);

  const [imgFailed, setImgFailed] = useState(false);
  const showImage = photoUrl && !imgFailed;

  return (
    <div
      style={{
        padding: '12px 14px', borderRadius: 10,
        border: `1px solid ${isPinned ? hexToRgba(palette.highlightYellow.hex, 0.45) : 'var(--color-border)'}`,
        background: isPinned
          ? hexToRgba(palette.highlightYellow.hex, 0.06)
          : palette.backgroundLight.hex,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {showImage ? (
            <img
              src={photoUrl}
              alt={authorName}
              onError={() => setImgFailed(true)}
              style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                objectFit: 'cover',
                boxShadow: isOwn
                  ? `0 0 0 1.5px ${hexToRgba(palette.primaryMagenta.hex, 0.35)}`
                  : `0 0 0 1px ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
              }}
            />
          ) : (
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: isOwn
                ? hexToRgba(palette.primaryMagenta.hex, 0.14)
                : hexToRgba(palette.accentBlue.hex, 0.14),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10.5, fontWeight: 800,
              color: isOwn ? palette.primaryMagenta.hex : palette.accentBlue.hex,
            }}>
              {initials || '?'}
            </div>
          )}
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.1 }}>
              {isOwn ? `${authorName} (you)` : authorName}
            </p>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 1 }}>
              {formatDateTime(note.created_at)}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isPinned && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
              color: '#7A5F00', background: hexToRgba(palette.highlightYellow.hex, 0.25),
              borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase',
            }}>
              Pinned
            </span>
          )}
          {onTogglePin && (
            <button
              onClick={() => onTogglePin(note)}
              title={isPinned ? 'Unpin' : 'Pin to top'}
              style={{
                fontSize: 11.5, fontWeight: 600, background: 'none', border: 'none',
                color: hexToRgba(palette.backgroundDark.hex, 0.35),
                cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                transition: 'color 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = palette.highlightYellow.hex)}
              onMouseLeave={(e) => (e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.35))}
            >
              {isPinned ? '⊘' : '⊙'}
            </button>
          )}
        </div>
      </div>

      <div style={{
        fontSize: 13, color: palette.backgroundDark.hex,
        lineHeight: 1.65,
      }}>
        <MentionText
          content={note.content}
          resolveUser={resolveUser}
          highlightUserId={currentUserId}
        />
      </div>
    </div>
  );
}
