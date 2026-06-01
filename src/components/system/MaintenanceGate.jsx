/**
 * MaintenanceGate — global site gate.
 *
 * Reads the `System.live` flag on load. When it's "True", the ENTIRE site
 * (every route, including sign-in) is replaced by a blank "access soon" page —
 * nothing else is reachable. When "False" the app renders normally.
 *
 * Dev bypass: press Shift+B on the gate to open a PIN prompt. Entering the
 * correct PIN bypasses the gate for THIS browser session only (sessionStorage)
 * — it does NOT change the flag for anyone else.
 */

import { useEffect, useState, useCallback } from 'react';
import { getSystemLive } from '../../api/system.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const BYPASS_KEY = 'cs_gate_bypass';
const BYPASS_PIN = '3295';

function hasSessionBypass() {
  try { return sessionStorage.getItem(BYPASS_KEY) === '1'; } catch { return false; }
}

export default function MaintenanceGate({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'open' | 'gated'
  const [bypassed, setBypassed] = useState(hasSessionBypass());

  useEffect(() => {
    let cancelled = false;
    getSystemLive()
      .then((live) => { if (!cancelled) setStatus(live ? 'gated' : 'open'); })
      .catch(() => { if (!cancelled) setStatus('open'); });
    return () => { cancelled = true; };
  }, []);

  const showGate = status === 'gated' && !bypassed;

  const onBypassSuccess = useCallback(() => {
    try { sessionStorage.setItem(BYPASS_KEY, '1'); } catch { /* ignore */ }
    setBypassed(true);
  }, []);

  // Brief neutral splash while we resolve the flag, so the app never flashes
  // before the gate decision is made.
  if (status === 'loading') return <Splash />;

  if (showGate) return <AccessSoon onBypassSuccess={onBypassSuccess} />;

  return children;
}

function Splash() {
  return (
    <div style={{ minHeight: '100vh', background: palette.primaryDeepPlum.hex, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="/logo-cs.png" alt="CareStream" style={{ height: 48, objectFit: 'contain', opacity: 0.85 }} />
    </div>
  );
}

function AccessSoon({ onBypassSuccess }) {
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  // Shift+B opens the dev PIN prompt. Listener is only mounted on the gate,
  // so it can't interfere with normal typing inside the app.
  useEffect(() => {
    function onKey(e) {
      if (e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        setShowPin(true);
        setPin('');
        setError(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function submitPin(e) {
    e?.preventDefault?.();
    if (pin.trim() === BYPASS_PIN) {
      onBypassSuccess();
    } else {
      setError(true);
      setPin('');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: palette.primaryDeepPlum.hex,
      backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        <img src="/logo-cs.png" alt="CareStream" style={{ height: 52, objectFit: 'contain' }} />
        <img src="/logo-wb.png" alt="Wellbound" style={{ height: 52, objectFit: 'contain' }} />
      </div>

      <p style={{ fontSize: 15, fontWeight: 500, color: hexToRgba('#ffffff', 0.78), letterSpacing: '0.01em', lineHeight: 1.5, maxWidth: 360 }}>
        Access will be made available soon.
      </p>

      {showPin && (
        <form onSubmit={submitPin} style={{ marginTop: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            placeholder="PIN"
            style={{
              width: 140, textAlign: 'center', letterSpacing: '0.3em',
              padding: '9px 12px', borderRadius: 8,
              border: `1px solid ${error ? palette.primaryMagenta.hex : hexToRgba('#ffffff', 0.25)}`,
              background: hexToRgba('#ffffff', 0.08), color: '#fff',
              fontSize: 15, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button type="submit" style={{
            padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: palette.primaryMagenta.hex, color: '#fff', fontSize: 12.5, fontWeight: 650, fontFamily: 'inherit',
          }}>
            Enter
          </button>
          {error && <p style={{ fontSize: 11.5, color: hexToRgba('#ffffff', 0.6) }}>Incorrect PIN</p>}
        </form>
      )}
    </div>
  );
}
