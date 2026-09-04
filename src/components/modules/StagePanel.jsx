import { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import ZipSearchPanel from '../staffing/ZipSearchPanel.jsx';
import { getConflictsByReferral } from '../../api/conflicts.js';
import { getFilesByPatient } from '../../api/patientFiles.js';
import { updateReferral } from '../../api/referrals.js';
import { updateDisenrollmentFlag } from '../../api/disenrollmentFlags.js';
import { createNoteOptimistic, updateReferralOptimistic } from '../../store/mutations.js';
import { createSocRescheduleLog } from '../../api/socRescheduleLog.js';
import { updateEpisode } from '../../api/episodes.js';
import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { runEffects } from '../../engine/effects.js';
import { recordActivity } from '../../api/activityLog.js';
import { isUrgentCare } from '../../utils/urgentCare.js';
import {
  isDocumentationDeferred,
  documentationDueFieldsForSocDate,
  maybeClearDocumentationDeferred,
} from '../../utils/documentationDeferred.js';
import { hasInsuranceDetails } from '../../utils/insuranceDetails.js';
import { discardReferral } from '../../utils/discardReferral.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import EmrPacketDownloadButton from '../common/EmrPacketDownloadButton.jsx';
import DocumentationCompleteAction from '../common/DocumentationCompleteAction.jsx';
import RequestClinicalReviewAction from '../common/RequestClinicalReviewAction.jsx';
import DiscardReferralModal from '../common/DiscardReferralModal.jsx';
import EpisodeTypeBadge from '../common/EpisodeTypeBadge.jsx';
import ClinicalLeadPreCheckPanel from './ClinicalLeadPreCheckPanel.jsx';
import { isClinicalLeadPreCheck, restoreLeadStage, needsPreCheckIntakeWarning } from '../../utils/clinicalLeadPreCheck.js';
import { isSocCompletedReferral } from '../../data/stageConfig.js';
import { displayStageName } from '../common/StageBadge.jsx';
import {
  scheduleVerb,
  rescheduleVerb,
  markCompletedVerb,
  confirmCompletionVerb,
  episodeDateLabel,
  episodeTypeLongLabel,
  episodeTypeLabel,
  isRoc,
} from '../../utils/episodeType.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS, canPerformClinicalRnReview } from '../../data/permissionKeys.js';
import { useLookups } from '../../hooks/useLookups.js';
import EligibilityWorkspace from './shared/EligibilityWorkspace.jsx';
import AuthorizationWorkspace from './shared/AuthorizationWorkspace.jsx';
import OpwddWorkspace from './shared/OpwddWorkspace.jsx';
import { exportToExcel } from '../../utils/reportEngine.js';
import { useCareStore } from '../../store/careStore.js';
import { languageName, languageByCode } from '../../data/languages.js';
import ClinicalChecklistUI from '../clinical/ClinicalChecklistUI.jsx';
import { completeClinicalReview, resolveClinicalConfirmDecision } from '../../utils/completeClinicalReview.js';
import { completeVisit } from '../../utils/completeVisit.js';
import { F2F_REVIEW_CHECKLIST, F2F_REQUIRED_ITEMS, isF2FChecklistComplete } from '../../data/f2fChecklist.js';
import { useCursoryReview } from '../../hooks/useCursoryReview.js';
import { useClinicalReview } from '../../hooks/useClinicalReview.js';
import { unlockClinicalReview } from '../../utils/clinicalReviewUnlock.js';
import HospitalizationReview from './shared/HospitalizationReview.jsx';
import FilePreviewModal from '../common/FilePreviewModal.jsx';
import { openSignedFile } from '../../utils/r2Upload.js';
import { normalizeSeverity, conflictCategoryLabel } from '../../utils/conflictFlagging.js';
import StageRules from '../../data/StageRules.json';
import palette, { hexToRgba } from '../../utils/colors.js';
import PatientSnapshot from './PatientSnapshot.jsx';
import SocCompletedCelebration from '../common/SocCompletedCelebration.jsx';
import OooBadge from '../common/OooBadge.jsx';
import { isUserOoo, oooWindowLabel } from '../../utils/outOfOffice.js';
import { findSiblingLeadReferrals } from '../../utils/knownGuardians.js';
import {
  fmtCalendarDate,
  fmtCalendarDateShort,
  toCalendarDateInput,
  addCalendarDays,
  daysUntilCalendarDate,
  daysSinceCalendarDate,
  todayCalendarDate,
} from '../../utils/dateFormat.js';

const PIPELINE_STAGES = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'EMR Onboarding', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC', 'SOC Scheduled',
];

/** Categories stored on `soc_reschedule_log.reason_category` for reporting. */
const SOC_RESCHEDULE_REASONS = [
  { value: 'parent_availability', label: 'Parent / caregiver availability' },
  { value: 'staffing_changes', label: 'Staffing changes' },
  { value: 'clinician_unavailable', label: 'Clinician unavailable / call-out' },
  { value: 'patient_medical', label: 'Patient medical / hospitalization' },
  { value: 'transportation_weather', label: 'Transportation / weather' },
  { value: 'insurance_auth', label: 'Insurance / authorization delay' },
  { value: 'family_request', label: 'Family request' },
  { value: 'other', label: 'Other' },
];

// Shared panel wrapper ────────────────────────────────────────────────────────
/** Optional footer injected into every stage Panel (e.g. discard-from-any). */
const PanelFooterContext = createContext(null);

function Panel({ children, width = 280 }) {
  const footer = useContext(PanelFooterContext);
  return (
    <div style={{
      width, minWidth: width, borderLeft: `1px solid #E6E4EB`,
      background: '#F3F2F6',
      overflowY: 'auto', flexShrink: 0, padding: '16px 14px',
    }}>
      {children}
      {footer}
    </div>
  );
}

function DiscardAnyPanelSection({ referral, onDone }) {
  const { appUserId } = useCurrentAppUser();
  const [open, setOpen] = useState(false);
  if (!referral) return null;
  return (
    <>
      <PanelSection title="Discard">
        <ActionBtn label="Discard referral" variant="warning" onClick={() => setOpen(true)} />
      </PanelSection>
      {open && (
        <DiscardReferralModal
          referral={referral}
          title="Discard Referral"
          confirmLabel="Discard"
          onCancel={() => setOpen(false)}
          onConfirm={async (reason, explanation) => {
            const result = await discardReferral({
              referral, reason, explanation, actorUserId: appUserId,
            });
            if (!result.ok) {
              window.alert?.(result.reason || 'Discard failed');
              return;
            }
            triggerDataRefresh();
            setOpen(false);
            onDone?.();
          }}
        />
      )}
    </>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 4, paddingBottom: 18, borderBottom: '1px solid #E6E4EB' }}>
      {title && (
        <p style={{ fontSize: 11, fontWeight: 750, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#4A4458', margin: '0 0 10px' }}>{title}</p>
      )}
      {children}
    </div>
  );
}

function SelectedPatientHeader({ referral, stageLabel }) {
  const p = referral?.patient;
  const name = (p
    ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
    : '') || referral?.patientName || 'Unnamed patient';
  return (
    <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #E6E4EB' }}>
      <p style={{
        fontSize: 16, fontWeight: 750, color: palette.backgroundDark.hex,
        margin: 0, lineHeight: 1.25, wordBreak: 'break-word',
      }}>
        {name}
      </p>
      {stageLabel && (
        <span style={{
          display: 'inline-block',
          marginTop: 8,
          padding: '3px 8px',
          borderRadius: 6,
          background: '#E8E6ED',
          fontSize: 11.5,
          fontWeight: 700,
          color: '#4A4458',
        }}>
          {stageLabel}
        </span>
      )}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
      <span style={{ fontSize: 12, color: '#5A5466' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: highlight || palette.backgroundDark.hex, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}

function ActionBtn({ label, variant = 'default', onClick, disabled = false }) {
  // forward = large primary CTA (one per panel), success = small green confirm,
  // warning = yellow caution, danger = orange negative, default = grey utility
  const styles = {
    forward:  { bg: palette.accentGreen.hex,  color: palette.backgroundLight.hex, pad: '11px 14px', size: 13.5, weight: 700 },
    success:  { bg: palette.accentGreen.hex,  color: palette.backgroundLight.hex, pad: '8px 12px',  size: 12.5, weight: 650 },
    warning:  { bg: palette.highlightYellow.hex, color: palette.backgroundDark.hex, pad: '8px 12px', size: 12.5, weight: 650 },
    danger:   { bg: palette.accentOrange.hex, color: palette.backgroundLight.hex, pad: '8px 12px',  size: 12.5, weight: 650 },
    default:  { bg: '#E8E6ED', color: '#3A3545', pad: '8px 12px', size: 12.5, weight: 650 },
    primary:  { bg: '#E8E6ED', color: '#3A3545', pad: '8px 12px', size: 12.5, weight: 650 },
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
        textAlign: 'left',
        opacity: disabled ? 0.45 : 1,
        letterSpacing: variant === 'forward' ? '-0.01em' : 'normal',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'background 0.12s, transform 0.12s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = 'brightness(0.97)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
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
          background: '#E8E6ED',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#DDDAE3')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#E8E6ED')}
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

function ReturnFlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M9 7L4 12l5 5" stroke="#9A4E12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12h9a6 6 0 0 1 6 6" stroke="#9A4E12" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ReturnedFromClinicalFlag({ note, at }) {
  const [expanded, setExpanded] = useState(true);
  const ts = at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div data-testid="returned-from-clinical-flag" style={{ borderRadius: 10, background: '#F8EDE4', marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', padding: '10px 12px', background: 'none', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8,
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <ReturnFlagIcon />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 750, color: '#9A4E12', lineHeight: 1.3 }}>
            Returned from Clinical
          </span>
          {ts && (
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#6B4A2A', marginTop: 3 }}>
              {ts}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginTop: 3 }}>
          <path d="M2 4.5l4 4 4-4" stroke="#9A4E12" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div style={{ padding: '0 12px 12px 36px' }}>
          <p style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>
            {note || 'No note'}
          </p>
        </div>
      )}
    </div>
  );
}

/** Fields stamped when Clinical RN (or EMR after Confirm) sends a case back to Intake. */
function clinicalSendBackFields({ note, actorUserId }) {
  const now = new Date().toISOString();
  return {
    in_clinical_review: false,
    returned_from_clinical: true,
    returned_from_clinical_note: note || '',
    returned_from_clinical_at: now,
    returned_from_clinical_by: actorUserId || 'unknown',
    // Clear confirmation stamps so Accept/Confirm does not stick after a return
    // for more paperwork — RN can re-decide once Intake re-pushes.
    clinical_review_decision: null,
    clinical_review_completed_at: null,
    clinical_review_completed_by_id: null,
    clinical_review_at: null,
    clinical_review_by: null,
  };
}

// Mirror of ReturnedFromClinicalFlag — surfaces when eligibility staff
// send a patient back to Intake with a required note. Sits at the top of
// the IntakePanel so the front-line intake user sees it immediately.
function ReturnedFromEligibilityFlag({ note, at }) {
  const [expanded, setExpanded] = useState(true);
  const ts = at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div data-testid="returned-from-eligibility-flag" style={{ borderRadius: 10, background: '#F8EDE4', marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', padding: '10px 12px', background: 'none', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8,
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <ReturnFlagIcon />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 750, color: '#9A4E12', lineHeight: 1.3 }}>
            Returned from Eligibility
          </span>
          {ts && (
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#6B4A2A', marginTop: 3 }}>
              {ts}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginTop: 3 }}>
          <path d="M2 4.5l4 4 4-4" stroke="#9A4E12" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && note && (
        <div style={{ padding: '0 12px 12px 36px' }}>
          <p style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{note}</p>
        </div>
      )}
    </div>
  );
}

function EmptyPanelState({ message }) {
  return <p style={{ fontSize: 13, fontWeight: 600, color: '#5A5466', textAlign: 'center', paddingTop: 28, margin: 0 }}>{message || 'Select a patient to see details.'}</p>;
}

// ── 1. Lead Entry (Leads) ─────────────────────────────────────────────────────

