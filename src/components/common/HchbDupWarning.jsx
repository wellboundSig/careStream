/**
 * Soft/strong HCHB logship duplicate warnings (non-blocking).
 * Clear path: small green confirmation when name is not active in HCHB.
 */
import { useEffect, useRef, useState } from 'react';
import { runHchbDupCheck } from '../../api/hchbDupCheck.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * @param {{ firstName: string, lastName: string, dob?: string }} props
 */
export default function HchbDupWarning({ firstName, lastName, dob = '' }) {
  const dFirst = useDebounced((firstName || '').trim(), 500);
  const dLast = useDebounced((lastName || '').trim(), 500);
  const dDob = useDebounced((dob || '').trim(), 500);

  const [state, setState] = useState({ status: 'idle' });
  const [dismissedKey, setDismissedKey] = useState('');
  const [clearIn, setClearIn] = useState(false);
  const reqId = useRef(0);

  const key = `${dLast}|${dFirst}|${dDob}`;

  useEffect(() => {
    if (!dFirst || !dLast || dFirst.length < 2 || dLast.length < 2) {
      setState({ status: 'idle' });
      setClearIn(false);
      return;
    }
    const id = ++reqId.current;
    setState({ status: 'checking', withDob: !!dDob });
    setClearIn(false);
    let cancelled = false;
    (async () => {
      try {
        const result = await runHchbDupCheck({
          first_name: dFirst,
          last_name: dLast,
          ...(dDob ? { dob: dDob } : {}),
        });
        if (cancelled || reqId.current !== id) return;
        setState({ status: 'result', result });
      } catch (err) {
        if (cancelled || reqId.current !== id) return;
        setState({ status: 'error', error: err.message || 'Check failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [dFirst, dLast, dDob]);

  const r = state.status === 'result' ? (state.result || {}) : null;
  const strong = !!(r && (r.confidence === 'strong' || r.duplicate === true));
  const soft = !!(r && !strong && (r.confidence === 'soft' || r.possible_match === true));
  const clear = !!(r && r.ok !== false && !soft && !strong && r.configured !== false);

  useEffect(() => {
    if (!clear || dismissedKey === key) {
      setClearIn(false);
      return;
    }
    const t = requestAnimationFrame(() => setClearIn(true));
    return () => cancelAnimationFrame(t);
  }, [clear, key, dismissedKey]);

  if (state.status === 'idle') return null;
  if (dismissedKey === key && state.status === 'result') return null;

  if (state.status === 'checking') {
    return (
      <Row accent="#9AA0A6">
        <Text muted>
          {state.withDob ? 'Rechecking HCHB with date of birth…' : 'Checking HCHB…'}
        </Text>
      </Row>
    );
  }

  if (state.status === 'error') {
    return (
      <Row accent="#9AA0A6">
        <Text muted>HCHB check unavailable right now.</Text>
      </Row>
    );
  }

  if (!r?.ok && r?.configured === false) return null;

  const display = `${dFirst} ${dLast}`.trim();

  if (clear) {
    return (
      <div
        data-testid="hchb-dup-clear"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          marginBottom: 2,
          padding: '7px 10px 7px 9px',
          borderRadius: 8,
          background: hexToRgba(palette.accentGreen.hex, 0.1),
          opacity: clearIn ? 1 : 0,
          transform: clearIn ? 'translateY(0)' : 'translateY(5px)',
          transition: 'opacity 0.28s ease, transform 0.28s ease',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: palette.accentGreen.hex,
            boxShadow: `0 0 0 3px ${hexToRgba(palette.accentGreen.hex, 0.22)}`,
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: palette.accentGreen.hex,
          letterSpacing: '-0.01em',
          lineHeight: 1.35,
        }}>
          {display} is not an active patient in HCHB
        </span>
        <button
          type="button"
          onClick={() => setDismissedKey(key)}
          aria-label="Dismiss"
          style={{
            marginLeft: 2,
            flexShrink: 0,
            width: 20,
            height: 20,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: hexToRgba(palette.accentGreen.hex, 0.55),
            fontSize: 15,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  if (strong) {
    return (
      <Row accent={palette.primaryMagenta.hex} data-testid="hchb-dup-warning">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title color={palette.primaryMagenta.hex}>Same name and date of birth in HCHB</Title>
          <Text>
            {display} matches an active HCHB patient. Confirm there before creating a new chart.
          </Text>
        </div>
        <Dismiss onClick={() => setDismissedKey(key)} />
      </Row>
    );
  }

  if (soft) {
    return (
      <Row accent={palette.accentOrange.hex} data-testid="hchb-dup-warning">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title color={palette.accentOrange.hex}>
            {dDob ? 'Same name in HCHB, different date of birth' : 'Name found in HCHB'}
          </Title>
          <Text>
            {dDob
              ? `${display} is an active HCHB name, but not with this date of birth. Confirm in HCHB if you are unsure.`
              : `${display} matches an active HCHB patient name. Add a date of birth to confirm, or look them up in HCHB.`}
          </Text>
        </div>
        <Dismiss onClick={() => setDismissedKey(key)} />
      </Row>
    );
  }

  return null;
}

function Row({ accent, children, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        marginTop: 14,
        marginBottom: 4,
        paddingLeft: 12,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      {children}
    </div>
  );
}

function Title({ children, color }) {
  return (
    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color, letterSpacing: '-0.01em' }}>
      {children}
    </p>
  );
}

function Text({ children, muted }) {
  return (
    <p style={{
      margin: muted ? 0 : '3px 0 0',
      fontSize: 12.5,
      lineHeight: 1.4,
      fontWeight: muted ? 500 : 450,
      color: muted ? 'rgba(26, 26, 46, 0.45)' : 'rgba(26, 26, 46, 0.72)',
    }}>
      {children}
    </p>
  );
}

function Dismiss({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'rgba(26, 26, 46, 0.35)',
        fontSize: 16,
        lineHeight: 1,
        padding: 0,
      }}
    >
      ×
    </button>
  );
}
