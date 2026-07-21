import palette, { hexToRgba } from '../../utils/colors.js';
import { isUserOoo, isUserOooScheduled, oooWindowLabel } from '../../utils/outOfOffice.js';

/**
 * Compact Out of Office chip for team cards and assignment pickers.
 */
export default function OooBadge({ user, size = 'sm' }) {
  const active = isUserOoo(user);
  const scheduled = !active && isUserOooScheduled(user);
  if (!active && !scheduled) return null;

  const label = active ? 'OOO' : 'OOO soon';
  const title = oooWindowLabel(user) || (active ? 'Out of office' : 'Out of office scheduled');
  const color = active ? palette.accentOrange.hex : palette.highlightYellow.hex;
  const pad = size === 'md' ? '3px 9px' : '2px 7px';
  const fontSize = size === 'md' ? 11 : 10;

  return (
    <span
      title={title}
      data-testid="ooo-badge"
      style={{
        flexShrink: 0,
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.04em',
        padding: pad,
        borderRadius: 20,
        background: hexToRgba(color, active ? 0.16 : 0.22),
        color: active ? color : '#7A5F00',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}
    >
      {label}
    </span>
  );
}
