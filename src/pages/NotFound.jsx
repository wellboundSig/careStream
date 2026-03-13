import { useNavigate } from 'react-router-dom';
import palette, { hexToRgba } from '../utils/colors.js';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        padding: 48,
        textAlign: 'center',
      }}
    >
      {/* <img src="public/3d-cs.png" alt="404" style={{ width: 50, height: 50 }} /> */}
      <p
        style={{
          fontSize: 72,
          fontWeight: 800,
          color: hexToRgba(palette.primaryDeepPlum.hex, 0.12),
          lineHeight: 1,
        }}
      >
        404
      </p>
      <p style={{ fontSize: 18, fontWeight: 600, color: palette.backgroundDark.hex }}>
        Page not found
      </p>
      <p style={{ fontSize: 14, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
        This page does not exist or is still being built.
      </p>
      <img src="public/carestream.svg" alt="404" style={{ width: 200, height: 200 }} />
      <button
        onClick={() => navigate('/')}
        style={{
          marginTop: 8,
          padding: '10px 20px',
          borderRadius: 8,
          background: palette.primaryMagenta.hex,
          color: palette.backgroundLight.hex,
          fontSize: 13,
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Go to Dashboard
      </button>
    </div>
  );
}
