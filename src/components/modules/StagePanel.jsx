import { useState, useEffect, useMemo } from 'react';
import ZipSearchPanel from '../staffing/ZipSearchPanel.jsx';
import { getConflictsByReferral } from '../../api/conflicts.js';
import { getFilesByPatient } from '../../api/patientFiles.js';
import { updateReferral } from '../../api/referrals.js';
import { updateDisenrollmentFlag } from '../../api/disenrollmentFlags.js';
import { updateReferralOptimistic } from '../../store/mutations.js';
import { isUrgentCare } from '../../utils/urgentCare.js';
import { createEpisode } from '../../api/episodes.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import { recordTransition } from '../../utils/recordTransition.js';
import { generateEmrPacket } from '../../utils/generateEmrPacket.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { useLookups } from '../../hooks/useLookups.js';
import EligibilityWorkspace from './shared/EligibilityWorkspace.jsx';
import AuthorizationWorkspace from './shared/AuthorizationWorkspace.jsx';
import OpwddWorkspace from './shared/OpwddWorkspace.jsx';
import { exportToExcel } from '../../utils/reportEngine.js';
import { useCareStore } from '../../store/careStore.js';
import { DISCARD_REASONS } from '../../data/stageConfig.js';
import ClinicalChecklistUI from '../clinical/ClinicalChecklistUI.jsx';
import { isChecklistComplete } from '../../data/clinicalChecklist.js';
import { F2F_REVIEW_CHECKLIST, F2F_REQUIRED_ITEMS, isF2FChecklistComplete } from '../../data/f2fChecklist.js';
import { useCursoryReview } from '../../hooks/useCursoryReview.js';
import FilePreviewModal from '../common/FilePreviewModal.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import PatientSnapshot from './PatientSnapshot.jsx';

const PIPELINE_STAGES = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC', 'SOC Scheduled',
];

// Shared panel wrapper ────────────────────────────────────────────────────────
function Panel({ children, width = 280 }) {
  return (
    <div style={{
      width, minWidth: width, borderLeft: `1px solid var(--color-border)`,
      background: hexToRgba(palette.backgroundDark.hex, 0.015),
      overflowY: 'auto', flexShrink: 0, padding: '16px 14px',
    }}>
      {children}
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: highlight || palette.backgroundDark.hex }}>{value || '—'}</span>
    </div>
  );
}

function ActionBtn({ label, variant = 'default', onClick, disabled = false }) {
  // forward = large primary CTA (one per panel), success = small green confirm,
  // warning = yellow caution, danger = orange negative, default = grey utility
  const styles = {
    forward:  { bg: palette.accentGreen.hex,                              color: palette.backgroundLight.hex,   pad: '11px 14px', size: 13.5,  weight: 700 },
    success:  { bg: hexToRgba(palette.accentGreen.hex, 0.13),             color: palette.accentGreen.hex,        pad: '8px 12px',  size: 12.5,  weight: 650 },
    warning:  { bg: palette.highlightYellow.hex,                          color: palette.backgroundDark.hex,     pad: '8px 12px',  size: 12.5,  weight: 650 },
    danger:   { bg: palette.accentOrange.hex,                             color: palette.backgroundLight.hex,    pad: '8px 12px',  size: 12.5,  weight: 650 },
    default:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),          color: hexToRgba(palette.backgroundDark.hex, 0.65), pad: '7px 12px', size: 12, weight: 600 },
    // legacy aliases kept for any inline callers
    primary:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),          color: hexToRgba(palette.backgroundDark.hex, 0.65), pad: '7px 12px', size: 12, weight: 600 },
  };
  const s = styles[variant] || styles.default;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: s.pad, borderRadius: 8,
        fontSize: s.size, fontWeight: s.weight,
        cursor: disabled ? 'not-allowed' : 'pointer', marginBottom: 6,
        background: s.bg, color: s.color, border: 'none',
        textAlign: 'left', transition: 'filter 0.12s',
        opacity: disabled ? 0.45 : 1,
        letterSpacing: variant === 'forward' ? '-0.01em' : 'normal',
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = 'brightness(1.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {label}
    </button>
  );
}

function CheckItem({ label, done, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 12.5, color: done ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex }}>
      <input type="checkbox" checked={!!done} onChange={(e) => onChange?.(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0 }} />
      <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
    </label>
  );
}

