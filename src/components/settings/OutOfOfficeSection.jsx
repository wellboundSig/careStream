import { useEffect, useMemo, useState } from 'react';
import airtable from '../../api/airtable.js';
import { useCareStore, updateEntity } from '../../store/careStore.js';
import { useCurrentAppUser, patchAppUserCache } from '../../hooks/useCurrentAppUser.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import {
  formatOooDate,
  isUserOoo,
  isUserOooScheduled,
  oooWindowLabel,
} from '../../utils/outOfOffice.js';

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        background: checked ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.18),
        transition: 'background 0.2s',
        flexShrink: 0,
        padding: 0,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 23 : 3,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: palette.backgroundLight.hex,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }} />
    </button>
  );
}

/**
 * Self-serve Out of Office controls for Settings.
 * Modes:
 *  - open: from now / enable, no return date (manual off)
 *  - window: leave + return dates
 */
export default function OutOfOfficeSection() {
  const { appUser, appUserId } = useCurrentAppUser();
  const storeUsers = useCareStore((s) => s.users);

  const me = useMemo(() => {
    if (!appUserId) return appUser || null;
    return Object.values(storeUsers || {}).find((u) => u.id === appUserId) || appUser || null;
  }, [storeUsers, appUserId, appUser]);

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState('open'); // 'open' | 'window'
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!me) return;
    const on = !!me.ooo_active;
    setEnabled(on);
    const start = me.ooo_starts_on ? String(me.ooo_starts_on).slice(0, 10) : '';
    const end = me.ooo_ends_on ? String(me.ooo_ends_on).slice(0, 10) : '';
    setStartsOn(start);
    setEndsOn(end);
    setMode(on && end ? 'window' : 'open');
  }, [me?._id, me?.ooo_active, me?.ooo_starts_on, me?.ooo_ends_on]);

  const currentlyOoo = isUserOoo(me);
  const scheduled = isUserOooScheduled(me);

  async function persist(fields) {
    if (!me?._id) {
      setError('Your user record is not loaded yet. Try refreshing.');
      return;
    }
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    updateEntity('users', me._id, fields);
    patchAppUserCache(fields);
    try {
      await airtable.update('Users', me._id, fields);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
    } catch (err) {
      setError(err.message || 'Failed to save Out of Office');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!enabled) {
      // Turn on — default open-ended from today
      const today = todayYmd();
      setEnabled(true);
      setMode('open');
      setStartsOn(today);
      setEndsOn('');
      await persist({
        ooo_active: true,
        ooo_starts_on: today,
        ooo_ends_on: null,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    setEnabled(false);
    setStartsOn('');
    setEndsOn('');
    await persist({
      ooo_active: false,
      ooo_starts_on: null,
      ooo_ends_on: null,
      updated_at: new Date().toISOString(),
    });
  }

  async function handleSaveWindow() {
    if (!enabled) return;
    if (mode === 'open') {
      await persist({
        ooo_active: true,
        ooo_starts_on: startsOn || todayYmd(),
        ooo_ends_on: null,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    if (!startsOn || !endsOn) {
      setError('Choose both leave and return dates.');
      return;
    }
    if (endsOn < startsOn) {
      setError('Return date must be on or after the leave date.');
      return;
    }
    await persist({
      ooo_active: true,
      ooo_starts_on: startsOn,
      ooo_ends_on: endsOn,
      updated_at: new Date().toISOString(),
    });
  }

  const inputStyle = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    fontSize: 13,
    fontFamily: 'inherit',
    background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex,
  };

  return (
    <div style={{
      background: palette.backgroundLight.hex,
      border: `1px solid var(--color-border)`,
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
          Out of Office
        </h2>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 0', lineHeight: 1.45 }}>
          Let managers know when you are away. They can still assign cases and tasks to you — they will see a warning first.
        </p>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderBottom: enabled ? `1px solid var(--color-border)` : 'none',
      }}>
        <div>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, margin: 0 }}>
            I am out of office
          </p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '2px 0 0', lineHeight: 1.4 }}>
            Default is off. Turn on when you leave, or schedule dates ahead of time.
          </p>
        </div>
        <Toggle checked={enabled} onChange={handleToggle} disabled={saving || !me?._id} />
      </div>

      {(currentlyOoo || scheduled) && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 9,
          background: hexToRgba(currentlyOoo ? palette.accentOrange.hex : palette.highlightYellow.hex, 0.1),
          border: `1px solid ${hexToRgba(currentlyOoo ? palette.accentOrange.hex : palette.highlightYellow.hex, 0.25)}`,
        }}>
          <p style={{
            fontSize: 12.5, fontWeight: 650, margin: 0,
            color: currentlyOoo ? palette.accentOrange.hex : '#7A5F00',
          }}>
            {currentlyOoo ? 'Currently out of office' : 'Out of office scheduled'}
            {oooWindowLabel(me) ? ` · ${oooWindowLabel(me)}` : ''}
          </p>
        </div>
      )}

      {enabled && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
              padding: '10px 12px', borderRadius: 9,
              border: `1px solid ${mode === 'open' ? palette.accentOrange.hex : 'var(--color-border)'}`,
              background: mode === 'open' ? hexToRgba(palette.accentOrange.hex, 0.06) : 'transparent',
            }}>
              <input
                type="radio"
                name="ooo-mode"
                checked={mode === 'open'}
                onChange={() => {
                  setMode('open');
                  setEndsOn('');
                  if (!startsOn) setStartsOn(todayYmd());
                }}
                style={{ marginTop: 2, accentColor: palette.accentOrange.hex }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                  From now — no return date
                </span>
                <span style={{ display: 'block', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2, lineHeight: 1.4 }}>
                  Stay marked OOO until you turn it off here.
                </span>
              </span>
            </label>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
              padding: '10px 12px', borderRadius: 9,
              border: `1px solid ${mode === 'window' ? palette.accentOrange.hex : 'var(--color-border)'}`,
              background: mode === 'window' ? hexToRgba(palette.accentOrange.hex, 0.06) : 'transparent',
            }}>
              <input
                type="radio"
                name="ooo-mode"
                checked={mode === 'window'}
                onChange={() => setMode('window')}
                style={{ marginTop: 2, accentColor: palette.accentOrange.hex }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                  Specific dates
                </span>
                <span style={{ display: 'block', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2, lineHeight: 1.4 }}>
                  Vacation or planned leave with a return date.
                </span>
              </span>
            </label>
          </div>

          {mode === 'window' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '0 0 6px' }}>
                  Leave date
                </p>
                <input
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '0 0 6px' }}>
                  Return date
                </p>
                <input
                  type="date"
                  value={endsOn}
                  min={startsOn || undefined}
                  onChange={(e) => setEndsOn(e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>
          )}

          {mode === 'open' && (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
              Started {formatOooDate(startsOn || todayYmd()) || 'today'} · ends when you turn this off
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleSaveWindow}
              disabled={saving}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: saving ? hexToRgba(palette.accentOrange.hex, 0.45) : palette.accentOrange.hex,
                color: palette.backgroundLight.hex,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save dates'}
            </button>
            {savedFlash && (
              <span style={{ fontSize: 12, fontWeight: 600, color: palette.accentGreen.hex }}>Saved</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, margin: '12px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  );
}
