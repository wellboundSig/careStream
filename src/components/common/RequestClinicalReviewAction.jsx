/**
 * Pending Log / SOC Completed: assign a Clinical Intake RN for post-SOC review.
 */
import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../hooks/useLookups.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import {
  canRequestPostSocClinical,
  listClinicalRnUsers,
  requestPostSocClinicalReview,
} from '../../utils/requestPostSocClinicalReview.js';
import { isUserOoo, oooOptionSuffix } from '../../utils/outOfOffice.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function RequestClinicalReviewAction({
  referral,
  onDone,
  compact = false,
}) {
  const storeUsers = useCareStore((s) => s.users);
  const storeRoles = useCareStore((s) => s.roles);
  const cocNurseFacilities = useCareStore((s) => s.cocNurseFacilities);
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser } = useLookups();

  const [open, setOpen] = useState(false);
  const [rnId, setRnId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nurses = useMemo(
    () => listClinicalRnUsers({
      users: storeUsers,
      roles: storeRoles,
      cocNurseFacilities,
    }),
    [storeUsers, storeRoles, cocNurseFacilities],
  );

  if (!canRequestPostSocClinical(referral)) return null;

  const assignedId = referral.clinical_review_assigned_to_id || '';
  const assignedName = assignedId ? (resolveUser(assignedId) || assignedId) : null;
  const inReview = referral.in_clinical_review === true || referral.in_clinical_review === 'true';

  async function handleConfirm() {
    if (!rnId || busy) return;
    setBusy(true);
    setError('');
    try {
      const selected = nurses.find((u) => u.id === rnId);
      const assigneeName = selected
        ? `${selected.first_name || ''} ${selected.last_name || ''}`.trim()
        : rnId;
      const { fields } = await requestPostSocClinicalReview({
        referral,
        assigneeUserId: rnId,
        actorUserId: appUserId,
        actorName: appUserName,
        assigneeName,
        patientLabel: referral.patientName || referral.patient_id,
      });
      setOpen(false);
      setRnId('');
      triggerDataRefresh();
      onDone?.(fields);
    } catch (err) {
      setError(err?.message || 'Failed to assign clinical review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="request-clinical-review-action"
      style={{
        marginTop: compact ? 8 : 0,
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 8,
        background: hexToRgba(palette.primaryMagenta.hex, 0.06),
      }}
    >
      <p style={{
        margin: 0, fontSize: 12.5, fontWeight: 700,
        color: palette.primaryMagenta.hex,
      }}>
        Clinical review
      </p>
      {assignedName ? (
        <p style={{
          margin: '4px 0 0', fontSize: 12,
          color: hexToRgba(palette.backgroundDark.hex, 0.6), lineHeight: 1.4,
        }}>
          Assigned to <strong style={{ fontWeight: 650, color: palette.backgroundDark.hex }}>{assignedName}</strong>
          {inReview ? ' · in Clinical queue' : ''}
          {referral.clinical_review_assigned_at
            ? ` · ${fmtCalendarDate(referral.clinical_review_assigned_at) || ''}`
            : ''}
        </p>
      ) : (
        <p style={{
          margin: '4px 0 0', fontSize: 11.5,
          color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.4,
        }}>
          Alert a Clinical Review RN. Case stays on Completed and appears in Clinical Review.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          data-testid="request-clinical-review-btn"
          onClick={() => { setError(''); setRnId(assignedId || ''); setOpen(true); }}
          style={{
            marginTop: 10, width: '100%', height: 34, borderRadius: 7, border: 'none',
            fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
            background: palette.primaryMagenta.hex,
            color: palette.backgroundLight.hex,
          }}
        >
          {assignedName ? 'Reassign Clinical RN' : 'Request Clinical RN'}
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <select
            value={rnId}
            onChange={(e) => setRnId(e.target.value)}
            disabled={busy}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 7,
              border: '1px solid var(--color-border)', fontSize: 13,
              fontFamily: 'inherit', background: palette.backgroundLight.hex,
              color: palette.backgroundDark.hex, marginBottom: 8,
            }}
          >
            <option value="">Select Clinical RN…</option>
            {nurses.map((u) => (
              <option key={u.id} value={u.id}>
                {u.first_name} {u.last_name}{oooOptionSuffix(u)}
              </option>
            ))}
          </select>
          {nurses.length === 0 && (
            <p style={{ fontSize: 11.5, color: palette.accentOrange.hex, margin: '0 0 8px' }}>
              No Clinical RN users found.
            </p>
          )}
          {rnId && isUserOoo(nurses.find((u) => u.id === rnId)) && (
            <p style={{ fontSize: 11.5, color: palette.accentOrange.hex, margin: '0 0 8px' }}>
              This nurse is marked out of office.
            </p>
          )}
          {error && (
            <p style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, margin: '0 0 8px' }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              disabled={!rnId || busy}
              onClick={handleConfirm}
              style={{
                flex: 1, height: 32, borderRadius: 6, border: 'none',
                fontSize: 12, fontWeight: 650, cursor: rnId && !busy ? 'pointer' : 'not-allowed',
                background: rnId ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
                color: rnId ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
              }}
            >
              {busy ? 'Sending…' : 'Assign & notify'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(false); setError(''); }}
              style={{
                flex: 1, height: 32, borderRadius: 6, border: 'none',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: hexToRgba(palette.backgroundDark.hex, 0.06),
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