// Collapsible checklist — default closed, never gates any action button
function CollapsibleChecklist({ title, items, doneMap, onToggle }) {
  const [open, setOpen] = useState(false);
  const count = items.filter((i) => !!doneMap[i.key]).length;
  const pct   = items.length > 0 ? Math.round((count / items.length) * 100) : 0;
  const allDone = pct === 100;
  const barColor = allDone ? palette.accentGreen.hex : pct > 50 ? palette.highlightYellow.hex : palette.accentOrange.hex;
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: hexToRgba(palette.backgroundDark.hex, 0.04),
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.07))}
        onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04))}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{title}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {count}/{items.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 40, height: 3, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.1), overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4.5l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.4)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      {open && (
        <div style={{ padding: '6px 4px 0' }}>
          {items.map((item) => (
            <CheckItem key={item.key} label={item.label} done={!!doneMap[item.key]} onChange={() => onToggle(item.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReturnedFromClinicalFlag({ note }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid="returned-from-clinical-flag" style={{ borderRadius: 8, background: hexToRgba(palette.accentOrange.hex, 0.1), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.25)}`, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
      >
        <span style={{ fontSize: 12, fontWeight: 650, color: palette.accentOrange.hex }}>
          ↩ Returned from Clinical RN Review
        </span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4.5l4 4 4-4" stroke={palette.accentOrange.hex} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && note && (
        <div style={{ padding: '0 12px 10px' }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 3 }}>Reason:</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.55 }}>{note}</p>
        </div>
      )}
    </div>
  );
}

// Mirror of ReturnedFromClinicalFlag — surfaces when eligibility staff
// send a patient back to Intake with a required note. Sits at the top of
// the IntakePanel so the front-line intake user sees it immediately.
function ReturnedFromEligibilityFlag({ note, at }) {
  const [expanded, setExpanded] = useState(true);
  const ts = at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div data-testid="returned-from-eligibility-flag" style={{ borderRadius: 8, background: hexToRgba(palette.accentOrange.hex, 0.1), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.25)}`, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
      >
        <span style={{ fontSize: 12, fontWeight: 650, color: palette.accentOrange.hex }}>
          ↩ Returned from Eligibility{ts ? ` · ${ts}` : ''}
        </span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4.5l4 4 4-4" stroke={palette.accentOrange.hex} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && note && (
        <div style={{ padding: '0 12px 10px' }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 3 }}>Reason:</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.55 }}>{note}</p>
        </div>
      )}
    </div>
  );
}

function EmptyPanelState({ message }) {
  return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center', paddingTop: 24 }}>{message || 'Select a patient to see details.'}</p>;
}

// ── 1. Lead Entry (Leads) ─────────────────────────────────────────────────────

function DiscardModal({ referral, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const canSubmit = reason && explanation.trim();

  return (
    <div onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Discard Lead</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
            {referral.patientName || referral.patient_id} will be moved to Discarded Leads.
          </p>
        </div>
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p data-testid="discard-reason-label" style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>Reason *</p>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${reason ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex }}>
              <option value="">Select a reason…</option>
              {DISCARD_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>Explanation *</p>
            <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Provide details about why this lead is being discarded…" rows={3} style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${explanation.trim() ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '7px 18px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 13, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => canSubmit && onConfirm(reason, explanation.trim())} disabled={!canSubmit} style={{ padding: '7px 20px', borderRadius: 7, background: canSubmit ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.07), border: 'none', fontSize: 13, fontWeight: 650, color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            Discard Lead
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteToIntakeModal({ referral, onConfirm, onCancel }) {
  const { canAssignTo } = usePermissions();
  const storeUsers = useCareStore((s) => s.users);
  const users = Object.values(storeUsers)
    .filter((u) => u.status === 'Active' || !u.status)
    .filter((u) => canAssignTo(u.id));
  const [ownerId, setOwnerId] = useState('');
  const canSubmit = !!ownerId;

  return (
    <div onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Move to Intake</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
            Assign an intake owner for {referral.patientName || referral.patient_id}.
          </p>
        </div>
        <div style={{ padding: '18px 22px' }}>
          <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>Assign Owner *</p>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} data-testid="owner-select" style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${ownerId ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex }}>
            <option value="">Select staff member…</option>
            {users.map((u) => (
              <option key={u.id || u._id} value={u.id}>{u.first_name} {u.last_name}</option>
            ))}
          </select>
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '7px 18px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 13, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => canSubmit && onConfirm(ownerId)} disabled={!canSubmit} style={{ padding: '7px 20px', borderRadius: 7, background: canSubmit ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07), border: 'none', fontSize: 13, fontWeight: 650, color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            Move to Intake
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadEntryPanel({ referrals, selectedReferral, resolveSource, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const [showDiscard, setShowDiscard] = useState(false);
  const [showPromote, setShowPromote] = useState(false);

  const today = referrals.filter((r) => Date.now() - new Date(r.referral_date).getTime() < 86400000).length;
  const thisWeek = referrals.filter((r) => Date.now() - new Date(r.referral_date).getTime() < 7 * 86400000).length;

  function handleDiscard(reason, explanation) {
    if (!selectedReferral) return;
    const note = `[Discarded] ${reason}\n${explanation}`;
    const ts = new Date().toISOString();
    updateReferralOptimistic(selectedReferral._id, {
      current_stage: 'Discarded Leads',
      discard_reason: reason,
      discard_explanation: explanation,
      updated_at: ts,
    }).catch(() => {});
    recordTransition({ referral: selectedReferral, fromStage: 'Lead Entry', toStage: 'Discarded Leads', note, authorId: appUserId });
    triggerDataRefresh();
    onSelectedReferralLeftModule?.();
    setShowDiscard(false);
  }

  function handlePromote(ownerId) {
    if (!selectedReferral) return;
    const ts = new Date().toISOString();
    const fields = { current_stage: 'Intake', intake_owner_id: ownerId, updated_at: ts };
    updateReferralOptimistic(selectedReferral._id, fields)
      .then(() => { console.log('[LeadEntry] Moved to Intake successfully'); })
      .catch((err) => { console.error('[LeadEntry] Move failed:', err); window.alert?.('Failed to move to Intake: ' + err.message); });
    // Resolve the staff member's display name so the timeline note never
    // surfaces a raw `usr_###` id to a clinical/business reader.
    const ownerUser = Object.values(useCareStore.getState().users || {}).find((u) => u.id === ownerId);
    const ownerName = ownerUser ? `${ownerUser.first_name || ''} ${ownerUser.last_name || ''}`.trim() : ownerId;
    recordTransition({
      referral: selectedReferral,
      fromStage: 'Lead Entry',
      toStage: 'Intake',
      note: `Owner assigned: ${ownerName}`,
      authorId: appUserId,
    });
    triggerDataRefresh();
    onSelectedReferralLeftModule?.();
    setShowPromote(false);
  }

  return (
    <Panel>
      <PanelSection title="Lead Stats">
        <InfoRow label="Today" value={today} highlight={today > 0 ? palette.primaryMagenta.hex : null} />
        <InfoRow label="This week" value={thisWeek} />
        <InfoRow label="Total in queue" value={referrals.length} />
      </PanelSection>

      {selectedReferral && (
        <PanelSection title="Lead Actions">
          {canPerm(PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE) && (
            <ActionBtn label="Move to Intake →" variant="forward" onClick={() => setShowPromote(true)} />
          )}
          {!canPerm(PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE) && (
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', marginBottom: 8 }}>
              Only supervisors can move leads to Intake.
            </p>
          )}
          {canPerm(PERMISSION_KEYS.LEADS_DISCARD) && (
            <ActionBtn label="Discard Lead" variant="warning" onClick={() => setShowDiscard(true)} />
          )}
        </PanelSection>
      )}

      <PanelSection title="Source Breakdown">
        {(() => {
          const counts = {};
          referrals.forEach((r) => { const label = resolveSource ? resolveSource(r.referral_source_id || 'Unknown') : (r.referral_source_id || 'Unknown'); counts[label] = (counts[label] || 0) + 1; });
          const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
          return sorted.length === 0
            ? <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No data yet.</p>
            : sorted.slice(0, 7).map(([label, n]) => <InfoRow key={label} label={label} value={n} />);
        })()}
      </PanelSection>

      {showDiscard && selectedReferral && <DiscardModal referral={selectedReferral} onConfirm={handleDiscard} onCancel={() => setShowDiscard(false)} />}
      {showPromote && selectedReferral && <PromoteToIntakeModal referral={selectedReferral} onConfirm={handlePromote} onCancel={() => setShowPromote(false)} />}
    </Panel>
  );
}

// ── 1b. Discarded Leads ───────────────────────────────────────────────────────
function DiscardedLeadsPanel({ referrals, selectedReferral, onInitiateTransition }) {
  const byReason = {};
  referrals.forEach((r) => { const k = r.discard_reason || 'Unspecified'; byReason[k] = (byReason[k] || 0) + 1; });

  return (
    <Panel>
      <PanelSection title="Discard Summary">
        <InfoRow label="Total discarded" value={referrals.length} />
        {Object.entries(byReason).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
          <InfoRow key={reason} label={reason} value={count} />
        ))}
      </PanelSection>

      {selectedReferral && (
        <PanelSection title="Selected Lead">
          <InfoRow label="Patient" value={selectedReferral.patientName} />
          <InfoRow label="Reason" value={selectedReferral.discard_reason || '—'} />
          {selectedReferral.discard_explanation && (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 3 }}>Explanation</p>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.5 }}>{selectedReferral.discard_explanation}</p>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <ActionBtn label="Restore to Leads" variant="forward" onClick={() => onInitiateTransition?.(selectedReferral, 'Lead Entry')} />
          </div>
        </PanelSection>
      )}

      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          Discarded leads are kept for reporting. They can be restored to Leads if needed.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── 2. Intake ─────────────────────────────────────────────────────────────────
const INTAKE_DEMO_FIELDS = [
  { key: 'first_name',      label: 'First name' },
  { key: 'last_name',       label: 'Last name' },
  { key: 'dob',             label: 'Date of birth' },
  { key: 'phone_primary',   label: 'Primary phone' },
  { key: 'address_street',  label: 'Street address' },
  { key: 'medicaid_number', label: 'Medicaid number' },
];

function IntakePanel({ referrals, selectedReferral, onOpenTriage, onOpenFiles, onOpenTab, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const p = selectedReferral?.patient;
  const doneMap = Object.fromEntries(INTAKE_DEMO_FIELDS.map(({ key }) => [key, !!(p?.[key])]));
  const isSN = selectedReferral?.division === 'Special Needs';
  const isF2F = selectedReferral?.current_stage === 'F2F/MD Orders Pending';

  const triageAdultStore = useCareStore((s) => s.triageAdult);
  const triagePedStore = useCareStore((s) => s.triagePediatric);
  const insuranceCheckStore = useCareStore((s) => s.insuranceChecks);
  const refId = selectedReferral?.id;
  const refAirtableId = selectedReferral?._id;
  const triageData = [...Object.values(triageAdultStore || {}), ...Object.values(triagePedStore || {})].find((t) => {
    const tid = t.referral_id;
    if (!tid || !refId) return false;
    if (tid === refId || tid === refAirtableId) return true;
    if (Array.isArray(tid) && (tid.includes(refId) || tid.includes(refAirtableId))) return true;
    return false;
  }) || null;
  const patientInsuranceChecks = Object.values(insuranceCheckStore || {}).filter((c) => {
    const pid = c.patient_id;
    const target = selectedReferral?.patient_id;
    if (!pid || !target) return false;
    if (pid === target) return true;
    if (Array.isArray(pid) && pid.includes(target)) return true;
    return false;
  });

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewChecked, setReviewChecked] = useState({});

  useEffect(() => {
    setShowDatePicker(false);
    setReceivedDate('');
    setReviewChecked({});
  }, [selectedReferral?._id]);

  const reviewComplete = isF2FChecklistComplete(reviewChecked);
  const completedReq = F2F_REQUIRED_ITEMS.filter((i) => reviewChecked[i.key]).length;
  const totalReq = F2F_REQUIRED_ITEMS.length;

  function daysLeft(exp) {
    if (!exp) return null;
    return Math.ceil((new Date(exp) - Date.now()) / 86400000);
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0];
  }
  async function handleLogReceived() {
    if (!receivedDate || !selectedReferral) return;
    setSaving(true);
    try {
      const expiration = addDays(receivedDate, 90);
      await updateReferral(selectedReferral._id, { f2f_date: receivedDate, f2f_expiration: expiration });
      triggerDataRefresh();
      setShowDatePicker(false); setReceivedDate('');
    } catch {} finally { setSaving(false); }
  }

  const days = selectedReferral ? daysLeft(selectedReferral.f2f_expiration) : null;
  const urgencyColor = days === null ? null : days < 0 ? palette.primaryMagenta.hex : days <= 7 ? palette.primaryMagenta.hex : days <= 14 ? palette.accentOrange.hex : days <= 30 ? '#7A5F00' : palette.accentGreen.hex;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          {/* Sub-stage indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: isF2F ? hexToRgba(palette.accentOrange.hex, 0.12) : hexToRgba(palette.accentBlue.hex, 0.12), color: isF2F ? palette.accentOrange.hex : palette.accentBlue.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {isF2F ? 'F2F/MD Orders' : 'Intake'}
            </span>
          </div>

          <PatientSnapshot
            patient={selectedReferral?.patient}
            referral={selectedReferral}
            triageData={triageData}
            insuranceChecks={patientInsuranceChecks}
            onOpenTab={(tab) => onOpenTab?.(selectedReferral, tab)}
          />

          {/* Returned from Eligibility — required note becomes a flag here */}
          {selectedReferral.eligibility_returned_to_intake_note && (
            <ReturnedFromEligibilityFlag note={selectedReferral.eligibility_returned_to_intake_note} at={selectedReferral.eligibility_returned_to_intake_at} />
          )}

          {/* F2F section — shown for F2F-stage referrals */}
          {isF2F && (
            <>
              <PanelSection title="F2F Status">
                {days !== null ? (
                  <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
                    <p style={{ fontSize: 28, fontWeight: 800, color: urgencyColor, lineHeight: 1 }}>{days < 0 ? 'EXPIRED' : `${days}d`}</p>
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 3 }}>{days < 0 ? 'F2F has expired' : 'until expiration'}</p>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '6px 0' }}>No F2F date recorded</p>
                )}
                <InfoRow label="PECOS" value={selectedReferral.is_pecos_verified === 'TRUE' || selectedReferral.is_pecos_verified === true ? 'Yes' : 'No'} highlight={selectedReferral.is_pecos_verified === 'TRUE' || selectedReferral.is_pecos_verified === true ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
                <InfoRow label="OPRA" value={selectedReferral.is_opra_verified === 'TRUE' || selectedReferral.is_opra_verified === true ? 'Yes' : 'No'} />
              </PanelSection>

              {canPerm(PERMISSION_KEYS.CLINICAL_F2F) && (
                <PanelSection title="Log F2F Date">
                  {!showDatePicker ? (
                    <ActionBtn
                      label={selectedReferral.f2f_date ? 'Update F2F Date' : 'F2F / MD Orders Received'}
                      variant={selectedReferral.f2f_date ? 'default' : 'success'}
                      onClick={() => { if (selectedReferral.f2f_date) setReceivedDate(new Date(selectedReferral.f2f_date).toISOString().split('T')[0]); setShowDatePicker(true); }}
                    />
                  ) : (
                    <div style={{ borderRadius: 8, background: hexToRgba(palette.accentGreen.hex, 0.04), padding: '10px' }}>
                      <input type="date" value={receivedDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setReceivedDate(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${receivedDate ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 12, fontFamily: 'inherit', outline: 'none', marginBottom: 6 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleLogReceived} disabled={!receivedDate || saving} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: receivedDate ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.08), color: receivedDate ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), fontSize: 11, fontWeight: 650, cursor: receivedDate ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving...' : 'Confirm'}</button>
                        <button onClick={() => { setShowDatePicker(false); setReceivedDate(''); }} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 11, fontWeight: 650, cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <ActionBtn label="Go to Files" variant="default" onClick={() => onOpenFiles?.(selectedReferral)} />
                </PanelSection>
              )}

              <PanelSection title="Document Review">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Cursory Review</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: reviewComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>{completedReq}/{totalReq}</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${totalReq > 0 ? Math.round((completedReq / totalReq) * 100) : 0}%`, background: reviewComplete ? palette.accentGreen.hex : palette.accentOrange.hex, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
                {F2F_REVIEW_CHECKLIST.map((item) => (
                  <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!reviewChecked[item.key]} onChange={() => setReviewChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))} style={{ accentColor: palette.accentGreen.hex, width: 12, height: 12, flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: reviewChecked[item.key] ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex, textDecoration: reviewChecked[item.key] ? 'line-through' : 'none', fontWeight: item.required ? 550 : 400 }}>
                      {item.label}{item.required && !reviewChecked[item.key] ? ' *' : ''}
                    </span>
                  </label>
                ))}

                {/* Push-to-Clinical lives DIRECTLY UNDER the cursory review
                    checkboxes per spec — it's only clickable once every
                    required item is checked off. Once fired it flips the
                    `in_clinical_review` flag but does NOT change current_stage
                    (the patient remains in Intake until Insurance Details are
                    collected and the user pushes to Eligibility). */}
                <PushToClinicalRNButton
                  referral={selectedReferral}
                  cursoryReviewComplete={reviewComplete}
                  actorUserId={appUserId}
                />
              </PanelSection>
            </>
          )}

          {/* Final forward button — Push to Eligibility. Only relevant once
              Clinical RN has been pushed AND Insurance Details are collected. */}
          <PushToEligibilityAction
            referral={selectedReferral}
            insuranceComplete={patientInsuranceChecks?.length > 0}
            onOpenTriage={() => onOpenTriage?.(selectedReferral)}
            onInitiateTransition={onInitiateTransition}
            isSN={isSN}
          />
        </>
      )}
    </Panel>
  );
}

// ── Push to Clinical RN — lives under the cursory review checkboxes ──────────
// Gating: ONLY enabled when every required item in the cursory review is
// checked. Other readiness gates (demographics / triage) are surfaced as
// status dots in the PatientSnapshot above; this button intentionally only
// cares about the cursory review per the 2026-05-20 UX spec.
function PushToClinicalRNButton({ referral, cursoryReviewComplete, actorUserId }) {
  const inClinical = referral?.in_clinical_review === true || referral?.in_clinical_review === 'true';

  async function handlePushClinical() {
    if (!referral?._id) return;
    try {
      await updateReferralOptimistic(referral._id, {
        in_clinical_review: true,
        clinical_review_pushed_at: new Date().toISOString(),
      });
      recordTransition({
        referral,
        fromStage: referral.current_stage,
        toStage: 'Clinical Intake RN Review',
        note: '[Pushed concurrently — current stage unchanged]',
        authorId: actorUserId,
      });
    } catch {}
  }

  if (inClinical) {
    return (
      <div style={{ padding: '8px 10px', borderRadius: 7, background: hexToRgba(palette.accentGreen.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.22)}`, marginTop: 10 }}>
        <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentGreen.hex }}>
          ✓ Pushed to Clinical Intake RN Review
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={cursoryReviewComplete ? handlePushClinical : undefined}
      disabled={!cursoryReviewComplete}
      style={{
        width: '100%',
        marginTop: 10,
        padding: '10px 12px',
        borderRadius: 8,
        border: 'none',
        background: cursoryReviewComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
        color: cursoryReviewComplete ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
        fontSize: 12.5,
        fontWeight: 700,
        cursor: cursoryReviewComplete ? 'pointer' : 'not-allowed',
        textAlign: 'left',
        transition: 'filter 0.12s',
      }}
      onMouseEnter={(e) => cursoryReviewComplete && (e.currentTarget.style.filter = 'brightness(1.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {cursoryReviewComplete ? 'Push to Intake Clinical RN Review →' : 'Check off the cursory review to push'}
    </button>
  );
}

