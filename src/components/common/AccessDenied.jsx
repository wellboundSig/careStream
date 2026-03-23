import palette, { hexToRgba } from '../../utils/colors.js';

export default function AccessDenied({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, flexDirection: 'column', gap: 12, padding: 48 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: hexToRgba(palette.primaryMagenta.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke={palette.primaryMagenta.hex} strokeWidth="1.8"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={palette.primaryMagenta.hex} strokeWidth="1.8" strokeLinecap="round"/></svg>
      </div>
      <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
      <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 320, textAlign: 'center' }}>
        {message || 'You do not have permission to access this page. Contact your administrator.'}
      </p>
    </div>
  );
}
