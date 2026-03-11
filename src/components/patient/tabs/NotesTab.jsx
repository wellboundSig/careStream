import { useState, useEffect, useRef } from 'react';
import { getNotesByPatient, createNote, updateNote } from '../../../api/notes.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

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

export default function NotesTab({ patient, referral }) {
  const { appUserId, appUserName, validAuthorIds, isValidAuthor } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    setError(null);
    getNotesByPatient(patient.id)
      .then((records) => setNotes(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [patient?.id]);

  async function submitNote() {
    if (!composing.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    if (!appUserId) {
      setError('Your user account was not found in Airtable. See the banner above for instructions.');
      setSubmitting(false);
      return;
    }

    if (!isValidAuthor) {
      setError(
        `Your user ID (${appUserId}) is not a valid author option in Airtable. ` +
        `See the banner above for how to fix this.`
      );
      setSubmitting(false);
      return;
    }

    const fields = {
      id: generateNoteId(),
      patient_id: patient.id,
      author_id: appUserId,
      content: composing.trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(referral?.id ? { referral_id: referral.id } : {}),
    };

    try {
      const created = await createNote(fields);
      const newNote = { _id: created.id, ...created.fields };
      setNotes((prev) => [newNote, ...prev]);
      setComposing('');
    } catch (err) {
      setError(`Failed to save note: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePin(note) {
    const wasPinned = note.is_pinned === true || note.is_pinned === 'true';
    try {
      await updateNote(note._id, { is_pinned: !wasPinned });
      setNotes((prev) =>
        prev.map((n) => (n._id === note._id ? { ...n, is_pinned: !wasPinned } : n))
      );
    } catch {
      // pin toggle is non-critical — fail silently
    }
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

    <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
      <textarea
          ref={textareaRef}
          value={composing}
          onChange={(e) => setComposing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submitNote();
            }
          }}
          placeholder="Write a note... (Cmd+Enter or click Add Note to save)"
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            border: `1px solid var(--color-border)`,
            background: hexToRgba(palette.backgroundDark.hex, 0.03),
            fontSize: 13, color: palette.backgroundDark.hex,
            resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
          onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
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
              {appUserId && (
                <span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 4 }}>
                  ({appUserId})
                </span>
              )}
            </strong>
          </span>
          <button
            onClick={submitNote}
            disabled={!composing.trim() || submitting}
            style={{
              padding: '7px 18px', borderRadius: 7,
              background: composing.trim() && !submitting
                ? palette.primaryMagenta.hex
                : hexToRgba(palette.primaryMagenta.hex, 0.3),
              border: 'none', fontSize: 12.5, fontWeight: 650,
              color: palette.backgroundLight.hex,
              cursor: composing.trim() && !submitting ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            {submitting ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>

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
                onTogglePin={togglePin}
                currentUserId={appUserId}
                resolveUser={resolveUser}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({ note, onTogglePin, currentUserId, resolveUser }) {
  const isPinned = note.is_pinned === true || note.is_pinned === 'true';
  const isOwn = note.author_id === currentUserId;
  const authorName = resolveUser ? resolveUser(note.author_id) : note.author_id || 'Unknown';

  const initials = authorName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

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
        </div>
      </div>

      <p style={{
        fontSize: 13, color: palette.backgroundDark.hex,
        lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {note.content}
      </p>
    </div>
  );
}