// ── Push to Eligibility — final Intake exit ──────────────────────────────────
// Surfaces in the Actions section. Disabled until the patient has been
// pushed to Clinical RN AND Insurance Details are collected.
function PushToEligibilityAction({ referral, insuranceComplete, onOpenTriage, onInitiateTransition, isSN }) {
  const inClinical = referral?.in_clinical_review === true || referral?.in_clinical_review === 'true';
  const ready = inClinical && insuranceComplete;

  let label = 'Push to Eligibility Verification →';
  if (!inClinical && !insuranceComplete) label = 'Complete cursory review and Insurance Details';
  else if (!inClinical) label = 'Push to Clinical RN first';
  else if (!insuranceComplete) label = 'Collect Insurance Details to send to Eligibility';

  return (
    <PanelSection title="Actions">
      <ActionBtn
        label={label}
        variant={ready ? 'forward' : 'default'}
        disabled={!ready}
        onClick={ready ? () => onInitiateTransition?.(referral, 'Eligibility Verification') : undefined}
      />
      {isSN && <ActionBtn label="Open Triage Form" variant="default" onClick={onOpenTriage} />}
    </PanelSection>
  );
}

// ── 3. Eligibility ────────────────────────────────────────────────────────────

function FlagRow({ label, value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{label}</span>
      {readOnly ? (
        <span style={{ fontSize: 11.5, fontWeight: 650, color: value === true || value === 'true' ? palette.primaryMagenta.hex : value === false || value === 'false' ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>
          {value === true || value === 'true' ? 'Yes' : value === false || value === 'false' ? 'No' : '—'}
        </span>
      ) : (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ fontSize: 11.5, padding: '2px 6px', borderRadius: 5, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontFamily: 'inherit', cursor: 'pointer' }}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )}
    </div>
  );
}

function FormField({ label, children, style }) {
  return (
    <div style={{ marginBottom: 8, ...style }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4, letterSpacing: '0.02em' }}>{label}</p>
      {children}
    </div>
  );
}

