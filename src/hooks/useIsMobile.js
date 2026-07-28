import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
    }
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
      const onChange = (e) => setIsMobile(e.matches);
      setIsMobile(mq.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    function check() { setIsMobile(window.innerWidth <= breakpoint); }
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}
