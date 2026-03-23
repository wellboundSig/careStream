import { useState, useEffect, useRef } from 'react';
import StageRules from '../../data/StageRules.json';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function TransitionModal({ referral, toStage, onConfirm, onCancel, loading }) {
  const [note, setNote] = useState('');
  const textareaRef = useRef(null);

  const fromStage = referral.current_stage;
  const fromRule = StageRules.stages[fromStage];
  const toRule   = StageRules.stages[toStage];

  const destinationPrompt = toRule?.destinationPrompt || null;

  const noteRequired =
    fromRule?.requiresNote ||
    toStage === 'Hold' ||
    toStage === 'NTUC' ||
    !!destinationPrompt;

  const isProtected = fromRule?.protectedExit || fromRule?.requiresPermission;
  const canConfirm = !noteRequired || note.trim().length > 0;

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const labelFor =
    toStage === 'Hold' ? 'Hold reason' :
    toStage === 'NTUC' ? 'NTUC reason' :
    destinationPrompt  ? 'Required note' :
    'Reason for transition';

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      style={{
        position: 'fixed',
        inset: 0,
        background: hexToRgba(palette.backgroundDark.hex, 0.45),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9998,
        padding: 24,
      }}
    >
      <div
        style={{
          background: palette.backgroundLight.hex,
          borderRadius: 14,
          width: '100%',
          maxWidth: 440,
          boxShadow: `0 20px 60px ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '18px 22px 16px',
            borderBottom: `1px solid var(--color-border)`,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: palette.backgroundDark.hex,
              marginBottom: 14,
            }}
          >
            Move Patient
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StagePill stage={fromStage} />
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M3 8h10M9 4l4 4-4 4" stroke={hexToRgba(palette.backgroundDark.hex, 0.45)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <StagePill stage={toStage} active />
          </div>

          <p
            style={{
              marginTop: 10,
              fontSize: 12.5,
              color: hexToRgba(palette.backgroundDark.hex, 0.55),
              lineHeight: 1.5,
            }}
          >
            {referral.patientName || referral.patient_id}
          </p>
        </div>

        <div style={{ padding: '16px 22px' }}>
          {isProtected && (
            <div
              style={{
                padding: '10px 14px',
                background: hexToRgba(palette.accentOrange.hex, 0.1),
                border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`,
                borderRadius: 8,
                marginBottom: 14,
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 650, color: palette.accentOrange.hex, marginBottom: 2 }}>
                Protected Action
              </p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.5 }}>
                {fromRule?.protectedExitMessage ||
                  `This transition requires the ${fromRule?.requiresPermission || 'appropriate'} permission. This action is logged.`}
              </p>
            </div>
          )}

          {toRule?.description && (
            <div
              style={{
                padding: '9px 12px',
                background: hexToRgba(palette.backgroundDark.hex, 0.03),
                borderRadius: 8,
                marginBottom: 14,
                fontSize: 12,
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
                lineHeight: 1.5,
                fontStyle: 'italic',
              }}
            >
              {toRule.description}
            </div>
          )}

          <label
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 650,
              color: hexToRgba(palette.backgroundDark.hex, 0.6),
              marginBottom: 6,
              letterSpacing: '0.02em',
            }}
          >
            {labelFor}
            {noteRequired && (
              <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>
            )}
          </label>

          <textarea
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              toStage === 'Hold'
                ? 'Describe why this patient is being placed on hold and the expected resolution...'
                : toStage === 'NTUC'
                ? 'Provide the structured NTUC reason (e.g. No staffing, Insurance denied, Patient declined)...'
                : destinationPrompt
                ? destinationPrompt
                : 'Describe the reason for this transition...'
            }
            rows={destinationPrompt ? 7 : 4}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid var(--color-border)`,
              background: hexToRgba(palette.backgroundDark.hex, 0.03),
              fontSize: 13,
              color: palette.backgroundDark.hex,
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
            onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
          />

          {noteRequired && note.trim().length === 0 && (
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 5 }}>
              A note is required for this transition.
            </p>
          )}
        </div>

        <div
          style={{
            padding: '12px 22px 18px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              border: `1px solid var(--color-border)`,
              fontSize: 13,
              fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.65),
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm(note.trim())}
            disabled={!canConfirm || loading}
            style={{
              padding: '9px 22px',
              borderRadius: 8,
              background: canConfirm
                ? toStage === 'NTUC'
                  ? hexToRgba(palette.backgroundDark.hex, 0.55)
                  : palette.primaryMagenta.hex
                : hexToRgba(palette.primaryMagenta.hex, 0.3),
              border: 'none',
              fontSize: 13,
              fontWeight: 650,
              color: palette.backgroundLight.hex,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              opacity: loading ? 0.7 : 1,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {loading ? 'Moving...' : `Move to ${toStage}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StagePill({ stage, active }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 20,
        background: active
          ? hexToRgba(palette.primaryMagenta.hex, 0.14)
          : hexToRgba(palette.backgroundDark.hex, 0.07),
        color: active
          ? palette.primaryMagenta.hex
          : hexToRgba(palette.backgroundDark.hex, 0.55),
        whiteSpace: 'nowrap',
      }}
    >
      {stage}
    </span>
  );
}