function PanelSelect({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', background: palette.backgroundLight.hex, cursor: 'pointer', outline: 'none' }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// EligibilityPanel — renders the shared EligibilityWorkspace inside the
// narrow right-side <Panel>. The drawer tab (EligibilityTab.jsx) renders
// the same EligibilityWorkspace with variant="drawer". Both subscribe to
// useRefreshVersion, so a save in either surface re-fetches the other.
// See src/components/modules/shared/ for the single implementation.
function EligibilityPanel({ referrals, selectedReferral, onInitiateTransition }) {
  if (!selectedReferral) {
    return (
      <Panel>
        <PanelSection title="Queue Summary">
          <InfoRow label="Total in queue" value={referrals.length} />
        </PanelSection>
        <EmptyPanelState message="Select a patient to verify insurance coverage." />
      </Panel>
    );
  }
  // Pass the full patient record so the workspace can parse Demographics'
  // `insurance_plans` JSON without an extra fetch when it's already loaded.
  const patient = selectedReferral.patient
    ? { id: selectedReferral.patient.id || selectedReferral.patient_id, ...selectedReferral.patient }
    : { id: selectedReferral.patient_id };
  return (
    <Panel>
      <EligibilityWorkspace
        patient={patient}
        referral={selectedReferral}
        variant="panel"
        onInitiateTransition={onInitiateTransition}
      />
    </Panel>
  );
}

// ── 4. Disenrollment Required (supportive sub-module of Eligibility) ─────────
//
// Spec overhaul (2026-05-20): the patient stays in Eligibility throughout.
// This panel surfaces the OPEN DisenrollmentAssistanceFlags rows for the
// selected patient (read directly from the in-memory store) and lets the
// disenrollment specialist mark them resolved or send the case back to
// Eligibility (visual close — patient was never moved).
function DisenrollmentPanel({ selectedReferral, onInitiateTransition }) {
  const { appUserId } = useCurrentAppUser();
  const flagsById = useCareStore((s) => s.disenrollmentAssistanceFlags) || {};

  const flagsForPatient = useMemo(() => {
    if (!selectedReferral?._id && !selectedReferral?.id) return [];
    const ourRec = selectedReferral?._id;
    const ourCustom = selectedReferral?.patient_id;
    return Object.values(flagsById).filter((f) => {
      if (!f) return false;
      // patient_id is multipleRecordLinks → array of rec ids; we also accept
      // a single text id for resilience.
      const pid = f.patient_id;
      const matchPatient = Array.isArray(pid)
        ? pid.includes(selectedReferral.patient?._id) || pid.includes(ourCustom)
        : pid === ourCustom || pid === selectedReferral.patient?._id;
      if (matchPatient) return true;
      const rid = f.referral_id;
      if (Array.isArray(rid)) return rid.includes(ourRec);
      return rid === selectedReferral?.id || rid === ourRec;
    });
  }, [flagsById, selectedReferral]);

  const openFlags = flagsForPatient.filter((f) => f.status === 'open' || f.status === 'in_review');
  const resolvedFlags = flagsForPatient.filter((f) => f.status === 'completed' || f.status === 'cancelled');

  async function markResolved(flag) {
    if (!flag?._id) return;
    const note = window.prompt('Resolution note (required):', '');
    if (!note?.trim()) return;
    try {
      await updateDisenrollmentFlag(flag._id, {
        status: 'completed',
        resolution_note: note.trim(),
        resolved_by_user_id: appUserId || undefined,
        updated_at: new Date().toISOString(),
      });
      triggerDataRefresh();
    } catch (err) {
      console.error('Disen resolve failed', err);
    }
  }

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState message="Select a patient to work disenrollment assistance." /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.highlightYellow.hex, 0.22), color: '#7A5F00', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Disenrollment (supportive)
            </span>
            {selectedReferral.current_stage && selectedReferral.current_stage !== 'Disenrollment Required' && (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                also in {selectedReferral.current_stage}
              </span>
            )}
          </div>

          <PanelSection title={`Open Flags (${openFlags.length})`}>
            {openFlags.length === 0 ? (
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
                No open disenrollment flags for this patient.
              </p>
            ) : openFlags.map((f) => (
              <div key={f._id} style={{ padding: '9px 11px', borderRadius: 7, background: hexToRgba(palette.highlightYellow.hex, 0.12), border: `1px solid ${hexToRgba(palette.highlightYellow.hex, 0.32)}`, marginBottom: 8 }}>
                <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 4 }}>Expert Medicaid Assist</p>
                {f.note && <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.5, marginBottom: 6 }}>{f.note}</p>}
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                  Follow-up {f.follow_up_date ? new Date(f.follow_up_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                </p>
                <button
                  onClick={() => markResolved(f)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: palette.accentGreen.hex, color: '#fff', fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}
                >
                  Mark Resolved
                </button>
              </div>
            ))}
          </PanelSection>

          <PanelSection title="Actions">
            <ActionBtn
              label="Send to Eligibility"
              variant="forward"
              onClick={() => {
                // Concurrent model: the patient stays in Eligibility, so the
                // only stage-flip happens if they were ever moved to the
                // standalone 'Disenrollment Required' stage. Otherwise this
                // is just an audit acknowledgment.
                if (selectedReferral.current_stage === 'Disenrollment Required') {
                  onInitiateTransition?.(selectedReferral, 'Eligibility Verification');
                }
              }}
            />
            {/* Conflict escalation lives in the module toolbar at the top of
                the page — no duplicate button here. */}
          </PanelSection>

          {resolvedFlags.length > 0 && (
            <PanelSection title={`Resolved (${resolvedFlags.length})`}>
              {resolvedFlags.slice(0, 5).map((f) => (
                <div key={f._id} style={{ padding: '6px 9px', borderRadius: 6, background: hexToRgba(palette.backgroundDark.hex, 0.03), marginBottom: 5 }}>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
                    {f.resolution_note || 'Resolved'}
                  </p>
                </div>
              ))}
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 5. F2F/MD Orders Pending ──────────────────────────────────────────────────
function F2FPanel({ referrals, selectedReferral, onOpenFiles, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate]     = useState('');
  const [saving, setSaving]                 = useState(false);
  const [saveError, setSaveError]           = useState(null);

  // F2F / MD Orders files for the selected referral, fetched fresh whenever
  // the patient changes so staff can preview/download immediately from the
  // panel without bouncing into the Files tab.
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filePreview, setFilePreview] = useState(null);

  // Cursory review is persisted to the CursoryReview Airtable table via
  // this shared hook so the drawer and this panel stay in lockstep.
  const {
    checked: reviewChecked,
    toggle: toggleReview,
    saving: reviewSaving,
    saveError: reviewSaveError,
  } = useCursoryReview(selectedReferral?._id);

  useEffect(() => {
    setShowDatePicker(false);
    setReceivedDate('');
    setSaveError(null);
  }, [selectedReferral?._id]);

  useEffect(() => {
    const pid = selectedReferral?.patient_id;
    if (!pid) { setFiles([]); return; }
    let cancelled = false;
    setFilesLoading(true);
    getFilesByPatient(pid)
      .then((recs) => {
        if (cancelled) return;
        const mapped = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setFiles(mapped.filter((f) => f.category === 'F2F' || f.category === 'MD Orders'));
      })
      .catch(() => { if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedReferral?.patient_id]);

  const reviewComplete = isF2FChecklistComplete(reviewChecked);
  const completedReq = F2F_REQUIRED_ITEMS.filter((i) => reviewChecked[i.key]).length;
  const totalReq = F2F_REQUIRED_ITEMS.length;

  function daysLeft(exp) {
    if (!exp) return null;
    return Math.ceil((new Date(exp) - Date.now()) / 86400000);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  async function handleLogReceived() {
    if (!receivedDate || !selectedReferral) return;
    setSaving(true);
    setSaveError(null);
    try {
      const expiration = addDays(receivedDate, 90);
      await updateReferral(selectedReferral._id, {
        f2f_date:       receivedDate,
        f2f_expiration: expiration,
      });
      triggerDataRefresh();
      setShowDatePicker(false);
      setReceivedDate('');
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  const ref  = selectedReferral;
  const days = ref ? daysLeft(ref.f2f_expiration) : null;
  const urgencyColor = days === null
    ? null
    : days < 0  ? palette.primaryMagenta.hex
    : days <= 7  ? palette.primaryMagenta.hex
    : days <= 14 ? palette.accentOrange.hex
    : days <= 30 ? palette.highlightYellow.hex
    : palette.accentGreen.hex;

  return (
    <Panel>
      <PanelSection title="Queue Overview">
        <InfoRow label="Expired F2F"   value={referrals.filter((r) => r.f2f_urgency === 'Expired').length} highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <7d"  value={referrals.filter((r) => r.f2f_urgency === 'Red').length}     highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <14d" value={referrals.filter((r) => r.f2f_urgency === 'Orange').length}  highlight={palette.accentOrange.hex} />
        <InfoRow label="No F2F yet"    value={referrals.filter((r) => !r.f2f_date).length} />
      </PanelSection>

      {/* Returned from Clinical flag — expandable */}
      {ref && (ref.returned_from_clinical === 'true' || ref.returned_from_clinical === true) && (
        <ReturnedFromClinicalFlag note={ref.returned_from_clinical_note} />
      )}

      {ref && (
        <>
          <PanelSection title="F2F Status">
            {days !== null ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: urgencyColor, lineHeight: 1 }}>
                  {days < 0 ? 'EXPIRED' : `${days}d`}
                </p>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>
                  {days < 0 ? 'F2F has expired' : 'until F2F expiration'}
                </p>
                {ref.f2f_date && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 3 }}>
                    Received {new Date(ref.f2f_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' · '}
                    Expires {new Date(ref.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>
                No F2F date recorded
              </p>
            )}
            <InfoRow label="PECOS Verified" value={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? 'Yes' : 'No'} highlight={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
            <InfoRow label="OPRA Verified"  value={ref.is_opra_verified  === 'TRUE' || ref.is_opra_verified  === true ? 'Yes' : 'No'} />
          </PanelSection>

          <PanelSection title="Actions">

            {/* ── Log F2F / MD Orders Received ── */}
            {!canPerm(PERMISSION_KEYS.CLINICAL_F2F) ? null : !showDatePicker ? (
              <button
                onClick={() => {
                  // Pre-fill with existing date if available so the user just confirms
                  if (ref.f2f_date) {
                    setReceivedDate(new Date(ref.f2f_date).toISOString().split('T')[0]);
                  }
                  setShowDatePicker(true);
                }}
                style={{
                  width: '100%', padding: '8px 0', marginBottom: 8,
                  borderRadius: 7, border: 'none',
                  background: ref.f2f_date
                    ? hexToRgba(palette.accentGreen.hex, 0.1)
                    : palette.accentGreen.hex,
                  color: ref.f2f_date
                    ? palette.accentGreen.hex
                    : palette.backgroundLight.hex,
                  fontSize: 12, fontWeight: 650, cursor: 'pointer',
                  transition: 'filter 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(0.93)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                {ref.f2f_date ? '↺ Update F2F / MD Orders Date' : '✓ F2F / MD Orders Received'}
              </button>
            ) : (
              <div style={{
                borderRadius: 8,
                border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
                background: hexToRgba(palette.accentGreen.hex, 0.04),
                padding: '10px 11px', marginBottom: 8,
              }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                  {ref.f2f_date ? 'Confirm or update F2F received date' : 'Date documents were received'}
                </p>
                <input
                  type="date"
                  value={receivedDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '6px 9px', borderRadius: 7, marginBottom: 7,
                    border: `1px solid ${receivedDate ? palette.accentGreen.hex : 'var(--color-border)'}`,
                    fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
                    background: palette.backgroundLight.hex,
                    color: palette.backgroundDark.hex,
                  }}
                />
                {receivedDate && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 8 }}>
                    Clock starts {new Date(receivedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' — '}
                    expires <strong style={{ color: palette.accentOrange.hex }}>
                      {new Date(addDays(receivedDate, 90)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </strong>
                  </p>
                )}
                {saveError && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{saveError}</p>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleLogReceived}
                    disabled={!receivedDate || saving}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: receivedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: receivedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                      fontSize: 11.5, fontWeight: 650, cursor: receivedDate && !saving ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {saving ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setShowDatePicker(false); setReceivedDate(''); setSaveError(null); }}
                    disabled={saving}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: hexToRgba(palette.backgroundDark.hex, 0.55),
                      fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <ActionBtn label="Upload F2F Document" variant="default" onClick={() => onOpenFiles?.(selectedReferral)} />
          </PanelSection>

          {/* Documents — inline list with Preview + Download, so staff can SEE
              the file without bouncing to the Files tab. */}
          <PanelSection title="Documents">
            {filesLoading ? (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '4px 0' }}>Loading…</p>
            ) : files.length === 0 ? (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', padding: '4px 0' }}>
                No F2F or MD Order documents uploaded yet.
              </p>
            ) : (
              files.map((f) => {
                const cleanUrl = f.r2_url?.replace(/[<>\n]/g, '').trim();
                return (
                  <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={f.category === 'F2F' ? palette.primaryMagenta.hex : palette.accentOrange.hex} strokeWidth="1.6" />
                      <path d="M14 2v6h6" stroke={f.category === 'F2F' ? palette.primaryMagenta.hex : palette.accentOrange.hex} strokeWidth="1.6" />
                    </svg>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p title={f.file_name} style={{ fontSize: 11.5, fontWeight: 550, color: palette.backgroundDark.hex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</p>
                      <p style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{f.category}{f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                    </div>
                    {cleanUrl && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => setFilePreview(f)}
                          title="Preview"
                          style={{
                            padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 650,
                            background: hexToRgba(palette.primaryDeepPlum.hex, 0.08),
                            border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.18)}`,
                            color: palette.primaryDeepPlum.hex,
                          }}
                        >
                          Preview
                        </button>
                        <a
                          href={cleanUrl}
                          download={f.file_name}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Download"
                          style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 650,
                            background: hexToRgba(palette.accentBlue.hex, 0.1),
                            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                            color: palette.accentBlue.hex, textDecoration: 'none',
                          }}
                        >
                          Download
                        </a>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <button
              onClick={() => onOpenFiles?.(selectedReferral)}
              style={{
                marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 6,
                background: 'none', border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
                fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer',
              }}
            >
              Open Files tab →
            </button>
          </PanelSection>

          {/* Document review checklist — persisted via CursoryReview table */}
          <PanelSection title="Document Review">
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>
                  Cursory Review{reviewSaving ? ' · saving…' : ''}
                </span>
                <span style={{ fontSize: 11, fontWeight: 650, color: reviewComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>{completedReq}/{totalReq}</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${totalReq > 0 ? Math.round((completedReq / totalReq) * 100) : 0}%`, background: reviewComplete ? palette.accentGreen.hex : palette.accentOrange.hex, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
              {reviewSaveError && (
                <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{reviewSaveError}</p>
              )}
              {F2F_REVIEW_CHECKLIST.map((item) => (
                <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!reviewChecked[item.key]} onChange={() => toggleReview(item.key)} style={{ accentColor: palette.accentGreen.hex, width: 13, height: 13, flexShrink: 0, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: reviewChecked[item.key] ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex, textDecoration: reviewChecked[item.key] ? 'line-through' : 'none', fontWeight: item.required ? 550 : 400 }}>
                    {item.label}{item.required && !reviewChecked[item.key] ? ' *' : ''}
                  </span>
                </label>
              ))}
            </div>

            <button
              data-testid="f2f-confirm-btn"
              onClick={() => reviewComplete && onInitiateTransition?.(selectedReferral, 'Clinical Intake RN Review')}
              disabled={!reviewComplete}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                background: reviewComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: reviewComplete ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                fontSize: 13, fontWeight: 700, cursor: reviewComplete ? 'pointer' : 'not-allowed',
                textAlign: 'left', letterSpacing: '-0.01em', transition: 'filter 0.12s', marginTop: 8,
              }}
              onMouseEnter={(e) => reviewComplete && (e.currentTarget.style.filter = 'brightness(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              {reviewComplete ? 'Confirm → Clinical Intake RN Review' : 'Complete review to send to Clinical RN'}
            </button>
          </PanelSection>
        </>
      )}
      {filePreview && <FilePreviewModal file={filePreview} onClose={() => setFilePreview(null)} />}
    </Panel>
  );
}

function ApproveButton({ enabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const DESTINATIONS = [
    { label: 'Authorization Pending', sub: 'Managed care / auth required', stage: 'Authorization Pending' },
    { label: 'Staffing Feasibility',  sub: 'No auth needed — go straight to staffing', stage: 'Staffing Feasibility' },
  ];
  return (
    <div style={{ position: 'relative', marginBottom: 6 }}>
      <button
        onClick={() => enabled && setOpen((o) => !o)}
        disabled={!enabled}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
          background: enabled ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
          color: enabled ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
          fontSize: 13.5, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed',
          textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          transition: 'filter 0.12s', letterSpacing: '-0.01em',
        }}
        onMouseEnter={(e) => enabled && (e.currentTarget.style.filter = 'brightness(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
      >
        {enabled ? 'Approve — send to…' : 'Review F2F / MD orders first'}
        {enabled && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 9, overflow: 'hidden', boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
          {DESTINATIONS.map((d) => (
            <button
              key={d.stage}
              onClick={() => { setOpen(false); onSelect(d.stage); }}
              style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.07))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{d.label}</p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{d.sub}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 6. Clinical Intake RN Review ──────────────────────────────────────────────
// Spec changes (2026-05-20):
//   • Decline is GONE — RNs use Conflict instead.
//   • Auth-required toggle is GONE — auth is now an Eligibility-side concern.
//   • Confirm flips the patient to Staffing using the LIFO rule:
//       - if eligibility_completed_at is already set, current_stage becomes
//         'Staffing Feasibility'.
//       - otherwise we just clear in_clinical_review and record the timestamp;
//         the Eligibility "Completed" action will flip the stage later.
function ClinicalRNPanel({ selectedReferral, onOpenTriage, onOpenFiles, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const [checked, setChecked] = useState({});
  const [decision, setDecision] = useState(null);
  const [sendBackNote, setSendBackNote] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);

  useEffect(() => {
    setChecked({});
    setDecision(null);
    setSendBackNote('');
    setShowSendBack(false);
  }, [selectedReferral?._id]);

  function toggleItem(key) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const checklistComplete = isChecklistComplete(checked);
  const canConfirm = checklistComplete && (decision === 'accept' || decision === 'conditional');

  const eligibilityDone = !!selectedReferral?.eligibility_completed_at;

  async function handleConfirm() {
    if (!canConfirm || !selectedReferral) return;
    const now = new Date().toISOString();
    const baseFields = {
      clinical_review_decision: decision,
      clinical_review_by: appUserId || 'unknown',
      clinical_review_at: now,
      clinical_review_completed_at: now,
      clinical_review_completed_by_id: appUserId || 'unknown',
      in_clinical_review: false,
    };
    if (eligibilityDone) {
      // LIFO trigger — Eligibility already completed, so the patient officially
      // enters Staffing Feasibility now.
      onInitiateTransition?.(selectedReferral, 'Staffing Feasibility');
      // Apply the extra audit fields alongside the stage flip. The optimistic
      // update path in ModulePage owns current_stage; we just add the extras.
      updateReferral(selectedReferral._id, baseFields).catch(() => {});
    } else {
      // Eligibility still in flight — leave current_stage alone, just clear
      // the concurrent presence and stamp completion.
      try {
        await updateReferralOptimistic(selectedReferral._id, baseFields);
      } catch {}
      // Audit row for the clinical exit (not a stage change).
      recordTransition({
        referral: selectedReferral,
        fromStage: 'Clinical Intake RN Review',
        toStage: selectedReferral.current_stage,
        note: '[Clinical RN confirmed — awaiting Eligibility completion]',
        authorId: appUserId,
      });
    }
  }

  function handleSendBack() {
    if (!sendBackNote.trim() || !selectedReferral) return;
    updateReferral(selectedReferral._id, {
      current_stage: 'F2F/MD Orders Pending',
      in_clinical_review: false,
      returned_from_clinical: 'true',
      returned_from_clinical_note: sendBackNote.trim(),
      returned_from_clinical_at: new Date().toISOString(),
      returned_from_clinical_by: appUserId || 'unknown',
    }).catch(() => {});
    recordTransition({
      referral: selectedReferral,
      fromStage: 'Clinical Intake RN Review',
      toStage: 'F2F/MD Orders Pending',
      note: `[Returned from Clinical] ${sendBackNote.trim()}`,
      authorId: appUserId,
    });
    triggerDataRefresh();
    setShowSendBack(false);
    setSendBackNote('');
  }

  return (
    <Panel width={320}>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          {/* Concurrent presence indicator — reminds clinical staff that the
              patient may still be in Intake / Eligibility. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Clinical RN
            </span>
            {selectedReferral.current_stage && selectedReferral.current_stage !== 'Clinical Intake RN Review' && (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                also in {selectedReferral.current_stage}
              </span>
            )}
            {eligibilityDone && (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentGreen.hex, 0.12), color: palette.accentGreen.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                eligibility ✓
              </span>
            )}
          </div>

          <ClinicalChecklistUI
            checked={checked}
            onToggle={toggleItem}
            decision={decision}
            onDecisionChange={setDecision}
            authRequired={false}
            onAuthRequiredChange={() => {}}
            compact
          />

          {/* Send back to F2F — always available, not gated by clinical permission */}
          <PanelSection title="Send Back">
            {!showSendBack ? (
              <ActionBtn label="↩ Send Back to F2F / MD Orders" variant="warning" onClick={() => setShowSendBack(true)} />
            ) : (
              <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`, background: hexToRgba(palette.accentOrange.hex, 0.04), padding: '10px 11px', marginBottom: 6 }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>Explain why this patient is being returned to F2F:</p>
                <textarea
                  data-testid="send-back-note"
                  value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)}
                  placeholder="Required — describe the documentation issue…"
                  rows={3}
                  style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${sendBackNote.trim() ? palette.accentOrange.hex : 'var(--color-border)'}`, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleSendBack} disabled={!sendBackNote.trim()} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: sendBackNote.trim() ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.07), color: sendBackNote.trim() ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), fontSize: 11.5, fontWeight: 650, cursor: sendBackNote.trim() ? 'pointer' : 'not-allowed' }}>
                    Send Back
                  </button>
                  <button onClick={() => { setShowSendBack(false); setSendBackNote(''); }} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </PanelSection>

          {/* Confirm + clinical decision actions — gated by permission.
              Decline is gone; issues route through the toolbar Conflict
              button at the top of the module page. */}
          {canPerm(PERMISSION_KEYS.CLINICAL_RN_REVIEW) && (
          <PanelSection title="Clinical Validation">
            <button
              data-testid="confirm-patient-btn"
              onClick={handleConfirm}
              disabled={!canConfirm}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                background: canConfirm ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: canConfirm ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'not-allowed',
                textAlign: 'left', letterSpacing: '-0.01em', transition: 'filter 0.12s', marginBottom: 6,
              }}
              onMouseEnter={(e) => canConfirm && (e.currentTarget.style.filter = 'brightness(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              {canConfirm ? 'Confirm → Staffing Feasibility' : 'Complete checklist + Accept to confirm'}
            </button>
          </PanelSection>
          )}

          <PanelSection title="Documents">
            <ActionBtn label="Open Triage Form" variant="default" onClick={() => onOpenTriage?.(selectedReferral)} />
            <ActionBtn label="View F2F / MD Orders" variant="default" onClick={() => onOpenFiles?.(selectedReferral)} />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 7. Authorization Pending ──────────────────────────────────────────────────
// Services list is policy-driven. ABA is never available in this workflow.
// HHA is blocked when the referral division is ALF (see policy layer).
// See src/data/policies/serviceAvailabilityPolicies.js for the source of truth.
//
// AuthorizationPanel — thin wrapper around the shared AuthorizationWorkspace.
// The drawer tab (AuthorizationsTab.jsx) wraps the same workspace with
// variant="drawer". Writes in either surface call triggerDataRefresh() so
// both re-fetch in lockstep.
function AuthorizationPanel({ selectedReferral, onInitiateTransition }) {
  if (!selectedReferral) {
    return (
      <Panel>
        <EmptyPanelState message="Select a patient to record authorization." />
      </Panel>
    );
  }
  const patient = selectedReferral.patient
    ? { id: selectedReferral.patient.id || selectedReferral.patient_id, ...selectedReferral.patient }
    : { id: selectedReferral.patient_id };
  return (
    <Panel>
      <AuthorizationWorkspace
        patient={patient}
        referral={selectedReferral}
        variant="panel"
        onInitiateTransition={onInitiateTransition}
      />
    </Panel>
  );
}

// ── 8. Conflict ───────────────────────────────────────────────────────────────
const SEVERITY_PILL = {
  Low:      { bg: hexToRgba(palette.accentBlue.hex, 0.14),     text: palette.accentBlue.hex },
  Medium:   { bg: hexToRgba(palette.highlightYellow.hex, 0.22), text: '#7A5F00' },
  High:     { bg: hexToRgba(palette.accentOrange.hex, 0.18),   text: palette.accentOrange.hex },
  Critical: { bg: hexToRgba(palette.primaryMagenta.hex, 0.18), text: palette.primaryMagenta.hex },
};

// All active stages — used by "Resolve and Send to..." for free-form routing.
// We keep Conflict and the strictly-terminal stages out of this list because
// you can't resolve into the same lane and you can't pick NTUC / Completed.
const CONFLICT_ANY_STAGE_DESTINATIONS = [
  'Lead Entry', 'Intake', 'F2F/MD Orders Pending', 'Clinical Intake RN Review',
  'Eligibility Verification', 'Authorization Pending', 'Disenrollment Required',
  'Staffing Feasibility', 'Pre-SOC', 'OPWDD Enrollment', 'Hold',
];

function ConflictPanel({ selectedReferral, onOpenEligibility, onOpenFiles, onInitiateTransition }) {
  const [conflicts, setConflicts] = useState([]);
  const [loadingConflicts, setLoadingConflicts] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  // Both resolve actions require a free-text note that becomes a Note on the
  // patient. We capture it once and reuse the same buffer for whichever flow
  // the user picks (return-to-source / pick-any-stage / request-NTUC).
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => {
    if (!selectedReferral?.id) { setConflicts([]); return; }
    setLoadingConflicts(true);
    getConflictsByReferral(selectedReferral.id)
      .then((recs) => setConflicts(recs.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoadingConflicts(false));
  }, [selectedReferral?.id]);

  useEffect(() => { setResolutionNote(''); setResolveOpen(false); }, [selectedReferral?._id]);

  // Treat both new "Open" and legacy "Unaddressed"/"In Progress" as actionable.
  const openConflicts = conflicts.filter((c) => c.status === 'Open' || c.status === 'Unaddressed' || c.status === 'In Progress');
  const resolvedConflicts = conflicts.filter((c) => c.status === 'Resolved' || c.status === 'Waived');

  // Pull source_stage off the most recent open conflict (fall back to oldest).
  const sourceStage = openConflicts.length > 0
    ? (openConflicts[0].source_stage || openConflicts[openConflicts.length - 1].source_stage)
    : null;

  function pickDestinations() {
    const list = CONFLICT_ANY_STAGE_DESTINATIONS.filter((s) => s !== 'Conflict');
    if (sourceStage && !list.includes(sourceStage)) list.unshift(sourceStage);
    return list;
  }

  function doResolveTo(stage) {
    if (!resolutionNote.trim()) return;
    setResolveOpen(false);
    // The note rides along as the 3rd arg of initiateTransition. ModulePage
    // skips the modal for Conflict resolutions (note already captured) and
    // writes the note into Notes via recordTransition.
    onInitiateTransition?.(selectedReferral, stage, resolutionNote.trim());
  }

  const canResolve = resolutionNote.trim().length > 0;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          {/* Conflict details */}
          {loadingConflicts ? (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '8px 0' }}>Loading…</p>
          ) : (
            <PanelSection title={`Active Conflicts (${openConflicts.length})`}>
              {openConflicts.length === 0 ? (
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontStyle: 'italic' }}>No open conflicts recorded.</p>
              ) : openConflicts.map((c) => {
                const sc = SEVERITY_PILL[c.severity] || SEVERITY_PILL.Medium;
                return (
                  <div key={c._id} style={{ padding: '10px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`, marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{c.type || 'Unknown'}</span>
                      <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.text }}>{c.severity}</span>
                    </div>
                    {c.description && (
                      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6), lineHeight: 1.5 }}>{c.description}</p>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: palette.primaryMagenta.hex }}>{c.status || 'Open'}</span>
                      {c.source_stage && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                          from {c.source_stage}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {resolvedConflicts.length > 0 && (
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), marginTop: 6 }}>
                  + {resolvedConflicts.length} resolved
                </p>
              )}
            </PanelSection>
          )}

          {/* Resolution requires a note — captured once, reused by every
              resolve action below. The note becomes a patient Note via
              recordTransition. */}
          <PanelSection title="Resolution Note">
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              rows={3}
              placeholder="Describe what was resolved and any next steps. Required for every resolution action below."
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                borderRadius: 7, border: `1px solid ${canResolve ? hexToRgba(palette.accentGreen.hex, 0.35) : 'var(--color-border)'}`,
                fontSize: 12, fontFamily: 'inherit', resize: 'vertical',
                background: hexToRgba(palette.backgroundDark.hex, 0.025),
                color: palette.backgroundDark.hex, outline: 'none',
              }}
            />
          </PanelSection>

          <PanelSection title="Actions">
            {/* 1. Resolve and return to source (uses source_stage). */}
            {sourceStage && (
              <ActionBtn
                label={canResolve ? `↩ Resolve and Return to ${sourceStage}` : 'Add a note to resolve'}
                variant={canResolve ? 'forward' : 'default'}
                disabled={!canResolve}
                onClick={canResolve ? () => doResolveTo(sourceStage) : undefined}
              />
            )}

            {/* 2. Resolve and send to a specific module (dropdown). */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <button
                onClick={() => canResolve && setResolveOpen((o) => !o)}
                disabled={!canResolve}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                  background: canResolve ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                  color: canResolve ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                  fontSize: 13, fontWeight: 700, cursor: canResolve ? 'pointer' : 'not-allowed',
                  textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'filter 0.12s',
                }}
              >
                {canResolve ? 'Resolve and send to…' : 'Add a note to enable routing'}
                {canResolve && (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: resolveOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
                    <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              {resolveOpen && canResolve && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 9, overflow: 'hidden', maxHeight: 280, overflowY: 'auto', boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
                  {pickDestinations().map((stageName) => (
                    <button
                      key={stageName}
                      onMouseDown={(e) => { e.preventDefault(); doResolveTo(stageName); }}
                      style={{ width: '100%', padding: '9px 13px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.06))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{stageName}</p>
                      {sourceStage === stageName && (
                        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Original source</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Request NTUC — routed through Admin Confirmation unless the
                user holds REFERRAL_NTUC_DIRECT. Handled by resolveNtucDestination
                inside ModulePage's executeTransition. */}
            <ActionBtn
              label={canResolve ? 'Request NTUC' : 'Add a note to request NTUC'}
              variant={canResolve ? 'danger' : 'default'}
              disabled={!canResolve}
              onClick={canResolve ? () => doResolveTo('NTUC') : undefined}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 9. Staffing Feasibility ───────────────────────────────────────────────────
const STAFFING_TABS = ['Zip Search'];

function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', marginBottom: open ? 8 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{title}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M2 4.5l4 4 4-4" stroke={hexToRgba(palette.backgroundDark.hex, 0.4)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && children}
    </div>
  );
}

function StaffingPanel({ referrals, selectedReferral, allReferrals, onOpenTab, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [clinicianMatched, setClinicianMatched] = useState(false);

  useEffect(() => { setClinicianMatched(false); }, [selectedReferral?._id]);

  const triageAdultStore = useCareStore((s) => s.triageAdult);
  const triagePedStore = useCareStore((s) => s.triagePediatric);
  const insuranceCheckStore = useCareStore((s) => s.insuranceChecks);
  const sRefId = selectedReferral?.id;
  const sRefAirtableId = selectedReferral?._id;
  const staffingTriageData = [...Object.values(triageAdultStore || {}), ...Object.values(triagePedStore || {})].find((t) => {
    const tid = t.referral_id;
    if (!tid || !sRefId) return false;
    if (tid === sRefId || tid === sRefAirtableId) return true;
    if (Array.isArray(tid) && (tid.includes(sRefId) || tid.includes(sRefAirtableId))) return true;
    return false;
  }) || null;
  const staffingInsuranceChecks = Object.values(insuranceCheckStore || {}).filter((c) => {
    const pid = c.patient_id;
    const target = selectedReferral?.patient_id;
    if (!pid || !target) return false;
    if (pid === target) return true;
    if (Array.isArray(pid) && pid.includes(target)) return true;
    return false;
  });

  const isOnTrack = selectedReferral?.current_stage === 'Staffing Feasibility';
  const isConflict = selectedReferral?.current_stage === 'Conflict';
  const canConfirm = isOnTrack && clinicianMatched && canPerm(PERMISSION_KEYS.SCHEDULING_STAFFING);

  // Stage breakdown for the radar dashboard
  const stageCounts = {};
  (referrals || []).forEach((r) => { stageCounts[r.current_stage] = (stageCounts[r.current_stage] || 0) + 1; });
  const onTrackCount = stageCounts['Staffing Feasibility'] || 0;
  const conflictCount = stageCounts['Conflict'] || 0;

  return (
    <Panel width={380}>
      {/* Radar summary */}
      <PanelSection title="Radar Overview">
        <InfoRow label="Total in radar" value={(referrals || []).length} />
        <InfoRow label="On Track (Staffing only)" value={onTrackCount} highlight={palette.accentGreen.hex} />
        {conflictCount > 0 && <InfoRow label="In Conflict" value={conflictCount} highlight={palette.accentOrange.hex} />}
        {Object.entries(stageCounts).filter(([s]) => s !== 'Staffing Feasibility' && s !== 'Conflict').sort(([,a],[,b]) => b - a).slice(0, 5).map(([stage, count]) => (
          <InfoRow key={stage} label={stage} value={count} />
        ))}
      </PanelSection>

      {/* Selected patient detail */}
      {selectedReferral && (
        <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid var(--color-border)` }}>
          <PatientSnapshot
            patient={selectedReferral?.patient}
            referral={selectedReferral}
            triageData={staffingTriageData}
            insuranceChecks={staffingInsuranceChecks}
            onOpenTab={(tab) => onOpenTab?.(selectedReferral, tab)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                {selectedReferral.patientName || selectedReferral.patient_id}
              </p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Stage pill */}
                <span data-testid="stage-pill" style={{ fontSize: 10.5, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: isOnTrack ? hexToRgba(palette.accentGreen.hex, 0.14) : isConflict ? hexToRgba(palette.accentOrange.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.08), color: isOnTrack ? palette.accentGreen.hex : isConflict ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                  {selectedReferral.current_stage}
                </span>
                {/* Conflict flag */}
                {isConflict && (
                  <span data-testid="conflict-flag" style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: hexToRgba(palette.accentOrange.hex, 0.15), color: palette.accentOrange.hex }}>CONFLICT</span>
                )}
                {/* On Track badge */}
                {isOnTrack && (
                  <img data-testid="on-track-badge" src="/feasibility-badge.png" alt="On Track" title="On Track — only feasibility remains" style={{ width: 20, height: 20, flexShrink: 0 }} />
                )}
              </div>
            </div>
            {selectedReferral.patient?.address_zip && (
              <span style={{ fontSize: 11, fontWeight: 700, color: palette.accentBlue.hex, background: hexToRgba(palette.accentBlue.hex, 0.1), padding: '2px 8px', borderRadius: 5, flexShrink: 0, marginLeft: 8 }}>
                ZIP {selectedReferral.patient.address_zip}
              </span>
            )}
          </div>

          {/* Key data: services + zip */}
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {Array.isArray(selectedReferral.services_requested) && selectedReferral.services_requested.map((s) => (
              <span key={s} style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 5, background: hexToRgba(palette.primaryMagenta.hex, 0.1), color: palette.primaryMagenta.hex }}>{s}</span>
            ))}
          </div>

          {/* On Track immediate attention banner */}
          {isOnTrack && (
            <div data-testid="on-track-banner" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 7, background: hexToRgba(palette.accentGreen.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.2)}` }}>
              <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentGreen.hex }}>
                On Track — all other steps complete. Match a clinician to confirm.
              </p>
            </div>
          )}

          {/* Clinician matched checkbox + confirm (only for On Track patients) */}
          {isOnTrack && canPerm(PERMISSION_KEYS.SCHEDULING_STAFFING) && (
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: clinicianMatched ? hexToRgba(palette.accentGreen.hex, 0.07) : hexToRgba(palette.backgroundDark.hex, 0.04), cursor: 'pointer', marginBottom: 8 }}>
                <input type="checkbox" checked={clinicianMatched} onChange={(e) => setClinicianMatched(e.target.checked)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>Clinician found and matched</span>
              </label>
              <button
                data-testid="staffing-confirm-btn"
                onClick={() => canConfirm && onInitiateTransition?.(selectedReferral, 'Admin Confirmation')}
                disabled={!canConfirm}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                  background: canConfirm ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                  color: canConfirm ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                  fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'not-allowed',
                  textAlign: 'left', letterSpacing: '-0.01em', transition: 'filter 0.12s',
                }}
                onMouseEnter={(e) => canConfirm && (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                {canConfirm ? 'Confirm → Admin Confirmation' : 'Match a clinician to confirm'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Zip search tool */}
      <PanelSection title="Zip Search Tool">
        <ZipSearchPanel />
      </PanelSection>
    </Panel>
  );
}

// ── 10. Admin Confirmation (NTUC request review) ─────────────────────────────
function AdminConfirmationPanel({ selectedReferral, resolveUser, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const hasNtucRequest = !!selectedReferral?.ntuc_request_origin_stage;
  const originStage = selectedReferral?.ntuc_request_origin_stage;
  const requestedByName = selectedReferral?.ntuc_requested_by
    ? (resolveUser?.(selectedReferral.ntuc_requested_by) || selectedReferral.ntuc_requested_by)
    : null;
  const requestedAt = selectedReferral?.ntuc_requested_at
    ? new Date(selectedReferral.ntuc_requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  function handleConfirmNtuc() {
    onInitiateTransition?.(selectedReferral, 'NTUC');
  }

  function handleDenyNtuc() {
    onInitiateTransition?.(selectedReferral, 'Conflict');
  }

  function handleSendBack() {
    if (originStage) {
      onInitiateTransition?.(selectedReferral, originStage);
    }
  }

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Case Summary">
            <InfoRow label="Patient" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Services" value={Array.isArray(selectedReferral.services_requested) ? selectedReferral.services_requested.join(', ') : '—'} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="Days in pipeline" value={Math.floor((Date.now() - new Date(selectedReferral.referral_date).getTime()) / 86400000) + 'd'} />
          </PanelSection>

          {/* NTUC Request details (when this patient was routed here for NTUC review) */}
          {hasNtucRequest && (
            <PanelSection title="NTUC Request">
              <div style={{ padding: '10px 12px', borderRadius: 8, background: hexToRgba(palette.accentOrange.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.2)}`, marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 650, color: palette.accentOrange.hex, marginBottom: 4 }}>
                  NTUC request pending review
                </p>
                {requestedByName && <InfoRow label="Requested by" value={requestedByName} />}
                {requestedAt && <InfoRow label="Requested at" value={requestedAt} />}
                <InfoRow label="Came from" value={originStage} />
                {selectedReferral.ntuc_reason && <InfoRow label="Reason" value={selectedReferral.ntuc_reason} />}
              </div>
            </PanelSection>
          )}

          {canPerm(PERMISSION_KEYS.SCHEDULING_ADMIN_CONFIRM) && (
          <PanelSection title="Decision">
            {!hasNtucRequest && (
              <ActionBtn label="Accept → Pre-SOC" variant="forward" onClick={() => onInitiateTransition?.(selectedReferral, 'Pre-SOC')} />
            )}

            {hasNtucRequest && (
              <>
                <ActionBtn label="Confirm NTUC" variant="danger" onClick={handleConfirmNtuc} />
                <ActionBtn label="Deny → Conflict" variant="warning" onClick={handleDenyNtuc} />
                {originStage && (
                  <ActionBtn label={`Send Back → ${originStage}`} variant="default" onClick={handleSendBack} />
                )}
              </>
            )}

            {!hasNtucRequest && canPerm(PERMISSION_KEYS.REFERRAL_NTUC) && (
              <ActionBtn label="Decline → NTUC" variant="danger" onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')} />
            )}
          </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 11. Pre-SOC ───────────────────────────────────────────────────────────────
function PreSocPanel({ selectedReferral, resolveSource, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const actualStage = selectedReferral?.current_stage;
  const today = new Date().toISOString().split('T')[0];

  const [socDate, setSocDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState(null);

  useEffect(() => {
    setSocDate(''); setError(null); setPdfError(null); setConfirming(false); setOnboardError(null);
  }, [selectedReferral?._id]);

  async function handleSchedule() {
    if (!socDate || !selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE)) return;
    setSaving(true);
    setError(null);
    try {
      const enteredAt = new Date().toISOString();
      await updateReferral(selectedReferral._id, { current_stage: 'SOC Scheduled', soc_scheduled_date: socDate });
      await createEpisode({ patient_id: selectedReferral.patient_id, referral_id: selectedReferral._id, soc_date: socDate, episode_start: socDate });
      recordTransition({ referral: selectedReferral, fromStage: 'Pre-SOC', toStage: 'SOC Scheduled', authorId: null });
      triggerDataRefresh();
    } catch (err) { setError(err.message || 'Failed to schedule SOC'); setSaving(false); }
  }

  async function handleDownloadPdf() {
    if (!selectedReferral) return;
    setPdfLoading(true); setPdfError(null);
    try { await generateEmrPacket(selectedReferral, resolveSource); }
    catch (err) { setPdfError(err.message || 'Failed to generate PDF'); }
    finally { setPdfLoading(false); }
  }

  async function handleOnboarded() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE)) return;
    setOnboarding(true); setOnboardError(null);
    try {
      const enteredAt = new Date().toISOString();
      await updateReferral(selectedReferral._id, { current_stage: 'SOC Completed', soc_completed_date: new Date().toISOString().split('T')[0] });
      recordTransition({ referral: selectedReferral, fromStage: 'SOC Scheduled', toStage: 'SOC Completed', authorId: null });
      triggerDataRefresh();
    } catch (err) { setOnboardError(err.message || 'Failed'); setOnboarding(false); setConfirming(false); }
  }

  // Step indicator
  const steps = [
    { key: 'emr', label: 'EMR Onboarding', done: actualStage === 'SOC Scheduled' || actualStage === 'SOC Completed' },
    { key: 'schedule', label: 'SOC Scheduled', done: actualStage === 'SOC Scheduled' || actualStage === 'SOC Completed' },
    { key: 'complete', label: 'SOC Completed', done: actualStage === 'SOC Completed' },
  ];

  const socDateDisplay = selectedReferral?.soc_scheduled_date
    ? new Date(selectedReferral.soc_scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Patient">
            <InfoRow label="Name" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="DB Stage" value={actualStage} />
          </PanelSection>

          {/* Step progress indicator */}
          <PanelSection title="Progress">
            <div data-testid="soc-steps" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {steps.map((step, i) => (
                <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: step.done ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {step.done ? (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>{i + 1}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: step.done ? 650 : 450, color: step.done ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </PanelSection>

          {/* Step A: EMR Onboarding (only when in Pre-SOC) */}
          {actualStage === 'Pre-SOC' && (
            <PanelSection title="Step 1 — EMR Onboarding">
              <ActionBtn label={pdfLoading ? 'Generating…' : '↓ Download EMR Onboarding Packet'} variant="default" onClick={handleDownloadPdf} disabled={pdfLoading} />
              {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}

              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>SOC Date</p>
                <input type="date" value={socDate} min={today} onChange={(e) => setSocDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, border: `1px solid ${socDate ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, marginBottom: 8 }} />
                {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{error}</p>}
                <ActionBtn label={saving ? 'Scheduling…' : 'Confirm EMR Onboarded & Schedule SOC →'} variant="forward" onClick={handleSchedule} disabled={!socDate || saving} />
              </div>
            </PanelSection>
          )}

          {/* Step B+C: SOC Scheduled → Complete (when DB stage is SOC Scheduled) */}
          {actualStage === 'SOC Scheduled' && (
            <PanelSection title="Step 2 — SOC Scheduled">
              {socDateDisplay && <InfoRow label="Scheduled for" value={socDateDisplay} highlight={palette.accentGreen.hex} />}

              <div style={{ marginTop: 10 }}>
                <ActionBtn label={pdfLoading ? 'Generating…' : '↓ Download EMR Packet'} variant="default" onClick={handleDownloadPdf} disabled={pdfLoading} />
                {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}
              </div>

              <div style={{ marginTop: 10 }}>
                {!confirming ? (
                  <ActionBtn label="Mark SOC Completed →" variant="forward" onClick={() => setConfirming(true)} />
                ) : (
                  <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`, background: hexToRgba(palette.accentGreen.hex, 0.05), padding: '10px 11px' }}>
                    <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4, lineHeight: 1.5 }}>Confirm SOC Completion</p>
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
                      Confirm that <strong>{selectedReferral.patientName}</strong> has had their Start of Care. This moves them to Completed.
                    </p>
                    {onboardError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{onboardError}</p>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleOnboarded} disabled={onboarding} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: onboarding ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex, color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650, cursor: onboarding ? 'wait' : 'pointer' }}>
                        {onboarding ? 'Saving…' : 'Confirm'}
                      </button>
                      <button onClick={() => { setConfirming(false); setOnboardError(null); }} disabled={onboarding} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <ActionBtn label="Reschedule / Hold" variant="warning" onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')} />
              </div>
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 12. SOC Scheduled ─────────────────────────────────────────────────────────
function SocScheduledPanel({ selectedReferral, resolveSource, onInitiateTransition }) {
  const { can: canPerm } = usePermissions();
  const [pdfLoading, setPdfLoading]       = useState(false);
  const [pdfError, setPdfError]           = useState(null);
  const [confirming, setConfirming]       = useState(false);
  const [onboarding, setOnboarding]       = useState(false);
  const [onboardError, setOnboardError]   = useState(null);

  // Reset state when patient changes
  useEffect(() => {
    setConfirming(false);
    setOnboardError(null);
    setPdfError(null);
  }, [selectedReferral?._id]);

  async function handleDownloadPdf() {
    if (!selectedReferral) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      await generateEmrPacket(selectedReferral, resolveSource);
    } catch (err) {
      setPdfError(err.message || 'Failed to generate PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleOnboarded() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE)) return;
    setOnboarding(true);
    setOnboardError(null);
    try {
      const enteredAt = new Date().toISOString();
      await updateReferral(selectedReferral._id, {
        current_stage: 'SOC Completed',
        soc_completed_date: new Date().toISOString().split('T')[0],
      });
      // stage_entered_at not a column in Referrals
      recordTransition({ referral: selectedReferral, fromStage: 'SOC Scheduled', toStage: 'SOC Completed', authorId: null });
      triggerDataRefresh();
    } catch (err) {
      setOnboardError(err.message || 'Failed to update patient');
      setOnboarding(false);
      setConfirming(false);
    }
  }

  const socDateDisplay = selectedReferral?.soc_scheduled_date
    ? new Date(selectedReferral.soc_scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="SOC Details">
            <InfoRow label="Scheduled date" value={socDateDisplay} />
            <InfoRow label="Patient"        value={selectedReferral.patientName} />
            <InfoRow label="Division"       value={selectedReferral.division} />
          </PanelSection>

          <PanelSection title="Actions">

            {/* ── Download EMR Onboarding Packet ── */}
            <button
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              style={{
                width: '100%', padding: '7px 12px', marginBottom: 8,
                borderRadius: 7, border: 'none',
                background: hexToRgba(palette.backgroundDark.hex, 0.07),
                color: hexToRgba(palette.backgroundDark.hex, 0.65),
                fontSize: 12, fontWeight: 600, cursor: pdfLoading ? 'wait' : 'pointer',
                transition: 'filter 0.12s',
              }}
              onMouseEnter={(e) => !pdfLoading && (e.currentTarget.style.filter = 'brightness(0.92)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              {pdfLoading ? 'Generating…' : '↓ Download EMR Onboarding Packet'}
            </button>
            {pdfError && (
              <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>
            )}

            {/* ── Patient Onboarded to EMR (with inline confirm) ── */}
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                style={{
                  width: '100%', padding: '11px 14px', marginBottom: 8,
                  borderRadius: 8, border: 'none',
                  background: palette.accentGreen.hex,
                  color: palette.backgroundLight.hex,
                  fontSize: 13.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.01em',
                  textAlign: 'left', transition: 'filter 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >
                Patient Onboarded to EMR
              </button>
            ) : (
              <div style={{
                borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
                background: hexToRgba(palette.accentGreen.hex, 0.05),
                padding: '10px 11px', marginBottom: 8,
              }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4, lineHeight: 1.5 }}>
                  Confirm SOC Completion
                </p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
                  Confirm that <strong>{selectedReferral.patientName}</strong> has had their Start of Care and is now under Wellbound care. This will move them to SOC Completed.
                </p>
                {onboardError && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{onboardError}</p>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleOnboarded}
                    disabled={onboarding}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: onboarding ? hexToRgba(palette.accentGreen.hex, 0.5) : palette.accentGreen.hex,
                      color: palette.backgroundLight.hex,
                      fontSize: 11.5, fontWeight: 650, cursor: onboarding ? 'wait' : 'pointer',
                    }}
                  >
                    {onboarding ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setOnboardError(null); }}
                    disabled={onboarding}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                      background: hexToRgba(palette.backgroundDark.hex, 0.07),
                      color: hexToRgba(palette.backgroundDark.hex, 0.55),
                      fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Reschedule / Hold ── */}
            <ActionBtn
              label="Reschedule / Hold"
              variant="warning"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 13. SOC Completed ─────────────────────────────────────────────────────────
function SocCompletedPanel({ referrals }) {
  const hchbDone = referrals.filter((r) => r.hchb_entered === true || r.hchb_entered === 'true').length;
  return (
    <Panel>
      <PanelSection title="HCHB Entry Status">
        <InfoRow label="Entered in HCHB" value={hchbDone} highlight={palette.accentGreen.hex} />
        <InfoRow label="Pending HCHB entry" value={referrals.length - hchbDone} highlight={referrals.length - hchbDone > 0 ? palette.accentOrange.hex : null} />
      </PanelSection>
      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          This is a terminal stage. No forward transitions are available. Cases should be fully entered in HCHB.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── 14. Hold ──────────────────────────────────────────────────────────────────
function HoldPanel({ referrals, selectedReferral, resolveUser, onInitiateTransition }) {
  const { appUser } = useCurrentAppUser();
  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.REFERRAL_NTUC);

  const [returnStage, setReturnStage] = useState('');
  const [releasing, setReleasing] = useState(false);

  // Sync return stage from referral data when selection changes
  useEffect(() => {
    setReturnStage(selectedReferral?.hold_return_stage || '');
  }, [selectedReferral?._id, selectedReferral?.hold_return_stage]);

  const overdue = referrals.filter((r) =>
    r.hold_expected_resolution && new Date(r.hold_expected_resolution) < new Date()
  ).length;

  const isOverdue = selectedReferral?.hold_expected_resolution &&
    new Date(selectedReferral.hold_expected_resolution) < new Date();

  async function handleRelease() {
    if (!selectedReferral || !returnStage || releasing) return;
    setReleasing(true);
    try {
      // Clear hold metadata before transitioning
      await updateReferral(selectedReferral._id, {
        hold_reason: '',
        hold_return_stage: '',
        hold_expected_resolution: null,
      });
      onInitiateTransition?.(selectedReferral, returnStage);
    } catch {
      // transition failed — leave state as-is
    } finally {
      setReleasing(false);
    }
  }

  return (
    <Panel>
      <PanelSection title="Hold Summary">
        <InfoRow label="Total on hold" value={referrals.length} />
        <InfoRow
          label="Overdue resolutions"
          value={overdue}
          highlight={overdue > 0 ? palette.primaryMagenta.hex : null}
        />
      </PanelSection>

      {selectedReferral ? (
        <PanelSection title="Hold Details">
          <InfoRow label="Hold reason" value={selectedReferral.hold_reason} />
          <InfoRow
            label="Expected resolution"
            value={
              selectedReferral.hold_expected_resolution
                ? new Date(selectedReferral.hold_expected_resolution).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'
            }
            highlight={isOverdue ? palette.primaryMagenta.hex : null}
          />
          {selectedReferral.hold_owner_id && (
            <InfoRow label="Hold owner" value={resolveUser?.(selectedReferral.hold_owner_id)} />
          )}

          {/* Return stage selector */}
          <div style={{ marginTop: 12, marginBottom: 4 }}>
            <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
              Return to stage
            </p>
            <PanelSelect
              value={returnStage}
              onChange={setReturnStage}
              options={PIPELINE_STAGES}
              placeholder="Select stage…"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <ActionBtn
              label={releasing ? 'Releasing…' : 'Release → Return to Stage'}
              variant="forward"
              onClick={handleRelease}
              disabled={!returnStage || releasing}
            />
            {isAdmin && (
              <ActionBtn
                label="Move to NTUC"
                variant="danger"
                onClick={() => onInitiateTransition?.(selectedReferral, 'NTUC')}
              />
            )}
          </div>
        </PanelSection>
      ) : (
        <PanelSection title="Hold Details">
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
            Select a patient from the list to see hold details and release options.
          </p>
        </PanelSection>
      )}
    </Panel>
  );
}

// ── 15. NTUC ──────────────────────────────────────────────────────────────────
function NtucPanel({ referrals }) {
  const [exporting, setExporting] = useState(false);

  // Group by reason
  const byReason = {};
  referrals.forEach((r) => {
    const k = r.ntuc_reason || 'Unspecified';
    byReason[k] = (byReason[k] || 0) + 1;
  });

  // Group by financial impact
  const byImpact = {};
  referrals.forEach((r) => {
    const k = r.ntuc_financial_impact || 'Untagged';
    byImpact[k] = (byImpact[k] || 0) + 1;
  });

  async function handleExport() {
    if (exporting || !referrals.length) return;
    setExporting(true);
    try {
      const columns = [
        { key: 'patientName',           label: 'Patient' },
        { key: 'division',              label: 'Division' },
        { key: 'ntuc_reason',           label: 'NTUC Reason' },
        { key: 'ntuc_financial_impact', label: 'Financial Impact' },
        { key: 'referral_date',         label: 'Referral Date' },
        { key: 'services_requested',    label: 'Services' },
        { key: 'current_stage',         label: 'Stage' },
      ];
      const rows = referrals.map((r) => ({
        patientName:           r.patientName || r.patient_id || '',
        division:              r.division || '',
        ntuc_reason:           r.ntuc_reason || '',
        ntuc_financial_impact: r.ntuc_financial_impact || '',
        referral_date:         r.referral_date
          ? new Date(r.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '',
        services_requested:    Array.isArray(r.services_requested)
          ? r.services_requested.join(', ')
          : (r.services_requested || ''),
        current_stage:         r.current_stage || '',
      }));
      exportToExcel(rows, columns, 'NTUC Report', `${referrals.length} records · exported ${new Date().toLocaleDateString()}`);
    } catch (e) {
      console.error('NTUC export failed:', e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Panel>
      <PanelSection title="Breakdown by Reason">
        {Object.entries(byReason).length === 0 ? (
          <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No data</p>
        ) : (
          Object.entries(byReason).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
            <InfoRow key={reason} label={reason} value={count} />
          ))
        )}
      </PanelSection>

      {Object.keys(byImpact).some((k) => k !== 'Untagged') && (
        <PanelSection title="Financial Impact">
          {Object.entries(byImpact).sort(([, a], [, b]) => b - a).map(([tag, count]) => (
            <InfoRow key={tag} label={tag} value={count} />
          ))}
        </PanelSection>
      )}

      <PanelSection title="Actions">
        <ActionBtn
          label={exporting ? 'Exporting…' : 'Export NTUC Report'}
          variant="default"
          onClick={handleExport}
          disabled={exporting || referrals.length === 0}
        />
      </PanelSection>

      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          Terminal state. No forward transitions available. NTUC records are preserved for reporting and attribution.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── OPWDD Enrollment ──────────────────────────────────────────────────────────
// The OPWDD workflow has far more state than a normal stage (PCG outreach,
// evaluations, a 15-item checklist, submission, notice, monitoring), so this
// panel is ~60% wider than the default 280px and renders the workspace at
// "drawer" density for comfortable typography.
function OPWDDEnrollmentPanel({ referrals, selectedReferral, onInitiateTransition, onOpenFiles }) {
  if (!selectedReferral) {
    return (
      <Panel width={440}>
        <PanelSection title="Enrollment Summary">
          <InfoRow label="Total in OPWDD" value={referrals.length} />
        </PanelSection>
        <EmptyPanelState message="Select a patient to view their OPWDD case." />
      </Panel>
    );
  }
  const patient = selectedReferral.patient
    ? { id: selectedReferral.patient.id || selectedReferral.patient_id, ...selectedReferral.patient }
    : { id: selectedReferral.patient_id };
  return (
    <Panel width={440}>
      <OpwddWorkspace
        patient={patient}
        referral={selectedReferral}
        variant="drawer"
        onInitiateTransition={onInitiateTransition}
        onOpenFiles={onOpenFiles}
      />
    </Panel>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function StagePanel({ stage, referrals, allReferrals, selectedReferral, resolveUser, resolveSource, onNewReferral, onOpenTriage, onOpenFiles, onOpenEligibility, onOpenTab, onInitiateTransition, onSelectedReferralLeftModule }) {
  const props = { referrals, allReferrals, selectedReferral, resolveUser, resolveSource, onNewReferral, onOpenTriage, onOpenFiles, onOpenEligibility, onOpenTab, onInitiateTransition, onSelectedReferralLeftModule };
  switch (stage) {
    case 'Lead Entry':                return <LeadEntryPanel {...props} />;
    case 'Discarded Leads':           return <DiscardedLeadsPanel {...props} />;
    case 'Intake':                    return <IntakePanel {...props} />;
    case 'Eligibility Verification':  return <EligibilityPanel {...props} />;
    case 'Disenrollment Required':    return <DisenrollmentPanel {...props} />;
    case 'F2F/MD Orders Pending':     return <F2FPanel {...props} />;
    case 'Clinical Intake RN Review': return <ClinicalRNPanel {...props} />;
    case 'Authorization Pending':     return <AuthorizationPanel {...props} />;
    case 'Conflict':                  return <ConflictPanel {...props} />;
    case 'Staffing Feasibility':      return <StaffingPanel {...props} />;
    case 'Admin Confirmation':        return <AdminConfirmationPanel {...props} />;
    case 'Pre-SOC':                   return <PreSocPanel {...props} />;
    case 'SOC Scheduled':             return <SocScheduledPanel {...props} />;
    case 'SOC Completed':             return <SocCompletedPanel {...props} />;
    case 'Hold':                      return <HoldPanel {...props} />;
    case 'NTUC':                      return <NtucPanel {...props} />;
    case 'OPWDD Enrollment':          return <OPWDDEnrollmentPanel {...props} />;
    default: return null;
  }
}
