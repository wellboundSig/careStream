/**
 * Reason + explanation modal to discard a referral/lead → Discarded Leads.
 */
import { useState } from 'react';
import { DISCARD_REASONS } from '../../data/stageConfig.js';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function DiscardReferralModal({
  referral,
  onConfirm,
  onCancel,
  title = 'Discard Referral',
  confirmLabel = 'Discard',
}) {
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = reason && explanation.trim() && !busy;
  const name = referral?.patientName || referral?.patient_id || 'This case';

  async function handleConfirm() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm(reason, explanation.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 440,
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>{title}</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
            {name} will be moved to Discarded Leads.
          </p>
        </div>
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p data-testid="discard-reason-label" style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>
              Reason *
            </p>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 8,
                border: `1px solid ${reason ? palette.accentGreen.hex : 'var(--color-border)'}`,
                fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                background: palette.backgroundLight.hex, color: palette.backgroundDark.hex,
              }}
            >
              <option value="">Select a reason…</option>
              {DISCARD_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>
              Explanation *
            </p>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              disabled={busy}
              placeholder="Why is this being discarded?"
              rows={3}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 8,
                border: `1px solid ${explanation.trim() ? palette.accentGreen.hex : 'var(--color-border)'}`,
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                background: hexToRgba(palette.backgroundDark.hex, 0.03),
                color: palette.backgroundDark.hex, boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '7px 18px', borderRadius: 7, border: '1px solid var(--color-border)',
              background: 'none', fontSize: 13, fontWeight: 550,
              color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="discard-confirm"
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{
              padding: '7px 20px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 650,
              background: canSubmit ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
              color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Discarding…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
