import { useState, useEffect, useRef } from 'react';
import { createNote } from '../../api/notes.js';
import { createMentionNotifications } from '../../store/mutations.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { extractMentionUserIds } from '../../utils/mentions.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import MentionComposer from '../common/MentionComposer.jsx';

function generateId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function QuickNoteModal({ patient, referral, onClose, onSaved }) {
  const { appUserId, appUserName } = useCurrentAppUser();
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const composerRef = useRef(null);

  useEffect(() => {
    composerRef.current?.focus?.();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const text = composerRef.current?.getValue?.()?.trim() || '';
    if (!text || saving) return;
    if (!appUserId) { setError('Your user account was not found. Check your login.'); return; }
    setSaving(true);
    setError(null);
    try {
      const noteId = generateId();
      const fields = {
        id: noteId,
        patient_id: patient.id,
        author_id: appUserId,
        content: text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(referral?.id ? { referral_id: referral.id } : {}),
      };
      await createNote(fields);

      const mentioned = extractMentionUserIds(text);
      if (mentioned.length) {
        const patientLabel = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
        createMentionNotifications({
          mentionedUserIds: mentioned,
          actorUserId: appUserId,
          noteId,
          patientId: patient.id,
          referralId: referral?.id || null,
          noteContent: text,
          actorName: appUserName,
          patientLabel,
        });
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const name = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Patient';

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 9995, background: hexToRgba(palette.backgroundDark.hex, 0.4), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: `0 20px 60px ${hexToRgba(palette.backgroundDark.hex, 0.2)}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 14px', background: palette.primaryDeepPlum.hex }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.5), marginBottom: 3 }}>Add Note</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundLight.hex }}>{name}</p>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <MentionComposer
            ref={composerRef}
            rows={4}
            excludeUserId={appUserId}
            onSubmit={submit}
            onEmptyChange={setComposerEmpty}
            placeholder="Write a note… Type @ to mention staff (Cmd+Enter to save)"
          />
          {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginTop: 6 }}>{error}</p>}
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 6 }}>
            Posting as <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{appUserName}</strong>
            <span style={{ marginLeft: 8 }}>· @ to mention</span>
          </p>
        </div>
        <div style={{ padding: '0 20px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={composerEmpty || saving} style={{ padding: '8px 20px', borderRadius: 8, background: !composerEmpty ? palette.primaryMagenta.hex : hexToRgba(palette.primaryMagenta.hex, 0.3), border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: !composerEmpty && !saving ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  );
}
