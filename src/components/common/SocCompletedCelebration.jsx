import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import palette, { hexToRgba } from '../../utils/colors.js';

function fmtSocDate(value) {
  if (!value) return '—';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Fun internal-only celebration after Mark SOC Completed.
 * Renders via portal so it stays up after the patient leaves the Pre-SOC queue.
 */
export default function SocCompletedCelebration({ patientName, completedDate, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-testid="soc-completed-celebration"
      role="dialog"
      aria-modal="true"
      aria-label="SOC completed"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'socCeleFadeIn 0.2s ease-out',
      }}
    >
      <style>{`
        @keyframes socCeleFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes socCelePop { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 16,
          background: palette.backgroundLight.hex,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
          overflow: 'hidden',
          animation: 'socCelePop 0.28s ease-out',
        }}
      >
        <div style={{
          padding: '18px 20px 8px',
          textAlign: 'center',
          borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
        }}>
          <p style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: palette.accentGreen.hex, marginBottom: 6,
          }}>
            Start of Care
          </p>
          <h2 style={{
            margin: 0, fontSize: 22, fontWeight: 750, letterSpacing: '-0.02em',
            color: palette.backgroundDark.hex, lineHeight: 1.25,
          }}>
            SOC completed
          </h2>
          <p style={{
            margin: '8px 0 0', fontSize: 14, fontWeight: 600,
            color: hexToRgba(palette.backgroundDark.hex, 0.75),
          }}>
            {patientName || 'Patient'}
          </p>
          <p style={{
            margin: '4px 0 0', fontSize: 12.5,
            color: hexToRgba(palette.backgroundDark.hex, 0.5),
          }}>
            Completed {fmtSocDate(completedDate)}
          </p>
        </div>

        <div style={{
          padding: '14px 16px 6px',
          background: hexToRgba(palette.accentGreen.hex, 0.04),
          display: 'flex', justifyContent: 'center',
        }}>
          <img
            src="/SOC.gif"
            alt=""
            style={{
              width: '100%',
              maxWidth: 360,
              height: 'auto',
              maxHeight: 280,
              objectFit: 'contain',
              borderRadius: 10,
              display: 'block',
            }}
          />
        </div>

        <div style={{ padding: '14px 16px 16px' }}>
          <button
            type="button"
            data-testid="soc-celebration-dismiss"
            onClick={onClose}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 10, border: 'none',
              background: palette.accentGreen.hex, color: palette.backgroundLight.hex,
              fontSize: 13.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.01em',
            }}
          >
            Nice — continue
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
