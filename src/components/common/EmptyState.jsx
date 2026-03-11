import palette, { hexToRgba } from '../../utils/colors.js';

export default function EmptyState({ title = 'No records found', subtitle, action }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '56px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: hexToRgba(palette.primaryDeepPlum.hex, 0.07),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="4"
            stroke={hexToRgba(palette.primaryDeepPlum.hex, 0.4)}
            strokeWidth="1.5"
          />
          <path
            d="M9 12h6M9 8h6M9 16h4"
            stroke={hexToRgba(palette.primaryDeepPlum.hex, 0.4)}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: palette.backgroundDark.hex,
        }}
      >
        {title}
      </p>
      {subtitle && (
        <p
          style={{
            fontSize: 13,
            color: hexToRgba(palette.backgroundDark.hex, 0.45),
            maxWidth: 280,
          }}
        >
          {subtitle}
        </p>
      )}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
