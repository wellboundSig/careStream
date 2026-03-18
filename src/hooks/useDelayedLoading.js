import { useState, useEffect } from 'react';

/**
 * The 200ms rule: never show a loading indicator for anything under 200ms.
 * A flash of a spinner causes more anxiety than the wait itself.
 *
 * Returns `true` only after `isLoading` has been truthy for at least `delay` ms.
 */
export function useDelayedLoading(isLoading, delay = 200) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [isLoading, delay]);

  return show;
}
