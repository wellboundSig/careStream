/**
 * Modal to reassign marketer_id (requires referral.change_marketer).
 */
import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { changeMarketer } from '../../utils/changeMarketer.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function marketerName(m) {
  if (!m) return '';
  return `${m.first_name || ''} ${m.last_name || ''}`.trim();
}

export default function ChangeMarketerModal({
  referral,
  patientName,
  onDone,
  onCancel,
}) {
  const storeMarketers = useCareStore((s) => s.marketers);
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveMarketer } = useLookups();

  const currentId = String(referral?.marketer_id || '').trim();
  const currentLabel = currentId
    ? (resolveMarketer(currentId) || currentId)
    : 'Unassigned';

  const marketers = useMemo(() => {
    const list = Object.values(storeMarketers || {})
      .filter((m) => {
        const id = String(m.id || '').trim();
        if (!id) return false;
        const active = !m.status || m.status === 'Active';
        return active || id === currentId;
      })
      .sort((a, b) => marketerName(a).localeCompare(marketerName(b)));
    return list;
  }, [storeMarketers, currentId]);

  const [marketerId, setMarketerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selected = marketers.find((m) => String(m.id || '').trim() === marketerId);
  const canSubmit = !!marketerId && marketerId !== currentId && !saving;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { fields } = await changeMarketer({
        referral,
        newMarketerId: marketerId,
        actorUserId: appUserId,
        actorName: appUserName,
        previousMarketerName: currentLabel,
        newMarketerName: marketerName(selected) || marketerId,
        newMarketerUserId: selected?.user_id || null,
        patientLabel: patientName || referral?.patientName || referral?.patient_id,
      });
      onDone?.(fields);
    } catch (err) {
      setError(err?.message || 'Failed to change marketer');
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && !saving && onCancel?.()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 440,
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Change marketer</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4, lineHeight: 1.4 }}>
            {patientName || referral?.patientName || referral?.patient_id || 'Patient'}
            {' · '}Current marketer: <strong style={{ fontWeight: 650 }}>{currentLabel}</strong>
          </p>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              New marketer
            </span>
            <select
              value={marketerId}
              onChange={(e) => setMarketerId(e.target.value)}
              disabled={saving}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: `1px solid var(--color-border)`, fontSize: 13.5,
                color: palette.backgroundDark.hex, background: palette.backgroundLight.hex,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <option value="">Select marketer…</option>
              {marketers.map((m) => {
                const id = String(m.id || '').trim();
                return (
                  <option key={m._id || id} value={id} disabled={id === currentId}>
                    {marketerName(m) || id}{m.division ? ` · ${m.division}` : ''}{id === currentId ? ' (current)' : ''}
                  </option>
                );
              })}
            </select>
          </label>

          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, lineHeight: 1.4 }}>
            This writes a timeline event and an audit log entry. The original lead submitter and intake owner are not changed.
          </p>

          {error && (
            <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex, margin: 0 }}>{error}</p>
          )}
        </div>

        <div style={{
          padding: '14px 22px', borderTop: `1px solid var(--color-border)`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid var(--color-border)`,
              background: 'none', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              color: hexToRgba(palette.backgroundDark.hex, 0.55),
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.12),
              color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.35),
              fontSize: 13, fontWeight: 650, cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : 'Change marketer'}
          </button>
        </div>
      </div>
    </div>
  );
}
