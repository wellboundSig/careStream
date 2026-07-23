/**
 * Modal to reassign intake_owner_id (requires leads.change_intake_owner).
 */
import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { changeIntakeOwner } from '../../utils/changeIntakeOwner.js';
import { isUserOoo, oooOptionSuffix } from '../../utils/outOfOffice.js';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function ChangeIntakeOwnerModal({
  referral,
  patientName,
  onDone,
  onCancel,
}) {
  const storeUsers = useCareStore((s) => s.users);
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser } = useLookups();

  const currentOwnerId = referral?.intake_owner_id || '';
  const currentOwnerLabel = currentOwnerId
    ? (resolveUser(currentOwnerId) || currentOwnerId)
    : 'Unassigned';

  const users = useMemo(() => {
    return Object.values(storeUsers || {})
      .filter((u) => u.status === 'Active' || !u.status)
      .sort((a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`));
  }, [storeUsers]);

  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selected = users.find((u) => u.id === ownerId);
  const canSubmit = !!ownerId && ownerId !== currentOwnerId && !saving;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const newOwnerName = selected
        ? `${selected.first_name || ''} ${selected.last_name || ''}`.trim()
        : ownerId;
      const { fields } = await changeIntakeOwner({
        referral,
        newOwnerId: ownerId,
        actorUserId: appUserId,
        actorName: appUserName,
        previousOwnerName: currentOwnerLabel,
        newOwnerName,
        patientLabel: patientName || referral?.patientName || referral?.patient_id,
      });
      onDone?.(fields);
    } catch (err) {
      setError(err?.message || 'Failed to change intake owner');
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
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Change intake owner</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4, lineHeight: 1.4 }}>
            {patientName || referral?.patientName || referral?.patient_id || 'Patient'}
            {' · '}Current owner: <strong style={{ fontWeight: 650 }}>{currentOwnerLabel}</strong>
          </p>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              New owner
            </span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={saving}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: `1px solid var(--color-border)`, fontSize: 13.5,
                color: palette.backgroundDark.hex, background: palette.backgroundLight.hex,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <option value="">Select staff…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id} disabled={u.id === currentOwnerId}>
                  {u.first_name} {u.last_name}{oooOptionSuffix(u)}{u.id === currentOwnerId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>

          {selected && isUserOoo(selected) && (
            <p style={{ fontSize: 12, color: palette.accentOrange.hex, margin: 0 }}>
              This user is currently marked out of office.
            </p>
          )}

          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, lineHeight: 1.4 }}>
            This writes a timeline event, an audit log entry, and notifies the new owner.
            The original lead submitter is never changed.
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
            {saving ? 'Saving…' : 'Change owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
