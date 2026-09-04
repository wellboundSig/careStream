import palette from '../../utils.js';

export { palette };
export default palette;

export function hexToRgba(hex, opacity) {
  const h = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return `rgba(0, 0, 0, ${opacity})`;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Opaque equivalent of hexToRgba over a white background.
 * Use for chip/badge backgrounds that sit on tinted rows (e.g. the blue
 * post-visit rows) so translucent yellows don't composite into murky greens.
 * Renders identically to hexToRgba(hex, alpha) on plain white.
 */
export function hexOnWhite(hex, alpha) {
  const h = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return '#ffffff';
  const blend = (c) => Math.round(c * alpha + 255 * (1 - alpha));
  const r = blend(parseInt(h.slice(1, 3), 16));
  const g = blend(parseInt(h.slice(3, 5), 16));
  const b = blend(parseInt(h.slice(5, 7), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
