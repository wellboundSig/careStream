import { useEffect } from 'react';
import palette, { hexToRgba } from './colors.js';

export default function ThemeProvider({ children }) {
  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty('--primary-deep-plum', palette.primaryDeepPlum.hex);
    root.style.setProperty('--primary-magenta', palette.primaryMagenta.hex);
    root.style.setProperty('--highlight-yellow', palette.highlightYellow.hex);
    root.style.setProperty('--accent-orange', palette.accentOrange.hex);
    root.style.setProperty('--bg-light', palette.backgroundLight.hex);
    root.style.setProperty('--bg-dark', palette.backgroundDark.hex);
    root.style.setProperty('--accent-blue', palette.accentBlue.hex);
    root.style.setProperty('--accent-green', palette.accentGreen.hex);

    root.style.setProperty('--color-border', hexToRgba(palette.backgroundDark.hex, 0.1));
    root.style.setProperty('--text-muted', hexToRgba(palette.backgroundDark.hex, 0.4));
    root.style.setProperty('--color-surface', hexToRgba(palette.backgroundLight.hex, 1));
    root.style.setProperty('--color-sidebar', palette.primaryDeepPlum.hex);
    root.style.setProperty('--color-sidebar-hover', hexToRgba(palette.primaryMagenta.hex, 0.12));
    root.style.setProperty('--color-sidebar-active', hexToRgba(palette.primaryMagenta.hex, 0.18));
    root.style.setProperty('--color-sidebar-text', hexToRgba(palette.backgroundLight.hex, 0.75));
    root.style.setProperty('--color-sidebar-text-active', palette.backgroundLight.hex);
    root.style.setProperty('--color-topbar-border', hexToRgba(palette.backgroundDark.hex, 0.35));
    root.style.setProperty('--color-card-shadow', hexToRgba(palette.backgroundDark.hex, 0.06));
    root.style.setProperty('--color-row-hover', hexToRgba(palette.primaryDeepPlum.hex, 0.03));
  }, []);

  return children;
}
