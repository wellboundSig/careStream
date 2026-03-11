import { useState, useEffect, useRef } from 'react';
import { createNote } from '../../api/notes.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function generateId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function QuickNoteModal({ patient, referral, onClose, onSaved }) {
  const { appUserId, appUserName } = useCurrentAppUser();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (!text.trim() || saving) return;
    if (!appUserId) { setError('Your user account was not found. Check your login.'); return; }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        id: generateId(),
        patient_id: patient.id,
        author_id: appUserId,
        content: text.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(referral?.id ? { referral_id: referral.id } : {}),
      };
      await createNote(fields);
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
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Write a note… (Cmd+Enter to save)"
            rows={4}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.03), fontSize: 13, color: palette.backgroundDark.hex, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
            onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
            onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
          />
          {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginTop: 6 }}>{error}</p>}
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 6 }}>Posting as <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{appUserName}</strong></p>
        </div>
        <div style={{ padding: '0 20px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!text.trim() || saving} style={{ padding: '8px 20px', borderRadius: 8, background: text.trim() ? palette.primaryMagenta.hex : hexToRgba(palette.primaryMagenta.hex, 0.3), border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: text.trim() ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  );
}
