import palette, { hexToRgba } from '../../../utils/colors.js';

export default function InfoRow({ label, value, mono, accent, copyable }) {
  const empty = value === null || value === undefined || value === '';
  function onCopy() {
    if (empty) return;
    try { navigator.clipboard?.writeText(String(value)); } catch {}
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span
        onClick={copyable ? onCopy : undefined}
        title={copyable && !empty ? 'Copy value' : undefined}
        style={{
          fontSize: mono ? 12 : 13,
          fontWeight: 550,
          color: empty ? hexToRgba(palette.backgroundDark.hex, 0.3) : (accent || palette.backgroundDark.hex),
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          textAlign: 'right',
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: copyable && !empty ? 'pointer' : 'default',
          userSelect: copyable ? 'all' : 'auto',
        }}
      >
        {empty ? '—' : value}
      </span>
    </div>
  );
}

export function SectionTitle({ children }) {
  return (
    <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '22px 0 10px' }}>
      {children}
    </p>
  );
}
