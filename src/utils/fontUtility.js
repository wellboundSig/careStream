// ─── FONT TOGGLE ─────────────────────────────────────────────────────────────
// Set FONT to 'sn' to use SN Pro sitewide.
// Set FONT to 'sf' to use SF Pro (San Francisco) sitewide.
// ─────────────────────────────────────────────────────────────────────────────
export const FONT = 'sf';

const fontConfig = {
  sn: {
    name: 'SN Pro',
    src: '/fonts/SNPro-VariableFont_wght.ttf',
    cssFamily: "'SN Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  sf: {
    name: 'SF Pro',
    src: '/fonts/SF-Pro.ttf',
    cssFamily: "'SF Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
};

const active = fontConfig[FONT] ?? fontConfig.sn;

// Resolved font-family string — use wherever font-family must be hardcoded (e.g. Clerk appearance API)
export const fontFamily = active.cssFamily;

// Call once at startup (before React renders) to inject @font-face if needed
// and set the --font-family CSS variable that drives every `font-family: var(--font-family)` rule.
export function applyFont() {
  if (FONT === 'sf') {
    const style = document.createElement('style');
    style.id = 'carestream-font-override';
    style.textContent = [
      '@font-face {',
      `  font-family: '${active.name}';`,
      `  src: url('${active.src}') format('truetype');`,
      '  font-weight: 100 900;',
      '  font-style: normal;',
      '  font-display: swap;',
      '}',
    ].join('\n');
    document.head.insertBefore(style, document.head.firstChild);
  }

  document.documentElement.style.setProperty('--font-family', active.cssFamily);
}
