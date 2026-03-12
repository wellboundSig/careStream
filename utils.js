// ── Theme flag ────────────────────────────────────────────────────────────────
// Set synchronously during ThemeProvider render so all palette.*.hex getters
// return the correct value before any child component reads them.
let _isDark = false;
export function _setDark(v) { _isDark = v; }

// ── Palette ───────────────────────────────────────────────────────────────────
const palette = {
  primaryDeepPlum: {
    role: "Primary brand color",
    hex: "#450931",
    rgba: "rgba(69, 9, 49, 1)",
    hsla: "hsla(320, 76%, 15%, 1)",
    oklch: "oklch(0.269 0.100 345.141)"
  },

  primaryMagenta: {
    role: "Primary accent / call-to-action",
    hex: "#D91E75",
    rgba: "rgba(217, 30, 117, 1)",
    hsla: "hsla(332, 75%, 48%, 1)",
    oklch: "oklch(0.583 0.222 0.300)"
  },

  highlightYellow: {
    role: "Warning / highlight / attention",
    hex: "#F0C424",
    rgba: "rgba(240, 196, 36, 1)",
    hsla: "hsla(47, 87%, 54%, 1)",
    oklch: "oklch(0.835 0.164 91.503)"
  },

  accentOrange: {
    role: "Secondary accent / warmth",
    hex: "#DB8640",
    rgba: "rgba(219, 134, 64, 1)",
    hsla: "hsla(27, 68%, 55%, 1)",
    oklch: "oklch(0.697 0.134 57.309)"
  },

  // ── Theme-reactive: only these two invert between light / dark ─────────────

  backgroundLight: {
    role: "Page / card background",
    // Light: #F7F7FA (near-white, cool)  Dark: #14141E (near-black, cool-purple)
    get hex() { return _isDark ? '#14141E' : '#F7F7FA'; },
    rgba: "rgba(247, 247, 250, 1)",
    hsla: "hsla(240, 23%, 97%, 1)",
    oklch: "oklch(0.977 0.004 286.326)"
  },

  backgroundDark: {
    role: "Base text on light / page text",
    // Light: #0B0B10 (near-black)  Dark: #E2E2EC (near-white, cool)
    get hex() { return _isDark ? '#E2E2EC' : '#0B0B10'; },
    rgba: "rgba(11, 11, 16, 1)",
    hsla: "hsla(240, 18%, 5%, 1)",
    oklch: "oklch(0.152 0.011 285.064)"
  },

  accentBlue: {
    role: "Info / links / interactive elements",
    hex: "#06D4FF",
    rgba: "rgba(6, 212, 255, 1)",
    hsla: "hsla(190, 100%, 51%, 1)",
    oklch: "oklch(0.805 0.146 219.599)"
  },

  accentGreen: {
    role: "Success / confirmation / positive states",
    hex: "#6EC72B",
    rgba: "rgba(110, 199, 43, 1)",
    hsla: "hsla(94, 64%, 47%, 1)",
    oklch: "oklch(0.745 0.202 135.332)"
  }
};

export { palette };
export default palette;
