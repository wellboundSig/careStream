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
