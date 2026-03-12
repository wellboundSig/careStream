import { createContext, useContext, useState, useCallback } from 'react';

const ThemeContext = createContext({
  isDark: false,
  toggleTheme: () => {},
  setDark: () => {},
});

export function ThemeContextProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem('cs-theme') === 'dark';
    } catch {
      return false;
    }
  });

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      try { localStorage.setItem('cs-theme', next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }, []);

  const setDark = useCallback((val) => {
    setIsDark(val);
    try { localStorage.setItem('cs-theme', val ? 'dark' : 'light'); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
