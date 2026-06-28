/**
 * PhysicianTab — the patient's physician, universalized.
 *
 * The patient's physician is anchored on `referral.physician_id` (the same link
 * used at intake and on the Referral tab). If that's empty but triage captured a
 * linked PCP (`pcp_physician_id`), we surface — and promote — that here so the
 * physician stays consistent across Referral → Triage → this tab.
 *
 * The NPI / PECOS / OPRA verification below operates on the shared Physicians
 * directory record, so a check run here is identical to one run from the
 * Physicians directory drawer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCareStore, updateEntity } from '../../../store/careStore.js';
import { updateReferral } from '../../../api/referrals.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import PhysicianVerificationPanel from '../../physicians/PhysicianVerificationPanel.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function findTriagePcpId(triageAdult, triagePediatric, referralId) {
  if (!referralId) return null;
  for (const map of [triageAdult, triagePediatric]) {
    const rec = Object.values(map || {}).find((t) => t.referral_id === referralId);
    if (rec?.pcp_physician_id) return rec.pcp_physician_id;
  }
  return null;
}

export default function PhysicianTab({ referral, readOnly = false }) {
  const storePhysicians = useCareStore((s) => s.physicians);
  const triageAdult = useCareStore((s) => s.triageAdult);
  const triagePediatric = useCareStore((s) => s.triagePediatric);
  const { updateReferralLocal } = usePatientDrawer();
  const [saving, setSaving] = useState(false);
  const promotedRef = useRef(false);

  const triagePcpId = useMemo(
    () => findTriagePcpId(triageAdult, triagePediatric, referral?.id),
    [triageAdult, triagePediatric, referral?.id],
  );

  const physicianId = referral?.physician_id || triagePcpId || null;

  const physician = useMemo(() => {
    if (!physicianId) return null;
    return Object.values(storePhysicians || {}).find((p) => p.id === physicianId || p._id === physicianId) || null;
  }, [storePhysicians, physicianId]);

  // Universalize: if triage knows the PCP but the referral link is empty,
  // promote it onto the referral once so every surface agrees.
  useEffect(() => {
    if (promotedRef.current) return;
    if (readOnly) return;
    if (!referral?._id) return;
    if (referral.physician_id) return;
    if (!triagePcpId) return;
    promotedRef.current = true;
    updateReferralLocal?.({ physician_id: triagePcpId });
    updateEntity('referrals', referral._id, { physician_id: triagePcpId });
    updateReferral(referral._id, { physician_id: triagePcpId }).catch(() => {});
  }, [referral?._id, referral?.physician_id, triagePcpId, readOnly, updateReferralLocal]);

  async function handlePick(phy) {
    const newId = phy?.id || phy?._id || '';
    if (!referral?._id) return;
    updateReferralLocal?.({ physician_id: newId });
    updateEntity('referrals', referral._id, { physician_id: newId });
    setSaving(true);
    try {
      await updateReferral(referral._id, { physician_id: newId });
    } catch {
      // Revert optimistic update on failure.
      updateReferralLocal?.({ physician_id: referral.physician_id || '' });
      updateEntity('referrals', referral._id, { physician_id: referral.physician_id || '' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '20px 22px 40px' }}>
      {!referral?._id ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic' }}>
          This patient has no active referral, so a physician can't be linked here yet.
        </p>
      ) : (
        <>
          {triagePcpId && !referral.physician_id && (
            <p style={{ fontSize: 11.5, color: palette.accentBlue.hex, background: hexToRgba(palette.accentBlue.hex, 0.08), borderRadius: 6, padding: '7px 10px', marginBottom: 12 }}>
              Pulled the physician captured during triage. It’s now linked to this referral.
            </p>
          )}

          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 10 }}>
            Physician {saving && <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>· saving…</span>}
          </p>

          <div style={{ marginBottom: 18 }}>
            <PhysicianPicker
              physicianId={physicianId}
              physicianName={physician ? undefined : null}
              onChange={handlePick}
              readOnly={readOnly}
            />
          </div>

          <PhysicianVerificationPanel physician={physician} readOnly={readOnly} compact />
        </>
      )}
    </div>
  );
}
