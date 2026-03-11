import palette, { hexToRgba } from '../../utils/colors.js';

export default function LoadingState({ message = 'Loading...', size = 'default' }) {
  const isSmall = size === 'small';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: isSmall ? '24px 16px' : '64px 24px',
        color: palette.backgroundDark.hex,
      }}
    >
      <Spinner size={isSmall ? 24 : 36} />
      <span
        style={{
          fontSize: isSmall ? 13 : 14,
          color: hexToRgba(palette.backgroundDark.hex, 0.45),
          fontWeight: 450,
        }}
      >
        {message}
      </span>
    </div>
  );
}

export function Spinner({ size = 28, color }) {
  const c = color || palette.primaryMagenta.hex;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'spin 0.75s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={hexToRgba(c, 0.18)}
        strokeWidth="2.5"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={c}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
