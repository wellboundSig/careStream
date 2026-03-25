import { useEffect } from 'react';
import palette, { hexToRgba } from './colors.js';
import { _setDark } from '../../utils.js';
import { useTheme } from './ThemeContext.jsx';

// Static light values used for sidebar CSS vars — sidebar is always plum/dark,
// so its text must always be near-white regardless of page theme.
const SIDEBAR_TEXT_HEX = '#F7F7FA';

export default function ThemeProvider({ children }) {
  const { isDark } = useTheme();

  // Synchronously update the module-level flag so that palette.*.hex getters
  // return the correct values when child components render during this cycle.
  _setDark(isDark);

  useEffect(() => {
    const root = document.documentElement;

    // Brand / accent colors — identical in both themes
    root.style.setProperty('--primary-deep-plum', palette.primaryDeepPlum.hex);
    root.style.setProperty('--primary-magenta',   palette.primaryMagenta.hex);
    root.style.setProperty('--highlight-yellow',  palette.highlightYellow.hex);
    root.style.setProperty('--accent-orange',     palette.accentOrange.hex);
    root.style.setProperty('--accent-blue',       palette.accentBlue.hex);
    root.style.setProperty('--accent-green',      palette.accentGreen.hex);

    // Theme-reactive surface/text colors
    root.style.setProperty('--bg-light',      palette.backgroundLight.hex);
    root.style.setProperty('--bg-dark',       palette.backgroundDark.hex);
    root.style.setProperty('--color-surface', palette.backgroundLight.hex);

    // Derived semantic tokens — re-computed from the active palette values
    root.style.setProperty('--color-border',     hexToRgba(palette.backgroundDark.hex, isDark ? 0.14 : 0.10));
    root.style.setProperty('--text-muted',       hexToRgba(palette.backgroundDark.hex, 0.40));
    root.style.setProperty('--color-card-shadow',hexToRgba(palette.backgroundDark.hex, isDark ? 0.30 : 0.06));
    root.style.setProperty('--color-row-hover',  isDark
      ? hexToRgba(palette.primaryMagenta.hex, 0.06)
      : hexToRgba(palette.primaryDeepPlum.hex, 0.03));

    // Inactive/disabled button backgrounds — must be visible in both themes
    root.style.setProperty('--color-btn-inactive', isDark
      ? 'rgba(226, 226, 236, 0.10)'
      : 'rgba(11, 11, 16, 0.07)');
    root.style.setProperty('--color-btn-inactive-text', isDark
      ? 'rgba(226, 226, 236, 0.45)'
      : 'rgba(11, 11, 16, 0.45)');

    // Green accent — slightly brighter in dark mode for visibility
    root.style.setProperty('--accent-green-vivid', isDark ? '#7BD937' : palette.accentGreen.hex);
    root.style.setProperty('--accent-green-bg', isDark
      ? 'rgba(110, 199, 43, 0.15)'
      : 'rgba(110, 199, 43, 0.10)');

    // Sidebar — always plum background, always near-white text
    root.style.setProperty('--color-sidebar',             palette.primaryDeepPlum.hex);
    root.style.setProperty('--color-sidebar-hover',       hexToRgba(palette.primaryMagenta.hex, 0.12));
    root.style.setProperty('--color-sidebar-active',      hexToRgba(palette.primaryMagenta.hex, 0.18));
    root.style.setProperty('--color-sidebar-text',        hexToRgba(SIDEBAR_TEXT_HEX, 0.75));
    root.style.setProperty('--color-sidebar-text-active', SIDEBAR_TEXT_HEX);

    // TopBar
    root.style.setProperty('--color-topbar-border', isDark
      ? hexToRgba(palette.backgroundDark.hex, 0.14)
      : hexToRgba(palette.backgroundDark.hex, 0.35));

    // Body background to prevent flash of wrong color outside the app shell
    document.body.style.background = palette.backgroundLight.hex;
  }, [isDark]);

  return children;
}