function PromoteToIntakeModal({ referral, onConfirm, onCancel }) {
  const { canAssignTo } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const storeUsers = useCareStore((s) => s.users);
  const storePatients = useCareStore((s) => s.patients);
  const storeUserLanguages = useCareStore((s) => s.userLanguages);
  const storeLanguages = useCareStore((s) => s.languages);

  const patient = useMemo(() => {
    const pid = referral?.patient_id;
    if (!pid) return null;
    return Object.values(storePatients || {}).find((p) => p.id === pid) || null;
  }, [referral?.patient_id, storePatients]);

  const preferredCode = patient?.preferred_language || '';
  const preferredLang = preferredCode ? (languageByCode(preferredCode) || { code: preferredCode, name: languageName(preferredCode) || preferredCode }) : null;
  // Soft language match is most useful when a preferred language is set.
  // English is the default — still show the hint, but keep filter optional either way.
  const hasPreferredLanguage = !!preferredLang?.name;

  const speakersOfPreferred = useMemo(() => {
    if (!preferredLang?.code) return new Set();
    const matchedLangIds = new Set(
      Object.values(storeLanguages || {})
        .filter((l) => l.code === preferredLang.code)
        .map((l) => l.id),
    );
    if (preferredLang.id) matchedLangIds.add(preferredLang.id);
    // Fallback when languages table isn't hydrated yet
    if (matchedLangIds.size === 0) matchedLangIds.add(`lang_${preferredLang.code}`);

    const set = new Set();
    Object.values(storeUserLanguages || {}).forEach((ul) => {
      if (matchedLangIds.has(ul.language_id)) set.add(ul.user_id);
    });
    return set;
  }, [preferredLang, storeUserLanguages, storeLanguages]);

  const meUser = useMemo(
    () => (appUserId ? Object.values(storeUsers).find((u) => u.id === appUserId) : null),
    [storeUsers, appUserId],
  );
  const meName = meUser
    ? `${meUser.first_name || ''} ${meUser.last_name || ''}`.trim() || 'Me'
    : 'Me';

  const allUsers = useMemo(() => {
    const list = Object.values(storeUsers)
      .filter((u) => u.status === 'Active' || !u.status)
      // Always allow assigning to yourself on promote — managers are often intake staff too,
      // and may not be on their own "can assign to" list.
      .filter((u) => (appUserId && u.id === appUserId) || canAssignTo(u.id))
      .sort((a, b) => {
        if (appUserId) {
          if (a.id === appUserId) return -1;
          if (b.id === appUserId) return 1;
        }
        // Speakers of the preferred language float to the top (informational)
        const aSpeak = speakersOfPreferred.has(a.id) ? 0 : 1;
        const bSpeak = speakersOfPreferred.has(b.id) ? 0 : 1;
        if (aSpeak !== bSpeak) return aSpeak - bSpeak;
        return `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`);
      });
    // If the signed-in user isn't in the Users store yet, still expose a stub for Myself.
    if (appUserId && !list.some((u) => u.id === appUserId)) {
      list.unshift(meUser || { id: appUserId, first_name: 'Me', last_name: '', status: 'Active' });
    }
    return list;
  }, [storeUsers, canAssignTo, speakersOfPreferred, appUserId, meUser]);

  const [ownerId, setOwnerId] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [onlySpeakers, setOnlySpeakers] = useState(false);
  const ownerSearchRef = useRef(null);
  const siblingLeads = useMemo(() => findSiblingLeadReferrals(referral), [referral]);
  const [moveSiblings, setMoveSiblings] = useState(true);
  const [selectedSiblingIds, setSelectedSiblingIds] = useState(() => new Set());
  const [ackPreCheck, setAckPreCheck] = useState(false);
  useEffect(() => {
    setSelectedSiblingIds(new Set(siblingLeads.map((r) => r._id)));
    setMoveSiblings(siblingLeads.length > 0);
    setAckPreCheck(false);
  }, [siblingLeads]);
  const canSubmit = !!ownerId;
  const selectedOwner = useMemo(
    () => allUsers.find((u) => u.id === ownerId) || (ownerId === appUserId ? meUser : null),
    [allUsers, ownerId, appUserId, meUser],
  );
  const ownerIsOoo = isUserOoo(selectedOwner);

  const visibleUsers = useMemo(() => {
    if (!onlySpeakers || !hasPreferredLanguage) return allUsers;
    // Keep "me" visible even when the language filter would hide them.
    return allUsers.filter((u) => speakersOfPreferred.has(u.id) || (appUserId && u.id === appUserId));
  }, [allUsers, onlySpeakers, hasPreferredLanguage, speakersOfPreferred, appUserId]);

  const filteredUsers = useMemo(() => {
    const q = ownerSearch.trim().toLowerCase();
    if (!q) return visibleUsers;
    return visibleUsers.filter((u) => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim().toLowerCase();
      const email = String(u.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [visibleUsers, ownerSearch]);

  useEffect(() => {
    const t = setTimeout(() => ownerSearchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const langLabel = preferredLang?.name || '';
  const myselfSelected = !!(appUserId && ownerId === appUserId);
  const extrasIfMoved = moveSiblings
    ? siblingLeads.filter((r) => selectedSiblingIds.has(r._id))
    : [];
  const batchNeedsPreCheckWarning = needsPreCheckIntakeWarning(referral)
    || extrasIfMoved.some(needsPreCheckIntakeWarning);

  return (
    <div onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'min(560px, 90vh)' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Move to Intake</p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
            Assign an intake owner for {referral.patientName || referral.patient_id}.
          </p>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
          {hasPreferredLanguage && (
            <div style={{
              padding: '10px 12px', borderRadius: 9,
              background: hexToRgba(palette.accentBlue.hex, 0.08),
              border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.18)}`,
            }}>
              <p style={{ fontSize: 12.5, color: palette.backgroundDark.hex, lineHeight: 1.45, margin: 0 }}>
                The primary language of this referral is{' '}
                <strong style={{ fontWeight: 700 }}>{langLabel}</strong>.
              </p>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.65),
              }}>
                <input
                  type="checkbox"
                  checked={onlySpeakers}
                  onChange={(e) => setOnlySpeakers(e.target.checked)}
                  style={{ accentColor: palette.accentBlue.hex, width: 14, height: 14, cursor: 'pointer' }}
                />
                Only show users who speak {langLabel}
              </label>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 6 }}>
              Assign Owner *
            </p>

            <input
              ref={ownerSearchRef}
              data-testid="owner-search"
              type="search"
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
              placeholder="Search staff by name or email…"
              autoComplete="off"
              style={{
                width: '100%', marginBottom: 8, padding: '9px 12px',
                borderRadius: 8, border: `1px solid var(--color-border)`,
                fontSize: 13, fontFamily: 'inherit',
                color: palette.backgroundDark.hex,
                background: palette.backgroundLight.hex,
                outline: 'none', boxSizing: 'border-box',
              }}
            />

            {appUserId && (
              <button
                type="button"
                data-testid="assign-myself"
                onClick={() => setOwnerId(appUserId)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  width: '100%', marginBottom: 8, padding: '11px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${myselfSelected ? palette.accentGreen.hex : palette.primaryMagenta.hex}`,
                  background: myselfSelected
                    ? hexToRgba(palette.accentGreen.hex, 0.1)
                    : hexToRgba(palette.primaryMagenta.hex, 0.06),
                  fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <span>
                  <span style={{
                    display: 'block', fontSize: 13.5, fontWeight: 700,
                    color: myselfSelected ? palette.accentGreen.hex : palette.primaryMagenta.hex,
                  }}>
                    Myself
                  </span>
                  <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
                    Assign to {meName}
                  </span>
                </span>
                {myselfSelected && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: palette.accentGreen.hex,
                    padding: '3px 8px', borderRadius: 6,
                    background: hexToRgba(palette.accentGreen.hex, 0.15),
                  }}>
                    Selected
                  </span>
                )}
              </button>
            )}

            <div
              data-testid="owner-select"
              style={{
                flex: 1, overflowY: 'auto', borderRadius: 8,
                border: `1px solid ${ownerId && !myselfSelected ? palette.accentGreen.hex : 'var(--color-border)'}`,
                minHeight: 140, maxHeight: 220,
              }}
            >
              {filteredUsers.length === 0 ? (
                <p style={{ padding: 16, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
                  {ownerSearch.trim()
                    ? `No staff matching "${ownerSearch.trim()}".`
                    : onlySpeakers
                      ? `No assignable users marked as speaking ${langLabel}. Uncheck the filter to see everyone.`
                      : 'No assignable users found.'}
                </p>
              ) : filteredUsers.map((u) => {
                const speaks = hasPreferredLanguage && speakersOfPreferred.has(u.id);
                const selected = ownerId === u.id;
                const isMe = !!(appUserId && u.id === appUserId);
                return (
                  <button
                    key={u.id || u._id}
                    type="button"
                    onClick={() => setOwnerId(u.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      width: '100%', padding: '10px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: selected ? hexToRgba(palette.accentGreen.hex, 0.1) : 'transparent',
                      borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{
                      fontSize: 13, fontWeight: selected ? 650 : 500,
                      color: palette.backgroundDark.hex,
                    }}>
                      {u.first_name} {u.last_name}
                      {isMe ? ' (you)' : ''}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <OooBadge user={u} />
                      {speaks && (
                        <span style={{
                          flexShrink: 0, fontSize: 10.5, fontWeight: 650,
                          padding: '2px 8px', borderRadius: 20,
                          background: hexToRgba(palette.accentBlue.hex, 0.12),
                          color: palette.accentBlue.hex,
                          whiteSpace: 'nowrap',
                        }}>
                          Speaks {langLabel}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {ownerIsOoo && (
              <p
                data-testid="ooo-intake-warn"
                style={{
                  margin: '8px 0 0',
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.4,
                  fontWeight: 550,
                  color: palette.accentOrange.hex,
                  background: hexToRgba(palette.accentOrange.hex, 0.1),
                  border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.22)}`,
                }}
              >
                {selectedOwner.first_name} {selectedOwner.last_name} is out of office
                {oooWindowLabel(selectedOwner) ? ` (${oooWindowLabel(selectedOwner)})` : ''}.
                You can still assign them as intake owner.
              </p>
            )}
            {hasPreferredLanguage && !onlySpeakers && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 6, marginBottom: 0 }}>
                Assign owner.
              </p>
            )}
          </div>
        </div>

        {siblingLeads.length > 0 && (
          <div style={{
            margin: '0 22px 14px', padding: '12px 14px', borderRadius: 10,
            background: hexToRgba(palette.accentBlue.hex, 0.08),
            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.22)}`,
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={moveSiblings}
                onChange={(e) => setMoveSiblings(e.target.checked)}
                style={{ accentColor: palette.accentBlue.hex, marginTop: 2 }}
              />
              <span>
                <span style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex, display: 'block' }}>
                  Move these patients together?
                </span>
                <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4 }}>
                  Same known guardian on {siblingLeads.length} other lead{siblingLeads.length === 1 ? '' : 's'}. Assigning one intake owner keeps phone calls with one person.
                </span>
              </span>
            </label>
            {moveSiblings && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {siblingLeads.map((r) => {
                  const checked = selectedSiblingIds.has(r._id);
                  return (
                    <label key={r._id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedSiblingIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r._id);
                            else next.delete(r._id);
                            return next;
                          });
                        }}
                        style={{ accentColor: palette.accentBlue.hex }}
                      />
                      <span style={{ fontWeight: 650, color: palette.backgroundDark.hex }}>
                        {r.patientName || r.patient_id}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '14px 22px', borderTop: `1px solid var(--color-border)`, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          {batchNeedsPreCheckWarning && ackPreCheck && (
            <p data-testid="precheck-intake-warning" style={{ fontSize: 12.5, color: palette.backgroundDark.hex, lineHeight: 1.45, margin: 0 }}>
              Clinical has not signed off on {extrasIfMoved.some(needsPreCheckIntakeWarning) ? 'one or more of these leads' : 'this lead'} yet. Move to Intake anyway?
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '7px 18px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 13, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => {
              if (!canSubmit) return;
              if (batchNeedsPreCheckWarning && !ackPreCheck) {
                setAckPreCheck(true);
                return;
              }
              onConfirm(ownerId, extrasIfMoved);
            }}
            disabled={!canSubmit}
            style={{ padding: '7px 20px', borderRadius: 7, background: canSubmit ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07), border: 'none', fontSize: 13, fontWeight: 650, color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {batchNeedsPreCheckWarning && ackPreCheck ? 'Move anyway' : 'Move to Intake'}
          </button>
          </div>
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

  const today = referrals.filter((r) => daysSinceCalendarDate(r.referral_date) === 0).length;
  const thisWeek = referrals.filter((r) => {
    const days = daysSinceCalendarDate(r.referral_date);
    return days != null && days >= 0 && days < 7;
  }).length;
  const preCheckCount = referrals.filter(isClinicalLeadPreCheck).length;
  const readyCount = referrals.filter((r) => r.current_stage === 'Lead Entry').length;

  async function handleDiscard(reason, explanation) {
    if (!selectedReferral) return;
    const result = await discardReferral({
      referral: selectedReferral,
      reason,
      explanation,
      actorUserId: appUserId,
    });
    if (!result.ok) {
      window.alert?.(result.reason || 'Discard failed');
      return;
    }
    triggerDataRefresh();
    onSelectedReferralLeftModule?.();
    setShowDiscard(false);
  }

  const canDiscardLead = canPerm(PERMISSION_KEYS.LEADS_DISCARD) || canPerm(PERMISSION_KEYS.REFERRAL_DISCARD_ANY);

  async function handlePromote(ownerId, siblingReferrals = []) {
    if (!selectedReferral) return;
    // Resolve the staff member's display name so the timeline note never
    // surfaces a raw `usr_###` id to a clinical/business reader.
    const ownerUser = Object.values(useCareStore.getState().users || {}).find((u) => u.id === ownerId);
    const ownerName = ownerUser ? `${ownerUser.first_name || ''} ${ownerUser.last_name || ''}`.trim() : ownerId;
    const now = new Date().toISOString();
    const batch = [selectedReferral, ...(siblingReferrals || [])];
    for (const ref of batch) {
      const result = attemptTransition({
        referral: ref,
        toStage: 'Intake',
        context: {
          note: batch.length > 1
            ? `Owner assigned: ${ownerName} (moved with sibling leads sharing a known guardian)`
            : `Owner assigned: ${ownerName}`,
          actorUserId: appUserId,
          extraFields: {
            intake_owner_id: ownerId,
            intake_owner_changed_at: now,
            intake_owner_changed_by_id: appUserId,
            updated_at: now,
          },
        },
      });
      if (result.allowed) {
        await applyTransition({ referral: ref, result, context: { actorUserId: appUserId } })
          .catch((err) => { console.error('[LeadEntry] Move failed:', err); window.alert?.('Failed to move to Intake: ' + err.message); });
      }
    }
    triggerDataRefresh();
    onSelectedReferralLeftModule?.();
    setShowPromote(false);
  }

  return (
    <Panel>
      <PanelSection title="Lead Stats">
        <InfoRow label="Awaiting clinical" value={preCheckCount} highlight={preCheckCount > 0 ? palette.primaryDeepPlum.hex : null} />
        <InfoRow label="Ready leads" value={readyCount} />
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
          {canDiscardLead && (
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

      {showDiscard && selectedReferral && (
        <DiscardReferralModal
          referral={selectedReferral}
          title="Discard Lead"
          confirmLabel="Discard Lead"
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscard(false)}
        />
      )}
      {showPromote && selectedReferral && <PromoteToIntakeModal referral={selectedReferral} onConfirm={handlePromote} onCancel={() => setShowPromote(false)} />}
    </Panel>
  );
}

// ── 1b. Discarded Leads ───────────────────────────────────────────────────────
function DiscardedLeadsPanel({ referrals, selectedReferral, onInitiateTransition }) {
  const { appUserId } = useCurrentAppUser();
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
            <ActionBtn
              label="Restore to Leads"
              variant="forward"
              onClick={async () => {
                if (!selectedReferral) return;
                const toStage = restoreLeadStage(selectedReferral);
                const result = attemptTransition({
                  referral: selectedReferral,
                  toStage,
                  context: {
                    system: true,
                    actorUserId: appUserId,
                    note: 'Restored from Discarded',
                  },
                });
                if (!result.allowed) {
                  window.alert?.(result.reason || 'Restore failed');
                  return;
                }
                try {
                  await applyTransition({ referral: selectedReferral, result, context: { actorUserId: appUserId } });
                  triggerDataRefresh();
                } catch (err) {
                  window.alert?.(err.message || 'Restore failed');
                }
              }}
            />
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
  { key: 'medicaid_number', label: 'Insurance / CIN' },
];

function IntakePanel({ referrals, selectedReferral, resolveSource, resolveUser, onOpenTriage, onOpenFiles, onOpenTab, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveMarketer } = useLookups();
  const p = selectedReferral?.patient;
  const doneMap = Object.fromEntries(INTAKE_DEMO_FIELDS.map(({ key }) => [
    key,
    key === 'medicaid_number' ? hasInsuranceDetails(p) : !!(p?.[key]),
  ]));
  const isSN = selectedReferral?.division === 'Special Needs';
  const isALF = selectedReferral?.division === 'ALF';
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
  // Insurance Details readiness is now sourced from Demographics (plan +
  // member ID), not from legacy InsuranceChecks rows. We still subscribe to
  // `insuranceCheckStore` above to keep the store hydrated for the
  // Eligibility module surfaces, but this panel no longer reads from it.
  // Eligibility itself is completed concurrently from the patient drawer, so
  // the Intake panel no longer gates a forward button on insurance details.
  void insuranceCheckStore;

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [initialEmrSaving, setInitialEmrSaving] = useState(false);
  const [initialEmrError, setInitialEmrError] = useState(null);
  const [confirmInitialEmr, setConfirmInitialEmr] = useState(false);

  // Cursory review is persisted via the shared CursoryReview hook (same one
  // the F2F module panel + drawer F2F tab use), so the checklist reflects
  // work already done — regardless of which module the referral lives in.
  // This is the "did the work happen" model, not a "what stage is it in" one.
  const { checked: reviewChecked, toggle: toggleReview } = useCursoryReview(selectedReferral?._id);

  useEffect(() => {
    setShowDatePicker(false);
    setReceivedDate('');
    setPdfError(null);
    setInitialEmrError(null);
    setConfirmInitialEmr(false);
  }, [selectedReferral?._id]);

  const reviewComplete = isF2FChecklistComplete(reviewChecked);
  const completedReq = F2F_REQUIRED_ITEMS.filter((i) => reviewChecked[i.key]).length;
  const totalReq = F2F_REQUIRED_ITEMS.length;

  function daysLeft(exp) {
    return daysUntilCalendarDate(exp);
  }
  async function handleLogReceived() {
    if (!receivedDate || !selectedReferral) return;
    setSaving(true);
    try {
      const expiration = addCalendarDays(receivedDate, 90);
      // Optimistic so the F2F section + Push-to-Clinical-RN gate reflect the
      // new date instantly (both read selectedReferral / the store).
      const f2fFields = {
        f2f_date: receivedDate,
        f2f_expiration: expiration,
        f2f_date_logged_by_id: appUserId || 'unknown',
        f2f_date_logged_at: new Date().toISOString(),
      };
      await updateReferralOptimistic(selectedReferral._id, f2fFields);
      await maybeClearDocumentationDeferred(
        { ...selectedReferral, ...f2fFields },
        { actorUserId: appUserId },
      );
      triggerDataRefresh();
      setShowDatePicker(false); setReceivedDate('');
    } catch {} finally { setSaving(false); }
  }

  const canStampInitialEmr = canPerm(PERMISSION_KEYS.INTAKE_EMR_INITIAL);
  // Complete EMR implies initial — you can't have the full chart without it.
  const initialEmrDone = !!selectedReferral?.emr_initial_onboarded_at || !!selectedReferral?.emr_onboarded_at;
  const initialEmrAt = selectedReferral?.emr_initial_onboarded_at || selectedReferral?.emr_onboarded_at;
  const initialEmrById = selectedReferral?.emr_initial_onboarded_by_id || selectedReferral?.emr_onboarded_by_id;

  async function handleConfirmInitialEmr() {
    if (!selectedReferral || !canStampInitialEmr || initialEmrDone) return;
    setInitialEmrSaving(true); setInitialEmrError(null);
    try {
      await updateReferralOptimistic(selectedReferral._id, {
        emr_initial_onboarded_at: new Date().toISOString(),
        emr_initial_onboarded_by_id: appUserId || 'unknown',
      });
      triggerDataRefresh();
      setConfirmInitialEmr(false);
    } catch (err) {
      setInitialEmrError(err.message || 'Failed to save');
    } finally {
      setInitialEmrSaving(false);
    }
  }

  const days = selectedReferral ? daysLeft(selectedReferral.f2f_expiration) : null;
  const urgencyColor = days === null ? null : days < 0 ? palette.primaryMagenta.hex : days <= 7 ? palette.primaryMagenta.hex : days <= 14 ? palette.accentOrange.hex : days <= 30 ? '#7A5F00' : palette.accentGreen.hex;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <SelectedPatientHeader
            referral={selectedReferral}
            stageLabel={
              selectedReferral.current_stage === 'Post Visit Intake'
                ? 'Post Visit Intake'
                : isF2F
                  ? (selectedReferral.soc_completed_date ? 'F2F / MD Orders · SOC done' : 'F2F / MD Orders')
                  : (selectedReferral.soc_completed_date ? 'Intake · SOC done' : 'Intake')
            }
          />

          <div style={{ background: '#FFFFFF', borderRadius: 10, padding: '8px 8px 10px', marginBottom: 14 }}>
            <PatientSnapshot
              patient={selectedReferral?.patient}
              referral={selectedReferral}
              triageData={triageData}
              onOpenTab={(tab) => onOpenTab?.(selectedReferral, tab)}
            />
          </div>

          {/* ALF-only: Initial EMR Onboarding is the FIRST intake job — the
              chart must exist in HCHB before anything else (visit scheduling
              runs concurrently in SOC/ROC). Companion milestone — does NOT
              advance stage. Complete EMR onboarding lives in the patient
              drawer's EMR Onboarding tab. */}
          {isALF && (
            <PanelSection title="Initial EMR Onboarding">
              {initialEmrDone ? (
                <div style={{
                  borderRadius: 10,
                  background: '#E5F3E4',
                  padding: '10px 11px',
                  marginBottom: 8,
                }}>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: '#2F6B2A', margin: '0 0 4px' }}>
                    Initial EMR complete
                  </p>
                  <InfoRow
                    label="Completed"
                    value={new Date(initialEmrAt).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                    highlight="#2F6B2A"
                  />
                  {initialEmrById && (
                    <InfoRow
                      label="By"
                      value={resolveUser?.(initialEmrById) || initialEmrById}
                    />
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: '#3A3545', lineHeight: 1.5, margin: '0 0 10px' }}>
                  Create the HCHB chart now. Download the packet, enter the patient, then confirm. They stay in Intake.
                </p>
              )}

              <EmrPacketDownloadButton
                referral={selectedReferral}
                resolveSource={resolveSource}
                resolveUser={resolveUser}
                resolveMarketer={resolveMarketer}
                onError={setPdfError}
              />
              {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}

              {!initialEmrDone && canStampInitialEmr && (
                <div style={{ marginTop: 10 }}>
                  {!confirmInitialEmr ? (
                    <ActionBtn
                      label="Complete initial EMR onboarding"
                      variant="success"
                      onClick={() => setConfirmInitialEmr(true)}
                    />
                  ) : (
                    <div style={{
                      borderRadius: 10,
                      background: '#E5F3E4',
                      padding: '10px 11px',
                    }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px', lineHeight: 1.45 }}>
                        Confirm the HCHB chart is created?
                      </p>
                      <p style={{ fontSize: 12, color: '#3A3545', lineHeight: 1.5, margin: '0 0 10px' }}>
                        This stamps initial EMR done. The patient stays in Intake.
                      </p>
                      {initialEmrError && (
                        <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, margin: '0 0 6px' }}>{initialEmrError}</p>
                      )}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={handleConfirmInitialEmr}
                          disabled={initialEmrSaving}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
                            background: initialEmrSaving ? '#8FBF86' : palette.accentGreen.hex,
                            color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650,
                            cursor: initialEmrSaving ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          {initialEmrSaving ? 'Saving…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setConfirmInitialEmr(false); setInitialEmrError(null); }}
                          disabled={initialEmrSaving}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
                            background: '#E8E6ED',
                            color: '#3A3545',
                            fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!initialEmrDone && !canStampInitialEmr && (
                <p style={{ fontSize: 12, color: '#5A5466', marginTop: 8 }}>
                  You need permission to stamp initial EMR.
                </p>
              )}
            </PanelSection>
          )}

          {selectedReferral.soc_completed_date && selectedReferral.current_stage !== 'SOC Completed' && (
            <div
              data-testid="post-soc-work-banner"
              style={{
                borderRadius: 10,
                background: '#E5F3E4',
                marginBottom: 12,
                padding: '10px 12px',
              }}
            >
              <p style={{ fontSize: 12.5, fontWeight: 700, color: '#2F6B2A', margin: 0 }}>
                SOC completed {fmtCalendarDate(selectedReferral.soc_completed_date)}
              </p>
              <p style={{ fontSize: 12, color: palette.backgroundDark.hex, margin: '4px 0 0', lineHeight: 1.45 }}>
                Still on the Completed list. Finish remaining paperwork here.
              </p>
            </div>
          )}

          {/* Concurrent SOC/ROC: visit scheduled while paperwork continues here */}
          {!selectedReferral.soc_completed_date && selectedReferral.soc_scheduled_date && (
            <div
              data-testid="soc-scheduled-banner"
              style={{
                borderRadius: 10,
                background: hexToRgba(palette.accentBlue.hex, 0.08),
                marginBottom: 12,
                padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: palette.accentBlue.hex }}>
                <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="2" />
                <path d="M3 9.5h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.accentBlue.hex, margin: 0 }}>
                {episodeTypeLabel(selectedReferral)} scheduled for {fmtCalendarDate(selectedReferral.soc_scheduled_date)}
              </p>
            </div>
          )}

          {/* Returned from Eligibility — required note becomes a flag here */}
          {selectedReferral.eligibility_returned_to_intake_note && (
            <ReturnedFromEligibilityFlag note={selectedReferral.eligibility_returned_to_intake_note} at={selectedReferral.eligibility_returned_to_intake_at} />
          )}

          {/* Returned from Clinical RN Review — note is optional, so flag on
              the boolean (the send-back can happen with nothing filled out). */}
          {(selectedReferral.returned_from_clinical === 'true' || selectedReferral.returned_from_clinical === true) && (
            <ReturnedFromClinicalFlag
              note={selectedReferral.returned_from_clinical_note}
              at={selectedReferral.returned_from_clinical_at}
            />
          )}

          {/* F2F section — shown for F2F-stage referrals OR whenever an F2F
              date has been logged. Surfacing the date the moment it's logged
              (e.g. from the Files tab during Intake) means staff don't have
              to wait until the patient is moved to F2F/MD Orders Pending to
              see the 90-day clock — they get immediate confirmation that the
              date was captured. */}
          {(isF2F || selectedReferral.f2f_date) && (
            <>
              <PanelSection title="F2F Status">
                {days !== null ? (
                  <div style={{ background: '#FFFFFF', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                    <p style={{ fontSize: 28, fontWeight: 800, color: urgencyColor, lineHeight: 1, margin: 0 }}>{days < 0 ? 'EXPIRED' : `${days}d`}</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#5A5466', margin: '4px 0 0' }}>{days < 0 ? 'F2F has expired' : 'until expiration'}</p>
                    {selectedReferral.f2f_date && (
                      <p style={{ fontSize: 12, color: '#3A3545', margin: '6px 0 0' }}>
                        Visit {fmtCalendarDate(selectedReferral.f2f_date, '')}
                        {selectedReferral.f2f_expiration && (
                          <>
                            {' · '}
                            Expires {fmtCalendarDate(selectedReferral.f2f_expiration, '')}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                ) : selectedReferral.f2f_date ? (
                  <div style={{ background: '#FFFFFF', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 650, color: '#2F6B2A', lineHeight: 1.3, margin: 0 }}>
                      Visit logged {fmtCalendarDate(selectedReferral.f2f_date, '')}
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: '#5A5466', textAlign: 'center', padding: '6px 0', margin: 0 }}>No F2F date recorded</p>
                )}
                {/* PECOS / OPRA InfoRows removed from the intake right-hand
                    panel on 2026-05-27: staff cannot act on those checks
                    inside this software (they live on the provider profile),
                    so showing them here was clutter without a workflow. */}
              </PanelSection>

              {isF2F && canPerm(PERMISSION_KEYS.CLINICAL_F2F) && (
                <PanelSection title="Log F2F Date">
                  {!showDatePicker ? (
                    <ActionBtn
                      label={selectedReferral.f2f_date ? 'Update F2F Date' : 'F2F / MD Orders Received'}
                      variant={selectedReferral.f2f_date ? 'default' : 'success'}
                      onClick={() => { if (selectedReferral.f2f_date) setReceivedDate(toCalendarDateInput(selectedReferral.f2f_date)); setShowDatePicker(true); }}
                    />
                  ) : (
                    <div style={{ borderRadius: 10, background: '#E5F3E4', padding: '10px' }}>
                      <input type="date" value={receivedDate} max={todayCalendarDate()} onChange={(e) => setReceivedDate(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 8px', borderRadius: 7, border: 'none', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', marginBottom: 8, background: '#FFFFFF' }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleLogReceived} disabled={!receivedDate || saving} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: receivedDate ? palette.accentGreen.hex : '#E8E6ED', color: receivedDate ? palette.backgroundLight.hex : '#8A8494', fontSize: 12.5, fontWeight: 650, cursor: receivedDate ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>{saving ? 'Saving...' : 'Confirm'}</button>
                        <button onClick={() => { setShowDatePicker(false); setReceivedDate(''); }} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: '#E8E6ED', color: '#3A3545', fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <ActionBtn
                    label={
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7h5l2 2h9v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        </svg>
                        Go to Files
                      </>
                    }
                    variant="default"
                    onClick={() => onOpenFiles?.(selectedReferral)}
                  />
                </PanelSection>
              )}
            </>
          )}

          <PanelSection title="Document Review">
            <div style={{ background: '#FFFFFF', borderRadius: 10, padding: '10px 10px 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4A4458' }}>Cursory review</span>
              <span style={{ fontSize: 12, fontWeight: 750, color: reviewComplete ? '#2F6B2A' : '#5A5466' }}>{completedReq}/{totalReq}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: '#E8E6ED', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${totalReq > 0 ? Math.round((completedReq / totalReq) * 100) : 0}%`, background: reviewComplete ? palette.accentGreen.hex : palette.accentOrange.hex, borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            {F2F_REVIEW_CHECKLIST.map((item) => (
              <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!reviewChecked[item.key]} onChange={() => toggleReview(item.key)} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: reviewChecked[item.key] ? '#5A5466' : palette.backgroundDark.hex, fontWeight: item.required ? 600 : 500 }}>
                  {item.label}{item.required && !reviewChecked[item.key] ? ' *' : ''}
                </span>
              </label>
            ))}
            </div>
            <HospitalizationReview referral={selectedReferral} patient={selectedReferral?.patient} />

            {/* Push-to-Clinical lives DIRECTLY UNDER the cursory review
                checkboxes. Once fired it hands the case to Clinical
                (`in_clinical_review` + stage move). Intake's queue then
                drops the row; Clinical Send Back is what brings it back.
                Shown for every Intake case, including legacy 'Post Visit
                Intake' rows, which normalize into the regular clinical
                queue on push. */}
            <PushToClinicalRNButton
              referral={selectedReferral}
              cursoryReviewComplete={reviewComplete}
              actorUserId={appUserId}
              onSelectedReferralLeftModule={onSelectedReferralLeftModule}
            />
          </PanelSection>

          {/* Forward movement out of Intake happens via "Push to Clinical RN"
              (above, under the cursory review) — that's what leaves Intake now.
              Eligibility is completed concurrently from the patient drawer, so
              there is no linear "Push to Eligibility" button here anymore. SN
              referrals still get a quick link to the triage form. */}
          <PanelSection title="Actions">
            {isSN && (
              <ActionBtn
                label={
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="6" y="5" width="12" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M9 5.2V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v.7" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    Open Triage Form
                  </>
                }
                variant="default"
                onClick={() => onOpenTriage?.(selectedReferral)}
              />
            )}
            {/* The deferred-docs machinery ("Advance without F2F" fast-track,
                "Post-SOC documentation" action, 30-day clock) is deprecated:
                visits and paperwork run side by side for every case, so
                post-visit paperwork is just normal Intake work — cursory
                review + Push to Clinical above. */}
          </PanelSection>
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
//
// Behaviour (2026-05-29): pushing to Clinical RN now MOVES the patient out of
// Intake — `current_stage` becomes 'Clinical Intake RN Review'. Intake's work
// is done once the cursory review is in and the push fires, so the referral
// should not linger in the Intake module. Eligibility is completed
// concurrently from the patient drawer at any stage; the LIFO rule still flips
// the patient to Staffing once both eligibility + clinical review complete.
function PushToClinicalRNButton({ referral, cursoryReviewComplete, actorUserId, onSelectedReferralLeftModule }) {
  const inClinical = referral?.in_clinical_review === true || referral?.in_clinical_review === 'true';

  async function handlePushClinical() {
    if (!referral?._id) return;
    const result = attemptTransition({
      referral,
      toStage: 'Clinical Intake RN Review',
      context: {
        // System: this button is the sanctioned handoff, and legacy rows
        // parked in 'Post Visit Intake' don't have this edge on their
        // declared allowlist — pushing normalizes them into the regular
        // clinical queue.
        system: true,
        note: '[Pushed to Clinical RN — left Intake]',
        actorUserId,
        extraFields: {
          in_clinical_review: true,
          clinical_review_pushed_at: new Date().toISOString(),
          ...(actorUserId ? { clinical_review_pushed_by_id: actorUserId } : {}),
          // Clear prior Clinical → Intake return flag when Intake re-pushes.
          returned_from_clinical: false,
          returned_from_clinical_note: null,
          returned_from_clinical_at: null,
          returned_from_clinical_by: null,
        },
      },
    });
    if (!result.allowed) return;
    // Clear the selection BEFORE the await so the panel collapses on the same
    // render the optimistic store update lands. Without this, the patient
    // drops from the left queue immediately but the right panel keeps
    // rendering them, so the user thinks the click did nothing and clicks
    // again — and the second click is a silent no-op because the patient's
    // current_stage is already 'Clinical Intake RN Review'.
    onSelectedReferralLeftModule?.();
    try {
      await applyTransition({ referral, result, context: { actorUserId } });
    } catch {}
  }

  if (inClinical) {
    return (
      <div style={{ padding: '10px 12px', borderRadius: 10, background: '#E5F3E4', marginTop: 10 }}>
        <p style={{ fontSize: 12.5, fontWeight: 700, color: '#2F6B2A', margin: 0 }}>
          Pushed to Clinical Review
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
        background: cursoryReviewComplete ? palette.accentGreen.hex : '#E8E6ED',
        color: cursoryReviewComplete ? palette.backgroundLight.hex : '#5A5466',
        fontSize: 13,
        fontWeight: 700,
        cursor: cursoryReviewComplete ? 'pointer' : 'not-allowed',
        textAlign: 'left',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        transition: 'filter 0.12s',
      }}
      onMouseEnter={(e) => cursoryReviewComplete && (e.currentTarget.style.filter = 'brightness(1.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {cursoryReviewComplete ? 'Push to Clinical Review' : 'Finish required cursory review to push'}
      {cursoryReviewComplete && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
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
                  Follow-up {f.follow_up_date ? fmtCalendarDateShort(f.follow_up_date, 'TBD') : 'TBD'}
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
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const storePhysicians = useCareStore((s) => s.physicians);
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
        // Archived files don't count as current F2F/MD Orders documentation.
        setFiles(mapped.filter((f) => !f.archived_at && (f.category === 'F2F' || f.category === 'MD Orders')));
      })
      .catch(() => { if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedReferral?.patient_id]);

  const reviewComplete = isF2FChecklistComplete(reviewChecked);
  const completedReq = F2F_REQUIRED_ITEMS.filter((i) => reviewChecked[i.key]).length;
  const totalReq = F2F_REQUIRED_ITEMS.length;

  function daysLeft(exp) {
    return daysUntilCalendarDate(exp);
  }

  async function handleLogReceived() {
    if (!receivedDate || !selectedReferral) return;
    setSaving(true);
    setSaveError(null);
    try {
      const expiration = addCalendarDays(receivedDate, 90);
      // Optimistic — drawer F2F indicator + Push-to-Clinical-RN gate read from
      // the store; raw updateReferral leaves them stale until the next sync.
      const f2fFields = {
        f2f_date:       receivedDate,
        f2f_expiration: expiration,
        f2f_date_logged_by_id: appUserId || 'unknown',
        f2f_date_logged_at: new Date().toISOString(),
      };
      await updateReferralOptimistic(selectedReferral._id, f2fFields);
      await maybeClearDocumentationDeferred(
        { ...selectedReferral, ...f2fFields },
        { actorUserId: appUserId },
      );
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
  const physician = (() => {
    const pid = ref?.physician_id;
    if (!pid) return null;
    return Object.values(storePhysicians || {}).find((p) => p.id === pid || p._id === pid) || null;
  })();
  const phyPecos = physician && (physician.is_pecos_enrolled === true || physician.is_pecos_enrolled === 'true' || physician.is_pecos_enrolled === 'TRUE');
  const phyOpra = physician && (physician.is_opra_enrolled === true || physician.is_opra_enrolled === 'true' || physician.is_opra_enrolled === 'TRUE');

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
        <ReturnedFromClinicalFlag note={ref.returned_from_clinical_note} at={ref.returned_from_clinical_at} />
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
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 15, fontWeight: 750, color: palette.backgroundDark.hex }}>
                      Visit {fmtCalendarDate(ref.f2f_date, '')}
                    </p>
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 2 }}>
                      Expires {fmtCalendarDate(ref.f2f_expiration, '')}
                    </p>
                    {(ref.f2f_date_logged_by_id || ref.f2f_date_logged_at) && (
                      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>
                        Logged by {ref.f2f_date_logged_by_id ? resolveUser(ref.f2f_date_logged_by_id) : '—'}
                        {ref.f2f_date_logged_at
                          ? ` · ${new Date(ref.f2f_date_logged_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>
                No F2F date recorded
              </p>
            )}
            {physician ? (
              <>
                <InfoRow label="PECOS" value={phyPecos ? 'Enrolled' : 'Not enrolled'} highlight={phyPecos ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
                <InfoRow label="OPRA" value={phyOpra ? 'Eligible' : 'Not eligible'} highlight={phyOpra ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
              </>
            ) : (
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '4px 0 2px' }}>
                No physician linked — PECOS / OPRA hidden.
              </p>
            )}
          </PanelSection>

          <PanelSection title="Actions">

            {/* ── Log F2F / MD Orders Received ── */}
            {!canPerm(PERMISSION_KEYS.CLINICAL_F2F) ? null : !showDatePicker ? (
              <button
                onClick={() => {
                  // Pre-fill with existing date if available so the user just confirms
                  if (ref.f2f_date) {
                    setReceivedDate(toCalendarDateInput(ref.f2f_date));
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
                  max={todayCalendarDate()}
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
                    Clock starts {fmtCalendarDate(receivedDate, '')}
                    {' — '}
                    expires <strong style={{ color: palette.accentOrange.hex }}>
                      {fmtCalendarDate(addCalendarDays(receivedDate, 90), '')}
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
                    {f.r2_key && (
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
                        <button
                          onClick={() => openSignedFile(f, { download: true })}
                          title="Download"
                          style={{
                            padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 650,
                            background: hexToRgba(palette.accentBlue.hex, 0.1),
                            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                            color: palette.accentBlue.hex,
                          }}
                        >
                          Download
                        </button>
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

            <HospitalizationReview referral={selectedReferral} patient={selectedReferral?.patient} />

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
              {reviewComplete ? 'Confirm → Clinical Review' : 'Finish required cursory review to send'}
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
function ClinicalRNPanel({ referrals = [], selectedReferral, onOpenTriage, onOpenFiles, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  // Checklist + working decision are persisted to ClinicalReview via this
  // shared hook so the drawer Clinical Review tab and this module panel
  // stay in lockstep. `sendBackNote` / `showSendBack` remain local since
  // they're transient UI state, not part of the saved review.
  const {
    checked,
    decision,
    toggle: toggleItem,
    setDecision,
    clearDecisionLocal,
    startedBy,
    startedAt,
  } = useClinicalReview(selectedReferral?._id);
  const [sendBackNote, setSendBackNote] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);
  const [sendBackError, setSendBackError] = useState(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [confirmError, setConfirmError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const canRunClinicalConfirm = canPerformClinicalRnReview(canPerm);

  useEffect(() => {
    setSendBackNote('');
    setShowSendBack(false);
    setSendBackError(null);
    setSendingBack(false);
    setUnlocking(false);
    setUnlockError(null);
    setConfirmError(null);
    setConfirming(false);
  }, [selectedReferral?._id]);

  // Referral stamp (post-Confirm) hard-locks until an authorized unlock —
  // working Accept/Conditional alone still locks for the in-progress review.
  const reviewFinalized = !!selectedReferral?.clinical_review_decision;
  const decisionLocked = reviewFinalized || decision === 'accept' || decision === 'conditional';
  const confirmDecision = resolveClinicalConfirmDecision(decision, selectedReferral);
  // Ready to send as soon as Accept/Conditional is chosen. Do not disable
  // the button — Julia / Adeshia could see it and clicks did nothing.
  const canConfirm = !!confirmDecision;
  const canUnlockClinical = canPerm(PERMISSION_KEYS.CLINICAL_RN_UNLOCK);

  async function handleUnlockClinicalReview() {
    if (!selectedReferral || !canUnlockClinical || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockClinicalReview({
        referral: selectedReferral,
        appUserId,
        clearWorkingDecision: clearDecisionLocal,
      });
    } catch (err) {
      setUnlockError(err.message || 'Failed to unlock clinical review');
    } finally {
      setUnlocking(false);
    }
  }
  // Informational only — surfaced as a header badge so the RN can see
  // whether eligibility has also completed (the drawer's eligibility tab
  // can finish that work in parallel). Does not gate the Confirm action.
  const eligibilityDone = !!selectedReferral?.eligibility_completed_at;
  const preCheckCount = (referrals || []).filter(isClinicalLeadPreCheck).length;
  const reviewCount = (referrals || []).length - preCheckCount;

  async function handleConfirm() {
    if (!selectedReferral || confirming) return;
    if (!confirmDecision) {
      setConfirmError('Choose Accept or Conditional, then confirm.');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await completeClinicalReview({
        referral: selectedReferral,
        decision: confirmDecision,
        appUserId,
        onLeftModule: onSelectedReferralLeftModule,
      });
    } catch (err) {
      setConfirmError(err?.message || 'Confirm failed. Try again.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleSendBack() {
    // Available even after Accept — RNs often need more paperwork. Confirm
    // already moved the patient to EMR; use Send Back there instead.
    if (!selectedReferral || sendingBack) return;
    const note = sendBackNote.trim();
    setSendingBack(true);
    setSendBackError(null);
    // Clear working Accept/Conditional so a later re-push is not locked.
    if (decisionLocked) setDecision(null);
    // Everything returns to Intake — the post-visit detour through 'Post
    // Visit Intake' is deprecated (visits and paperwork run side by side as
    // the status quo). Concurrent cases already sitting on an Intake-side
    // stage just get the send-back flags with no stage move.
    const sendBackStage = 'Intake';
    const staysPut = selectedReferral.current_stage === 'Intake'
      || selectedReferral.current_stage === 'F2F/MD Orders Pending';
    const sendBackFields = clinicalSendBackFields({ note, actorUserId: appUserId });
    const noteText = note ? `[Returned from Clinical] ${note}` : '[Returned from Clinical — more paperwork needed]';

    if (staysPut) {
      setShowSendBack(false);
      setSendBackNote('');
      onSelectedReferralLeftModule?.();
      try {
        await updateReferralOptimistic(selectedReferral._id, sendBackFields);
        await createNoteOptimistic({
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          patient_id: selectedReferral.patient_id || null,
          referral_id: selectedReferral.id || null,
          author_id: appUserId || 'unknown',
          content: noteText,
          created_at: new Date().toISOString(),
          is_pinned: false,
        });
        recordActivity({
          actorUserId: appUserId,
          action: 'Returned from Clinical',
          patientId: selectedReferral.patient_id,
          referralId: selectedReferral.id,
          detail: note || 'More paperwork needed',
        }).catch(() => {});
        triggerDataRefresh();
      } catch (err) {
        setSendBackError(err.message || 'Failed to send back to Intake');
        setSendingBack(false);
        setShowSendBack(true);
      }
      return;
    }

    const result = attemptTransition({
      referral: selectedReferral,
      toStage: sendBackStage,
      context: {
        // Clinical Intake RN Review is a protectedExit stage and 'Intake' is
        // not on its declared edge list; this in-panel action is the
        // sanctioned exit, so bypass the edge allowlist like the Eligibility
        // → Intake send-back does.
        system: true,
        note: noteText,
        actorUserId: appUserId,
        extraFields: sendBackFields,
      },
    });
    if (!result.allowed) {
      setSendBackError(result.reason || `Cannot send back to ${sendBackStage}`);
      setSendingBack(false);
      return;
    }
    setShowSendBack(false);
    setSendBackNote('');
    // Clear the selection BEFORE the await so the panel collapses on the same
    // render the optimistic update lands (see handleConfirm for the rationale).
    onSelectedReferralLeftModule?.();
    try {
      await applyTransition({ referral: selectedReferral, result, context: { actorUserId: appUserId } });
      triggerDataRefresh();
    } catch (err) {
      setSendBackError(err.message || `Failed to send back to ${sendBackStage}`);
      setSendingBack(false);
      setShowSendBack(true);
    }
  }

  return (
    <Panel width={320}>
      {(preCheckCount > 0 || reviewCount > 0) && (
        <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #E6E4EB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: '#5A5466' }}>Lead pre-check</span>
            <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.primaryDeepPlum.hex }}>{preCheckCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: '#5A5466' }}>Clinical review</span>
            <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{reviewCount}</span>
          </div>
        </div>
      )}
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          {/* Concurrent presence indicator — reminds clinical staff that the
              patient may still be in Intake / Eligibility. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.primaryMagenta.hex, 0.12), color: palette.primaryMagenta.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Clinical Review
            </span>
            {isSocCompletedReferral(selectedReferral) ? (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentGreen.hex, 0.12), color: palette.accentGreen.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Visit already done
              </span>
              ) : selectedReferral.current_stage && selectedReferral.current_stage !== 'Clinical Intake RN Review' ? (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                also in {displayStageName(selectedReferral) || selectedReferral.current_stage}
              </span>
            ) : null}
            {eligibilityDone && (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: hexToRgba(palette.accentGreen.hex, 0.12), color: palette.accentGreen.hex, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                eligibility ✓
              </span>
            )}
          </div>

          {canRunClinicalConfirm && (
            <div style={{
              position: 'sticky', top: -16, zIndex: 3, margin: '0 -14px 12px',
              padding: '12px 14px 10px', background: '#F3F2F6',
              borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
            }}>
              <button
                type="button"
                data-testid="confirm-patient-btn"
                onClick={handleConfirm}
                disabled={confirming}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                  background: canConfirm ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                  color: canConfirm ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                  fontSize: 13, fontWeight: 700, cursor: confirming ? 'wait' : 'pointer',
                  textAlign: 'left', letterSpacing: '-0.01em',
                }}
              >
                {confirming
                  ? 'Saving…'
                  : canConfirm
                    ? (isSocCompletedReferral(selectedReferral)
                      ? 'Approve → Completed'
                      : 'Confirm → Staffing')
                    : 'Select Accept or Conditional to confirm'}
              </button>
              {confirmError && (
                <p data-testid="confirm-clinical-error" style={{ fontSize: 11, color: palette.primaryMagenta.hex, fontWeight: 600, margin: '8px 0 0', lineHeight: 1.4 }}>
                  {confirmError}
                </p>
              )}
              {!canConfirm && (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '8px 0 0', lineHeight: 1.4 }}>
                  Choose Accept or Conditional below, then this button sends the case on.
                </p>
              )}
              {canConfirm && (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '8px 0 0', lineHeight: 1.4 }}>
                  {isSocCompletedReferral(selectedReferral)
                    ? 'The visit already happened — approving sends the case to Completed.'
                    : 'Approving is a hard push to Staffing.'}
                </p>
              )}
            </div>
          )}

          {selectedReferral.clinical_review_assigned_to_id && !selectedReferral.clinical_review_completed_at && (
            <div
              data-testid="clinical-review-assigned-to"
              style={{
                marginBottom: 12, padding: '9px 11px', borderRadius: 8,
                background: hexToRgba(palette.primaryMagenta.hex, 0.06),
                border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.16)}`,
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                Assigned Clinical RN
              </p>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, margin: '3px 0 0' }}>
                {resolveUser(selectedReferral.clinical_review_assigned_to_id) || selectedReferral.clinical_review_assigned_to_id}
              </p>
            </div>
          )}

          {startedBy && (
            <div
              data-testid="clinical-review-started-by"
              style={{
                marginBottom: 12, padding: '9px 11px', borderRadius: 8,
                background: hexToRgba(palette.primaryMagenta.hex, 0.06),
                border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.16)}`,
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                Review started by
              </p>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, margin: '3px 0 0' }}>
                {resolveUser(startedBy) || startedBy}
                {startedAt && (
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginLeft: 8 }}>
                    {new Date(startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </p>
            </div>
          )}

          <ClinicalChecklistUI
            checked={checked}
            onToggle={decisionLocked ? () => {} : toggleItem}
            decision={decision}
            onDecisionChange={decisionLocked ? () => {} : setDecision}
            compact
            locked={decisionLocked}
            lockedMessage={reviewFinalized
              ? 'Locked: review finalized. Unlock so staff can continue editing.'
              : (decisionLocked
                ? `Locked: ${decision === 'conditional' ? 'Conditional' : 'Accepted'} selected. Unlock so staff can continue editing.`
                : undefined)}
            canUnlock={canUnlockClinical && decisionLocked}
            onUnlock={handleUnlockClinicalReview}
            unlocking={unlocking}
          />
          {unlockError && (
            <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, fontWeight: 600, margin: '0 0 8px' }}>{unlockError}</p>
          )}

          {/* Send back — everything returns to Intake (post-visit cases too;
              the visit already happened but the paperwork loop continues in
              Intake, never in a special post-visit stage). */}
          {selectedReferral.current_stage !== 'Completed' && (
          <PanelSection title="Send Back">
            {decisionLocked && !showSendBack && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.45, margin: '0 0 8px' }}>
                You can still send back after Accept if more paperwork is needed.
              </p>
            )}
            {!showSendBack ? (
              <ActionBtn
                label="↩ Send Back to Intake"
                variant="warning"
                onClick={() => setShowSendBack(true)}
              />
            ) : (
              <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`, background: hexToRgba(palette.accentOrange.hex, 0.04), padding: '10px 11px', marginBottom: 6 }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                  Note for Intake (recommended — what paperwork is missing):
                </p>
                <textarea
                  data-testid="send-back-note"
                  value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)}
                  placeholder="e.g. Need updated F2F / missing MD orders / facesheet incomplete…"
                  rows={3}
                  style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${sendBackNote.trim() ? palette.accentOrange.hex : 'var(--color-border)'}`, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box', marginBottom: 8 }}
                />
                {sendBackError && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8, fontWeight: 600 }}>{sendBackError}</p>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    data-testid="send-back-confirm"
                    onClick={handleSendBack}
                    disabled={sendingBack}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: sendingBack ? hexToRgba(palette.accentOrange.hex, 0.5) : palette.accentOrange.hex, color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650, cursor: sendingBack ? 'wait' : 'pointer' }}
                  >
                    {sendingBack ? 'Sending…' : 'Send Back'}
                  </button>
                  <button onClick={() => { setShowSendBack(false); setSendBackNote(''); setSendBackError(null); }} disabled={sendingBack} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
function AuthorizationPanel({ selectedReferral, onInitiateTransition, onSelectedReferralLeftModule }) {
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
        onSelectedReferralLeftModule={onSelectedReferralLeftModule}
      />
    </Panel>
  );
}

// ── 8. Conflict ───────────────────────────────────────────────────────────────
// Two-level severity (2026-06-12). Legacy Medium / Critical values are
// normalized to Low / High at display time via `normalizeSeverity`.
const SEVERITY_PILL = {
  Low:  { bg: hexToRgba(palette.accentBlue.hex, 0.14),     text: palette.accentBlue.hex },
  High: { bg: hexToRgba(palette.primaryMagenta.hex, 0.18), text: palette.primaryMagenta.hex },
};

// Destinations shown in the Conflict panel's "Resolve and send to…" dropdown.
// Derived DIRECTLY from StageRules so the dropdown and `canMoveFromTo` can
// never drift apart (the previous hardcoded list missed an edge that produced
// "Cannot move from Conflict to OPWDD Enrollment" toasts).
//
// Two stages are filtered out for UX, not policy:
//   - NTUC is reached via its own dedicated "Request NTUC" button below.
//   - Admin Confirmation is an internal interception target for NTUC requests
//     and not a user-pickable resolution destination.
const CONFLICT_PANEL_HIDDEN_DESTINATIONS = new Set(['NTUC', 'Admin Confirmation']);
const CONFLICT_ANY_STAGE_DESTINATIONS = (StageRules.stages.Conflict?.canMoveTo || [])
  .filter((s) => !CONFLICT_PANEL_HIDDEN_DESTINATIONS.has(s));

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
                const displaySeverity = normalizeSeverity(c.severity);
                const sc = SEVERITY_PILL[displaySeverity] || SEVERITY_PILL.Low;
                return (
                  <div key={c._id} style={{ padding: '10px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`, marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{c.type ? conflictCategoryLabel(c.type) : 'Unknown'}</span>
                      <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.text }}>{displaySeverity}</span>
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

// ── EMR Onboarding ────────────────────────────────────────────────────────────
// Sits between Clinical Intake RN Review and Staffing Feasibility. The patient
// must be onboarded into the external EMR (HCHB) before scheduling can plot a
// SOC. Staff download the EMR Onboarding Packet, complete onboarding in the
// EMR, then mark the patient onboarded — which advances them to Staffing.
function EmrOnboardingPanel({ selectedReferral, resolveSource, resolveUser, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveMarketer } = useLookups();
  const {
    clearDecisionLocal: clearClinicalDecisionLocal,
  } = useClinicalReview(selectedReferral?._id);
  const [pdfError, setPdfError] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendBackError, setSendBackError] = useState(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockError, setUnlockError] = useState(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    setPdfError(null); setOnboardError(null); setOnboarding(false);
    setShowSendBack(false); setSendBackNote(''); setSendBackError(null); setSendingBack(false);
    setShowUnlock(false); setUnlockReason(''); setUnlockError(null); setUnlocking(false);
  }, [selectedReferral?._id]);

  // Onboarding is owned by the scheduling team; reuse the existing staffing
  // permission so current schedulers aren't locked out by a brand-new key.
  const canOnboard = canPerm(PERMISSION_KEYS.SCHEDULING_STAFFING);
  const canSendBackClinical = canPerformClinicalRnReview(canPerm);
  const canUnlockClinical = canPerm(PERMISSION_KEYS.CLINICAL_RN_UNLOCK);
  const alreadyOnboarded = !!selectedReferral?.emr_onboarded_at;
  const clinicalFinalized = !!selectedReferral?.clinical_review_decision;

  async function handleMarkOnboarded() {
    if (!selectedReferral || !canOnboard) return;
    const now = new Date().toISOString();
    setOnboarding(true); setOnboardError(null);
    const result = attemptTransition({
      referral: selectedReferral,
      toStage: 'Staffing Feasibility',
      context: {
        note: '[EMR onboarding complete → Staffing Feasibility]',
        actorUserId: appUserId,
        extraFields: { emr_onboarded_at: now, emr_onboarded_by_id: appUserId || 'unknown' },
      },
    });
    if (!result.allowed) { setOnboardError(result.reason); setOnboarding(false); return; }
    try {
      await applyTransition({ referral: selectedReferral, result, context: { actorUserId: appUserId } });
      triggerDataRefresh();
      onSelectedReferralLeftModule?.();
    } catch (err) {
      setOnboardError(err.message || 'Failed to mark onboarded');
      setOnboarding(false);
    }
  }

  async function handleSendBackToIntake() {
    if (!selectedReferral || sendingBack) return;
    const note = sendBackNote.trim();
    setSendingBack(true);
    setSendBackError(null);
    const result = attemptTransition({
      referral: selectedReferral,
      toStage: 'Intake',
      context: {
        system: true,
        note: note
          ? `[Returned from Clinical after Confirm] ${note}`
          : '[Returned from Clinical after Confirm — more paperwork needed]',
        actorUserId: appUserId,
        extraFields: clinicalSendBackFields({ note, actorUserId: appUserId }),
      },
    });
    if (!result.allowed) {
      setSendBackError(result.reason || 'Cannot send back to Intake');
      setSendingBack(false);
      return;
    }
    setShowSendBack(false);
    setSendBackNote('');
    onSelectedReferralLeftModule?.();
    try {
      await applyTransition({ referral: selectedReferral, result, context: { actorUserId: appUserId } });
      triggerDataRefresh();
    } catch (err) {
      setSendBackError(err.message || 'Failed to send back to Intake');
      setSendingBack(false);
      setShowSendBack(true);
    }
  }

  async function handleUnlockClinicalReview() {
    if (!selectedReferral || !canUnlockClinical || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockClinicalReview({
        referral: selectedReferral,
        appUserId,
        reason: unlockReason,
        clearWorkingDecision: clearClinicalDecisionLocal,
      });
      setShowUnlock(false);
      setUnlockReason('');
      onSelectedReferralLeftModule?.();
    } catch (err) {
      setUnlockError(err.message || 'Failed to unlock clinical review');
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState message="Select a patient to onboard into the EMR." /> : (
        <>
          <PanelSection title="Patient">
            <InfoRow label="Name" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
          </PanelSection>

          {canUnlockClinical && clinicalFinalized && (
            <PanelSection title="Unlock Clinical Review">
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.45, margin: '0 0 8px' }}>
                Unaccept this clinical review so staff can keep editing, then Accept and Confirm again. Returns the patient to Clinical Intake RN Review.
              </p>
              {!showUnlock ? (
                <ActionBtn
                  label="Unlock clinical review"
                  variant="warning"
                  onClick={() => { setShowUnlock(true); setUnlockError(null); }}
                />
              ) : (
                <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`, background: hexToRgba(palette.accentOrange.hex, 0.04), padding: '10px 11px', marginBottom: 6 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                    Reason for unlock (recommended):
                  </p>
                  <textarea
                    data-testid="emr-unlock-clinical-reason"
                    value={unlockReason}
                    onChange={(e) => setUnlockReason(e.target.value)}
                    placeholder="e.g. Wrong Accept decision / missed checklist item…"
                    rows={3}
                    style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${unlockReason.trim() ? palette.accentOrange.hex : 'var(--color-border)'}`, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  {unlockError && (
                    <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8, fontWeight: 600 }}>{unlockError}</p>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      data-testid="emr-unlock-clinical-confirm"
                      onClick={handleUnlockClinicalReview}
                      disabled={unlocking}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: unlocking ? hexToRgba(palette.accentOrange.hex, 0.5) : palette.accentOrange.hex, color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650, cursor: unlocking ? 'wait' : 'pointer' }}
                    >
                      {unlocking ? 'Unlocking…' : 'Unlock review'}
                    </button>
                    <button onClick={() => { setShowUnlock(false); setUnlockReason(''); setUnlockError(null); }} disabled={unlocking} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </PanelSection>
          )}

          {canSendBackClinical && (
            <PanelSection title="Send Back to Intake">
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.45, margin: '0 0 8px' }}>
                Clinical RNs can return this case to Intake for more paperwork even after Accept / Confirm.
              </p>
              {!showSendBack ? (
                <ActionBtn label="↩ Send Back to Intake" variant="warning" onClick={() => setShowSendBack(true)} />
              ) : (
                <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`, background: hexToRgba(palette.accentOrange.hex, 0.04), padding: '10px 11px', marginBottom: 6 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                    Note for Intake (recommended):
                  </p>
                  <textarea
                    data-testid="emr-send-back-note"
                    value={sendBackNote}
                    onChange={(e) => setSendBackNote(e.target.value)}
                    placeholder="e.g. Need updated F2F / missing MD orders…"
                    rows={3}
                    style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${sendBackNote.trim() ? palette.accentOrange.hex : 'var(--color-border)'}`, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box', marginBottom: 8 }}
                  />
                  {sendBackError && (
                    <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8, fontWeight: 600 }}>{sendBackError}</p>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      data-testid="emr-send-back-confirm"
                      onClick={handleSendBackToIntake}
                      disabled={sendingBack}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: sendingBack ? hexToRgba(palette.accentOrange.hex, 0.5) : palette.accentOrange.hex, color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650, cursor: sendingBack ? 'wait' : 'pointer' }}
                    >
                      {sendingBack ? 'Sending…' : 'Send Back'}
                    </button>
                    <button onClick={() => { setShowSendBack(false); setSendBackNote(''); setSendBackError(null); }} disabled={sendingBack} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 11.5, fontWeight: 650, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </PanelSection>
          )}

          <PanelSection title="EMR Onboarding">
            {selectedReferral.emr_initial_onboarded_at && (
              <div style={{
                borderRadius: 8,
                border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.3)}`,
                background: hexToRgba(palette.accentBlue.hex, 0.06),
                padding: '10px 11px',
                marginBottom: 10,
              }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: palette.accentBlue.hex, marginBottom: 4 }}>
                  Initial EMR already completed in Intake
                </p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5, margin: 0 }}>
                  Chart created{' '}
                  {new Date(selectedReferral.emr_initial_onboarded_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                  {selectedReferral.emr_initial_onboarded_by_id
                    ? ` by ${resolveUser?.(selectedReferral.emr_initial_onboarded_by_id) || selectedReferral.emr_initial_onboarded_by_id}`
                    : ''}
                  . Finish any remaining HCHB fields, then mark full EMR onboarded to advance to Staffing.
                </p>
              </div>
            )}
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
              {selectedReferral.emr_initial_onboarded_at
                ? 'Download the packet if needed for reference. Mark onboarded once HCHB onboarding is fully complete to advance to Staffing.'
                : 'Download the onboarding packet and enter the patient into the EMR (HCHB). Scheduling can\'t plot a SOC until the patient exists in the EMR. Mark onboarded once complete to advance to Staffing.'}
            </p>
            <EmrPacketDownloadButton
              referral={selectedReferral}
              resolveSource={resolveSource}
              resolveUser={resolveUser}
              resolveMarketer={resolveMarketer}
              onError={setPdfError}
            />
            {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}

            <div style={{ marginTop: 10 }}>
              {onboardError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{onboardError}</p>}
              <ActionBtn
                label={onboarding ? 'Saving…' : (canOnboard ? 'Mark EMR Onboarded → Staffing' : 'Onboarding handled by scheduling')}
                variant={canOnboard ? 'forward' : 'default'}
                onClick={handleMarkOnboarded}
                disabled={!canOnboard || onboarding}
              />
            </div>
          </PanelSection>

          {(alreadyOnboarded || selectedReferral.emr_initial_onboarded_at) && (
            <PanelSection title="Status">
              {selectedReferral.emr_initial_onboarded_at && (
                <InfoRow
                  label="Initial EMR"
                  value={new Date(selectedReferral.emr_initial_onboarded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  highlight={palette.accentBlue.hex}
                />
              )}
              {alreadyOnboarded && (
                <InfoRow label="EMR Onboarded" value={new Date(selectedReferral.emr_onboarded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} highlight={palette.accentGreen.hex} />
              )}
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

function StaffingPanel({ referrals, selectedReferral, allReferrals, onOpenTab, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const [clinicianMatched, setClinicianMatched] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [completingVisit, setCompletingVisit] = useState(false);
  const [visitError, setVisitError] = useState(null);

  useEffect(() => {
    setClinicianMatched(false);
    setVisitDate('');
    setCompletingVisit(false);
    setVisitError(null);
  }, [selectedReferral?._id]);

  // Rushed / urgent care path: the visit gets scheduled outside the normal
  // Pre-SOC flow, so Staffing marks it completed directly — with a
  // backdatable date since the visit already happened. completeVisit sends
  // the case back to Intake for the remaining paperwork (or Completed when
  // clinical already approved).
  async function handleRushedVisitComplete() {
    if (!selectedReferral?._id || !visitDate || completingVisit) return;
    setCompletingVisit(true);
    setVisitError(null);
    try {
      const result = await completeVisit({
        referral: selectedReferral,
        appUserId,
        completedDate: visitDate,
      });
      if (!result.ok) throw new Error(result.reason || 'Failed to mark visit completed');
      triggerDataRefresh();
      onSelectedReferralLeftModule?.();
    } catch (err) {
      setVisitError(err.message || 'Failed to mark visit completed');
    } finally {
      setCompletingVisit(false);
    }
  }

  // Stamp the staffing confirmation (clinician matched) on the referral before
  // moving to Pre-SOC, so the timeline can show it as a milestone.
  function handleStaffingConfirm() {
    if (!selectedReferral?._id) return;
    updateReferralOptimistic(selectedReferral._id, {
      staffing_confirmed_at: new Date().toISOString(),
      staffing_confirmed_by_id: appUserId || 'unknown',
    }).catch(() => {});
    onInitiateTransition?.(selectedReferral, 'Pre-SOC');
  }

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
  // Insurance Details readiness in the staffing panel mirrors intake: it
  // reflects Demographics capture, not InsuranceChecks. The subscription
  // above is retained so other surfaces that share the store stay hydrated.
  void insuranceCheckStore;

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
          <InfoRow
            label="Days in Staffing"
            value={isOnTrack
              ? `${Number.isFinite(selectedReferral._days_in_staffing) ? selectedReferral._days_in_staffing : 0}d`
              : '—'}
            highlight={isOnTrack ? palette.accentGreen.hex : undefined}
          />

          {/* On Track immediate attention banner */}
          {isOnTrack && (
            <div data-testid="on-track-banner" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 7, background: hexToRgba(palette.accentGreen.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.2)}` }}>
              <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentGreen.hex }}>
                On Track. All other steps complete. Match a clinician to confirm.
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
                onClick={() => canConfirm && handleStaffingConfirm()}
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
                {canConfirm ? 'Confirm → SOC/ROC' : 'Match a clinician to confirm'}
              </button>
            </div>
          )}

          {/* Rushed / urgent path: visit happened outside the normal Pre-SOC
              flow — mark it completed here with the (backdatable) actual date. */}
          {isOnTrack
            && (isDocumentationDeferred(selectedReferral) || isUrgentCare(selectedReferral))
            && canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE) && (
            <div data-testid="staffing-rushed-visit-complete" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: hexToRgba(palette.accentBlue.hex, 0.07), border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.2)}` }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                Rushed case — visit already done?
              </p>
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5, marginBottom: 8 }}>
                Mark the {episodeTypeLabel(selectedReferral)} visit completed with the date it actually happened.
                The case returns to Intake for the remaining paperwork.
              </p>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
                Visit date
              </label>
              <input
                type="date"
                value={visitDate}
                max={todayCalendarDate()}
                onChange={(e) => setVisitDate(e.target.value)}
                data-testid="staffing-visit-date"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, marginBottom: 8,
                  border: `1px solid ${visitDate ? palette.accentBlue.hex : 'var(--color-border)'}`,
                  fontSize: 13, fontFamily: 'inherit', outline: 'none',
                  background: palette.backgroundLight.hex, color: palette.backgroundDark.hex,
                }}
              />
              {visitError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{visitError}</p>}
              <button
                data-testid="staffing-visit-complete-btn"
                onClick={handleRushedVisitComplete}
                disabled={!visitDate || completingVisit}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 7, border: 'none',
                  background: visitDate && !completingVisit ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                  color: visitDate && !completingVisit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                  fontSize: 12.5, fontWeight: 700, cursor: visitDate && !completingVisit ? 'pointer' : 'not-allowed',
                }}
              >
                {completingVisit ? 'Saving…' : 'Mark visit completed'}
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
            <InfoRow label="Days in pipeline" value={(daysSinceCalendarDate(selectedReferral.referral_date) ?? 0) + 'd'} />
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
              <ActionBtn label="Accept → SOC/ROC" variant="forward" onClick={() => onInitiateTransition?.(selectedReferral, 'Pre-SOC')} />
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
function RescheduleSocForm({ referral, appUserId, canSchedule, onDone }) {
  const today = todayCalendarDate();
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [reasonCategory, setReasonCategory] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setOpen(false);
    setNewDate('');
    setReasonCategory('');
    setReasonDetail('');
    setError(null);
  }, [referral?._id]);

  if (!canSchedule) return null;

  async function handleSave() {
    if (!referral?._id) return;
    const detail = reasonDetail.trim();
    if (!newDate) { setError('Enter the new SOC date.'); return; }
    if (!reasonCategory) { setError('Choose a reason category.'); return; }
    if (!detail) { setError('Explain what happened (required).'); return; }
    if (newDate === String(referral.soc_scheduled_date || '').split('T')[0]) {
      setError('New date must be different from the current SOC date.');
      return;
    }

    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const previous = referral.soc_scheduled_date
      ? String(referral.soc_scheduled_date).split('T')[0]
      : null;
    const reasonLabel = SOC_RESCHEDULE_REASONS.find((r) => r.value === reasonCategory)?.label || reasonCategory;

    try {
      await createSocRescheduleLog({
        id: `socrs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        referral_id: referral.id,
        patient_id: referral.patient_id,
        previous_soc_date: previous,
        new_soc_date: newDate,
        reason_category: reasonCategory,
        reason_detail: detail,
        rescheduled_by_id: appUserId || 'unknown',
        created_at: now,
        updated_at: now,
      });

      await updateReferralOptimistic(referral._id, {
        soc_scheduled_date: newDate,
        soc_scheduled_at: now,
        soc_scheduled_by_id: appUserId || 'unknown',
        updated_at: now,
        ...(isDocumentationDeferred(referral)
          ? documentationDueFieldsForSocDate(newDate)
          : {}),
      });

      // Keep the linked episode in sync when one exists.
      try {
        const episodes = useCareStore.getState().episodes || {};
        const episode = Object.values(episodes).find((e) => {
          const link = e.referral_id;
          if (Array.isArray(link)) return link.includes(referral._id) || link.includes(referral.id);
          return link === referral._id || link === referral.id;
        });
        if (episode?._id) {
          await updateEpisode(episode._id, {
            soc_date: newDate,
            episode_start: newDate,
            updated_at: now,
          });
        }
      } catch (epErr) {
        console.warn('[Pre-SOC] episode date sync failed (non-fatal)', epErr);
      }

      createNoteOptimistic({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        patient_id: referral.patient_id,
        author_id: appUserId,
        content: `SOC rescheduled: ${fmtCalendarDate(previous) || '—'} → ${fmtCalendarDate(newDate)} · ${reasonLabel}. ${detail}`,
        created_at: now,
        updated_at: now,
        referral_id: referral.id,
      }).catch(() => {});

      setOpen(false);
      setNewDate('');
      setReasonCategory('');
      setReasonDetail('');
      triggerDataRefresh();
      onDone?.();
    } catch (err) {
      console.error('[Pre-SOC] SOC reschedule failed', err);
      setError(err?.message || `Failed to ${rescheduleVerb(referral).toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div data-testid="reschedule-soc-open">
        <ActionBtn
          label={rescheduleVerb(referral)}
          variant="warning"
          onClick={() => setOpen(true)}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="reschedule-soc-form"
      style={{
        borderRadius: 8,
        border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.35)}`,
        background: hexToRgba(palette.accentOrange.hex, 0.05),
        padding: '10px 11px',
      }}
    >
      <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 8 }}>
        {rescheduleVerb(referral)}
      </p>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 8, lineHeight: 1.45 }}>
        Current date: <strong>{fmtCalendarDate(referral.soc_scheduled_date) || '—'}</strong>
      </p>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
        New {episodeDateLabel(referral).toLowerCase()}
      </label>
      <input
        type="date"
        value={newDate}
        min={today}
        onChange={(e) => setNewDate(e.target.value)}
        data-testid="reschedule-soc-date"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, marginBottom: 8,
          border: `1px solid ${newDate ? palette.accentOrange.hex : 'var(--color-border)'}`,
          fontSize: 13, fontFamily: 'inherit', outline: 'none',
          background: palette.backgroundLight.hex, color: palette.backgroundDark.hex,
        }}
      />

      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
        Reason category
      </label>
      <select
        value={reasonCategory}
        onChange={(e) => setReasonCategory(e.target.value)}
        data-testid="reschedule-soc-reason"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, marginBottom: 8,
          border: '1px solid var(--color-border)', fontSize: 12.5, fontFamily: 'inherit',
          background: palette.backgroundLight.hex, color: palette.backgroundDark.hex,
        }}
      >
        <option value="">Select…</option>
        {SOC_RESCHEDULE_REASONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
        What happened <span style={{ color: palette.primaryMagenta.hex }}>*</span>
      </label>
      <textarea
        value={reasonDetail}
        onChange={(e) => setReasonDetail(e.target.value)}
        rows={3}
        placeholder="Required — brief explanation for the reschedule"
        data-testid="reschedule-soc-detail"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, marginBottom: 8,
          border: '1px solid var(--color-border)', fontSize: 12.5, fontFamily: 'inherit',
          background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, resize: 'vertical',
        }}
      />

      {error && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          data-testid="reschedule-soc-save"
          style={{
            flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
            background: saving ? hexToRgba(palette.accentOrange.hex, 0.5) : palette.accentOrange.hex,
            color: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 650,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save reschedule'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
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
  );
}

function PreSocPanel({ selectedReferral, resolveSource, resolveUser, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveMarketer } = useLookups();
  const actualStage = selectedReferral?.current_stage;
  const today = todayCalendarDate();

  // Concurrent membership: the SOC/ROC module also lists cases still working
  // paperwork in Intake / Clinical (EMR chart exists, visit not completed).
  // Those cases schedule + complete via flags, without moving current_stage.
  const isLegacyStage = actualStage === 'Pre-SOC' || actualStage === 'SOC Scheduled';
  const isScheduled = actualStage === 'SOC Scheduled'
    || (!isLegacyStage && !!selectedReferral?.soc_scheduled_date);

  const [socDate, setSocDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState(null);
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    setSocDate(''); setError(null); setPdfError(null); setConfirming(false); setOnboardError(null);
  }, [selectedReferral?._id]);

  async function handleSchedule() {
    if (!socDate || !selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE)) return;
    setSaving(true);
    setError(null);
    const scheduleFields = {
      soc_scheduled_date: socDate,
      soc_scheduled_at: new Date().toISOString(),
      soc_scheduled_by_id: appUserId || 'unknown',
      // 30-day paperwork clock for deferred F2F/clinical cases
      ...(isDocumentationDeferred(selectedReferral)
        ? documentationDueFieldsForSocDate(socDate)
        : {}),
    };
    const episodeEffect = {
      type: 'createEpisode',
      patientId: selectedReferral.patient_id,
      referralRecordId: selectedReferral._id,
      socDate,
    };

    try {
      if (actualStage === 'Pre-SOC') {
        // Pre-SOC -> SOC Scheduled is a sanctioned sub-state move (not a
        // user-facing graph edge), so it goes through the engine as a `system`
        // transition. The engine writes optimistically, so the panel
        // re-renders into Step 2 immediately. createEpisode rides along.
        const result = attemptTransition({
          referral: selectedReferral,
          toStage: 'SOC Scheduled',
          context: {
            system: true,
            actorUserId: appUserId,
            extraFields: scheduleFields,
            extraSideEffects: [episodeEffect],
          },
        });
        if (!result.allowed) { setError(result.reason || 'Failed to schedule SOC'); setSaving(false); return; }
        await applyTransition({ referral: selectedReferral, result, context: { actorUserId: appUserId } });
      } else {
        // Concurrent case — paperwork continues in its current stage; the
        // schedule is flags only (no stage move, no stage-history noise).
        await updateReferralOptimistic(selectedReferral._id, scheduleFields);
        await runEffects([episodeEffect], { referral: selectedReferral, actorUserId: appUserId });
        recordActivity({
          actorUserId: appUserId,
          action: 'SOC/ROC Scheduled',
          patientId: selectedReferral.patient_id,
          referralId: selectedReferral.id,
          detail: `Visit scheduled for ${socDate} (concurrent with ${actualStage})`,
        }).catch(() => {});
      }
      triggerDataRefresh();
    } catch (err) {
      setError(err.message || 'Failed to schedule SOC');
    } finally {
      // Always release the spinner — previously this only fired in catch, so a
      // successful schedule left the button stuck in "Scheduling…" until a refresh.
      setSaving(false);
    }
  }

  async function handleOnboarded() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE)) return;
    setOnboarding(true); setOnboardError(null);
    let succeeded = false;
    const completedDate = todayCalendarDate();
    const patientName = selectedReferral.patientName || 'Patient';
    // completeVisit stamps soc_completed_date and routes: paperwork done →
    // Completed; paperwork open → the case keeps working in Intake (stamp
    // only when already on an Intake-side stage).
    try {
      const result = await completeVisit({ referral: selectedReferral, appUserId, completedDate });
      if (!result.ok) throw new Error(result.reason || 'Failed');
      triggerDataRefresh();
      succeeded = true;
    } catch (err) {
      setOnboardError(err.message || 'Failed');
    } finally {
      // Always release the spinner. Without this, a successful save left the
      // button stuck in "Saving…" until a manual refresh.
      setOnboarding(false);
      if (!succeeded) setConfirming(false);
    }
    if (succeeded) {
      setConfirming(false);
      // Celebration first (portal), then clear selection — modal state lives on
      // this panel so it survives the patient leaving the Pre-SOC queue.
      setCelebration({ patientName, completedDate });
      onSelectedReferralLeftModule?.();
    }
  }

  // Step indicator. EMR onboarding is no longer a step here — it's an Intake
  // milestone and a precondition for scheduling, surfaced as a status line.
  const epLabel = episodeTypeLabel(selectedReferral);
  const steps = [
    { key: 'schedule', label: `${epLabel} Scheduled`, done: isScheduled || actualStage === 'SOC Completed' || !!selectedReferral?.soc_completed_date },
    { key: 'complete', label: `${epLabel} Completed`, done: actualStage === 'SOC Completed' || !!selectedReferral?.soc_completed_date },
  ];

  const emrInitialAt = selectedReferral?.emr_initial_onboarded_at;
  const emrFullAt = selectedReferral?.emr_onboarded_at;
  const emrDone = !!(emrInitialAt || emrFullAt);

  const socDateDisplay = fmtCalendarDate(selectedReferral?.soc_scheduled_date);

  return (
    <Panel>
      {celebration && (
        <SocCompletedCelebration
          patientName={celebration.patientName}
          completedDate={celebration.completedDate}
          episodeType={epLabel}
          onClose={() => setCelebration(null)}
        />
      )}
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Patient">
            <InfoRow label="Name" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="DB Stage" value={actualStage} />
          </PanelSection>

          {/* EMR onboarding is a precondition for scheduling — show it as a
              status line, not a step. */}
          <PanelSection title="EMR Onboarding">
            {emrDone ? (
              <div
                title={emrFullAt
                  ? `Fully onboarded ${fmtCalendarDate(emrFullAt.slice(0, 10)) || ''}`
                  : `Initial chart created ${fmtCalendarDate(emrInitialAt.slice(0, 10)) || ''}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  borderRadius: 999, padding: '4px 11px',
                  background: emrFullAt ? '#E5F3E4' : hexToRgba(palette.highlightYellow.hex, 0.16),
                  fontSize: 11.5, fontWeight: 700,
                  color: emrFullAt ? '#2F6B2A' : '#7A5F00',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5.5" fill={emrFullAt ? '#2F6B2A' : '#B08900'} />
                  <path d="M3.5 6l2 2 3-3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {emrFullAt ? 'EMR onboarded' : 'Initial EMR done'}
              </div>
            ) : (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: 0, lineHeight: 1.5 }}>
                Not yet in the EMR — Intake creates the HCHB chart before a visit can be scheduled.
              </p>
            )}
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

          {/* Step 1: Schedule SOC — legacy Pre-SOC stage cases AND concurrent
              cases (still in Intake/Clinical) that have no scheduled date yet.
              The packet stays downloadable here as a reference copy. */}
          {(actualStage === 'Pre-SOC' || (!isLegacyStage && !isScheduled)) && (
            <PanelSection title={`Step 1: ${scheduleVerb(selectedReferral)}`}>
              <div style={{ marginBottom: 8 }}>
                <EpisodeTypeBadge referral={selectedReferral} size="tiny" />
              </div>
              <EmrPacketDownloadButton
              referral={selectedReferral}
              resolveSource={resolveSource}
              resolveUser={resolveUser}
              resolveMarketer={resolveMarketer}
              onError={setPdfError}
            />
              {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}

              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5 }}>{episodeDateLabel(selectedReferral)}</p>
                <input type="date" value={socDate} min={today} onChange={(e) => setSocDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7, border: `1px solid ${socDate ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, marginBottom: 8 }} />
                {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{error}</p>}
                <ActionBtn label={saving ? 'Scheduling…' : `${scheduleVerb(selectedReferral)} →`} variant="forward" onClick={handleSchedule} disabled={!socDate || saving} />
              </div>
            </PanelSection>
          )}

          {/* Step B+C: Scheduled → Complete — legacy SOC Scheduled stage cases
              AND concurrent cases with a scheduled date. Marking completed
              stamps soc_completed_date, which removes the case from this
              module (post-visit paperwork continues in Intake). */}
          {(actualStage === 'SOC Scheduled' || (!isLegacyStage && isScheduled)) && (
            <PanelSection title={`Step 2: ${epLabel} Scheduled`}>
              <div style={{ marginBottom: 8 }}>
                <EpisodeTypeBadge referral={selectedReferral} size="tiny" />
              </div>
              {socDateDisplay && <InfoRow label="Scheduled for" value={socDateDisplay} highlight={palette.accentGreen.hex} />}

              <div style={{ marginTop: 10 }}>
                <EmrPacketDownloadButton
              referral={selectedReferral}
              resolveSource={resolveSource}
              resolveUser={resolveUser}
              resolveMarketer={resolveMarketer}
              onError={setPdfError}
            />
                {pdfError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{pdfError}</p>}
              </div>

              <div style={{ marginTop: 10 }}>
                {!confirming ? (
                  <ActionBtn label={`${markCompletedVerb(selectedReferral)} →`} variant="forward" onClick={() => setConfirming(true)} />
                ) : (
                  <div style={{ borderRadius: 8, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`, background: hexToRgba(palette.accentGreen.hex, 0.05), padding: '10px 11px' }}>
                    <p style={{ fontSize: 11.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4, lineHeight: 1.5 }}>{confirmCompletionVerb(selectedReferral)}</p>
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
                      Confirm <strong>{selectedReferral.patientName}</strong> {isRoc(selectedReferral) ? 'ROC' : 'SOC'} is done.
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

              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>
                <RescheduleSocForm
                  referral={selectedReferral}
                  appUserId={appUserId}
                  canSchedule={canPerm(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE)}
                />
                <ActionBtn label="Place on Hold" variant="default" onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')} />
              </div>
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

// ── 12. SOC Scheduled ─────────────────────────────────────────────────────────
function SocScheduledPanel({ selectedReferral, resolveSource, resolveUser, onInitiateTransition, onSelectedReferralLeftModule }) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolveMarketer } = useLookups();
  const [pdfError, setPdfError]           = useState(null);
  const [confirming, setConfirming]       = useState(false);
  const [onboarding, setOnboarding]       = useState(false);
  const [onboardError, setOnboardError]   = useState(null);
  const [celebration, setCelebration]     = useState(null);

  // Reset state when patient changes
  useEffect(() => {
    setConfirming(false);
    setOnboardError(null);
    setPdfError(null);
  }, [selectedReferral?._id]);

  async function handleOnboarded() {
    if (!selectedReferral || !canPerm(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE)) return;
    setOnboarding(true);
    setOnboardError(null);
    let succeeded = false;
    const completedDate = todayCalendarDate();
    const patientName = selectedReferral.patientName || 'Patient';
    try {
      const result = await completeVisit({ referral: selectedReferral, appUserId, completedDate });
      if (!result.ok) throw new Error(result.reason || 'Failed to update patient');
      triggerDataRefresh();
      succeeded = true;
    } catch (err) {
      setOnboardError(err.message || 'Failed to update patient');
    } finally {
      // Always release the spinner — previously this only fired in catch, so a
      // successful save left the button stuck in "Saving…" with a spinner
      // until a manual refresh.
      setOnboarding(false);
      if (!succeeded) setConfirming(false);
    }
    if (succeeded) {
      setConfirming(false);
      setCelebration({ patientName, completedDate });
      onSelectedReferralLeftModule?.();
    }
  }

  const socDateDisplay = fmtCalendarDate(selectedReferral?.soc_scheduled_date) || '—';

  return (
    <Panel>
      {celebration && (
        <SocCompletedCelebration
          patientName={celebration.patientName}
          completedDate={celebration.completedDate}
          onClose={() => setCelebration(null)}
        />
      )}
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="SOC Details">
            <InfoRow label="Scheduled date" value={socDateDisplay} />
            <InfoRow label="Patient"        value={selectedReferral.patientName} />
            <InfoRow label="Division"       value={selectedReferral.division} />
          </PanelSection>

          <PanelSection title="Actions">

            <EmrPacketDownloadButton
              referral={selectedReferral}
              resolveSource={resolveSource}
              resolveUser={resolveUser}
              resolveMarketer={resolveMarketer}
              onError={setPdfError}
            />
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
                  {confirmCompletionVerb(selectedReferral)}
                </p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, marginBottom: 10 }}>
                  Confirm <strong>{selectedReferral.patientName}</strong> {episodeTypeLongLabel(selectedReferral)} is done.
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

            <RescheduleSocForm
              referral={selectedReferral}
              appUserId={appUserId}
              canSchedule={canPerm(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE)}
            />
            <ActionBtn
              label="Place on Hold"
              variant="default"
              onClick={() => onInitiateTransition?.(selectedReferral, 'Hold')}
            />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 13. SOC Completed ─────────────────────────────────────────────────────────
function SocCompletedPanel({ referrals, selectedReferral, onOpenTab }) {
  const { can: canPerm } = usePermissions();
  const canRequestClinical = canPerm(PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG)
    || canPerm(PERMISSION_KEYS.MODULE_SCHEDULING);
  const hchbDone = referrals.filter((r) => r.hchb_entered === true || r.hchb_entered === 'true').length;
  const inClinical = selectedReferral
    && (selectedReferral.in_clinical_review === true || selectedReferral.in_clinical_review === 'true'
      || selectedReferral.current_stage === 'Clinical Intake RN Review');
  const postSocWork = selectedReferral
    && selectedReferral.soc_completed_date
    && selectedReferral.current_stage
    && selectedReferral.current_stage !== 'SOC Completed';
  const docsDeferred = isDocumentationDeferred(selectedReferral);
  return (
    <Panel>
      <PanelSection title="HCHB Entry Status">
        <InfoRow label="Entered in HCHB" value={hchbDone} highlight={palette.accentGreen.hex} />
        <InfoRow label="Pending HCHB entry" value={referrals.length - hchbDone} highlight={referrals.length - hchbDone > 0 ? palette.accentOrange.hex : null} />
      </PanelSection>
      {selectedReferral && docsDeferred && (
        <PanelSection title="Post-SOC documentation">
          <DocumentationCompleteAction
            referral={selectedReferral}
            source="soc_completed_panel"
            onOpenF2F={() => onOpenTab?.(selectedReferral, 'f2f')}
            onOpenClinical={() => onOpenTab?.(selectedReferral, 'clinical_review')}
          />
        </PanelSection>
      )}
      {selectedReferral && canRequestClinical && (
        <PanelSection title="Clinical handoff">
          <RequestClinicalReviewAction referral={selectedReferral} />
        </PanelSection>
      )}
      {selectedReferral && !docsDeferred && selectedReferral.documentation_cleared_at && (
        <PanelSection title="Post-SOC documentation">
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 650, color: palette.accentGreen.hex }}>
            Documentation complete
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            Cleared {fmtCalendarDate(selectedReferral.documentation_cleared_at)}. Case remains on SOC/ROC Completed.
          </p>
        </PanelSection>
      )}
      {(inClinical || postSocWork) && (
        <PanelSection title="Also in pipeline">
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.55, margin: 0 }}>
            {inClinical
              ? 'In Clinical Review for post-SOC paperwork. Stays counted here until clinical is marked complete.'
              : <>Current work stage: <strong style={{ color: palette.backgroundDark.hex }}>{selectedReferral.current_stage}</strong></>}
          </p>
        </PanelSection>
      )}
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
    r.hold_expected_resolution && daysUntilCalendarDate(r.hold_expected_resolution) < 0
  ).length;

  const isOverdue = selectedReferral?.hold_expected_resolution &&
    daysUntilCalendarDate(selectedReferral.hold_expected_resolution) < 0;

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
                ? fmtCalendarDate(selectedReferral.hold_expected_resolution)
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
        referral_date:         r.referral_date ? fmtCalendarDate(r.referral_date, '') : '',
        services_requested:    Array.isArray(r.services_requested)
          ? r.services_requested.join(', ')
          : (r.services_requested || ''),
        current_stage:         r.current_stage || '',
      }));
      await exportToExcel(rows, columns, 'NTUC Report', `${referrals.length} records · exported ${new Date().toLocaleDateString()}`);
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
  const { can: canPerm } = usePermissions();
  const props = { referrals, allReferrals, selectedReferral, resolveUser, resolveSource, onNewReferral, onOpenTriage, onOpenFiles, onOpenEligibility, onOpenTab, onInitiateTransition, onSelectedReferralLeftModule };

  // Lead Entry has its own discard control; Discarded Leads is the destination.
  const showDiscardAny = canPerm(PERMISSION_KEYS.REFERRAL_DISCARD_ANY)
    && !!selectedReferral
    && stage !== 'Discarded Leads'
    && stage !== 'Lead Entry'
    && selectedReferral.current_stage !== 'Discarded Leads';

  const footer = showDiscardAny ? (
    <DiscardAnyPanelSection
      referral={selectedReferral}
      onDone={onSelectedReferralLeftModule}
    />
  ) : null;

  let panel = null;
  switch (stage) {
    case 'Lead Entry':                panel = <LeadEntryPanel {...props} />; break;
    case 'Discarded Leads':           panel = <DiscardedLeadsPanel {...props} />; break;
    case 'Intake':                    panel = <IntakePanel {...props} />; break;
    case 'Eligibility Verification':  panel = <EligibilityPanel {...props} />; break;
    case 'Disenrollment Required':    panel = <DisenrollmentPanel {...props} />; break;
    case 'F2F/MD Orders Pending':     panel = <F2FPanel {...props} />; break;
    case 'Clinical Intake RN Review':
      panel = isClinicalLeadPreCheck(selectedReferral)
        ? <ClinicalLeadPreCheckPanel {...props} />
        : <ClinicalRNPanel {...props} />;
      break;
    case 'Authorization Pending':     panel = <AuthorizationPanel {...props} />; break;
    case 'Conflict':                  panel = <ConflictPanel {...props} />; break;
    case 'EMR Onboarding':            panel = <EmrOnboardingPanel {...props} />; break;
    case 'Staffing Feasibility':      panel = <StaffingPanel {...props} />; break;
    case 'Admin Confirmation':        panel = <AdminConfirmationPanel {...props} />; break;
    case 'Pre-SOC':                   panel = <PreSocPanel {...props} />; break;
    case 'SOC Scheduled':             panel = <SocScheduledPanel {...props} />; break;
    case 'SOC Completed':             panel = <SocCompletedPanel {...props} />; break;
    case 'Completed':                 panel = <SocCompletedPanel {...props} />; break;
    case 'Hold':                      panel = <HoldPanel {...props} />; break;
    case 'NTUC':                      panel = <NtucPanel {...props} />; break;
    case 'OPWDD Enrollment':          panel = <OPWDDEnrollmentPanel {...props} />; break;
    default: return null;
  }

  return (
    <PanelFooterContext.Provider value={footer}>
      {panel}
    </PanelFooterContext.Provider>
  );
}
