import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Celebratory shield for SOC Completed — filled green shield with check
 * and a soft glow. Used on the Dashboard KPI card.
 */
export default function SocCompletedShieldIcon({ size = 28 }) {
  const green = palette.accentGreen.hex;
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes socShieldGlow {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.08); }
        }
        @keyframes socShieldSpark {
          0%, 100% { opacity: 0.35; transform: scale(0.85) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.1) rotate(12deg); }
        }
      `}</style>
      {/* Soft glow behind the shield */}
      <span
        style={{
          position: 'absolute',
          inset: '-18%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hexToRgba(green, 0.35)} 0%, transparent 68%)`,
          animation: 'socShieldGlow 2.4s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{ position: 'relative', display: 'block', filter: `drop-shadow(0 2px 4px ${hexToRgba(green, 0.35)})` }}
      >
        <path
          d="M12 2.5l7.5 3.2v6.4c0 5.1-3.2 8.6-7.5 10.2C7.7 20.7 4.5 17.2 4.5 12.1V5.7L12 2.5z"
          fill={green}
        />
        <path
          d="M12 2.5l7.5 3.2v6.4c0 5.1-3.2 8.6-7.5 10.2C7.7 20.7 4.5 17.2 4.5 12.1V5.7L12 2.5z"
          stroke={hexToRgba('#fff', 0.35)}
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <path
          d="M8.6 12.1l2.2 2.2 4.6-4.7"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Tiny spark accents */}
      <span
        style={{
          position: 'absolute',
          top: -2,
          right: -3,
          width: 5,
          height: 5,
          borderRadius: 1,
          background: green,
          transform: 'rotate(45deg)',
          animation: 'socShieldSpark 1.8s ease-in-out infinite',
          boxShadow: `0 0 6px ${hexToRgba(green, 0.7)}`,
        }}
      />
      <span
        style={{
          position: 'absolute',
          bottom: 1,
          left: -2,
          width: 3.5,
          height: 3.5,
          borderRadius: 1,
          background: hexToRgba(green, 0.85),
          transform: 'rotate(45deg)',
          animation: 'socShieldSpark 1.8s ease-in-out infinite 0.4s',
        }}
      />
    </span>
  );
}
