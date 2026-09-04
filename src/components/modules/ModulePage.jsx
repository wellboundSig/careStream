import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useLocation, Link } from 'react-router-dom';
import { usePipelineData } from '../../hooks/usePipelineData.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import { STAGE_META, isSocCompletedReferral, isPostVisitReferral, isActiveClinicalHandoff } from '../../data/stageConfig.js';
import { isClinicalLeadPreCheck, isClinicalLeadPreCheckApproved } from '../../utils/clinicalLeadPreCheck.js';
import { isPendingLogReferral, pendingLogMentionIndex } from '../../utils/pendingLog.js';
import { canMoveFromTo, needsModal } from '../../utils/stageTransitions.js';
import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { flagConflict, inferConflictSourceModuleFromStage } from '../../utils/conflictFlagging.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS, canPerformClinicalRnReview } from '../../data/permissionKeys.js';
import {
  moduleColumnDefsForStage,
  SOC_COMPLETED_PENDING_LOG_COLUMN_DEFS,
  useColumnVisibility,
  useColumnFilters,
  ColumnPicker,
  ColumnFilterButton,
  FilterIcon,
  ColsIcon,
} from '../../utils/columnModel.jsx';
import { cellMatchesFilter, filterIsActive, matchesNumericFilter, matchesYesNoFilter, selectedFilterValues } from '../../utils/columnFilters.js';
import { usePreferences } from '../../context/UserPreferencesContext.jsx';
import { useLockedTableGrid } from '../../hooks/useLockedTableGrid.js';
import { useFlipWindow } from '../../hooks/useFlipWindow.js';
import { lockedGridClass } from '../../utils/tableScrollMode.js';
import FlipScrollBar from '../common/FlipScrollBar.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import EpisodeTypeBadge from '../common/EpisodeTypeBadge.jsx';
import StageBadge, { displayStageName } from '../common/StageBadge.jsx';
import LoadingState from '../common/LoadingState.jsx';
import AccessDenied from '../common/AccessDenied.jsx';
import HoverInfoCard from '../common/HoverInfoCard.jsx';
import EmptyState from '../common/EmptyState.jsx';
import UrgentCareIcon from '../common/UrgentCareIcon.jsx';
import AuthObtainedIcon from '../common/AuthObtainedIcon.jsx';
import OwnedByMeIcon from '../common/OwnedByMeIcon.jsx';
import ClinicalPreCheckApprovedIcon from '../common/ClinicalPreCheckApprovedIcon.jsx';
import OooBadge from '../common/OooBadge.jsx';
import ClinicalReviewByline from '../common/ClinicalReviewByline.jsx';
import { useClinicalReviewInProgress } from '../../hooks/useClinicalReviewInProgress.js';
import StagePanel from './StagePanel.jsx';
import DuplicateChecker from './DuplicateChecker.jsx';
import NewReferralForm from '../forms/NewReferralForm.jsx';
import ReferralDraftsPanel, { countReferralDrafts } from '../forms/ReferralDraftsPanel.jsx';
import TransitionModal from '../pipeline/TransitionModal.jsx';
import {
  setUrgentCare,
  setUrgentCareType,
  isUrgentCare,
  getUrgentCareType,
  getUrgentCareTypes,
  urgentCareTypeLabel,
  urgentCareTypeBg,
  urgentCareTypeColor,
  URGENT_CARE_TYPE_OPTIONS,
} from '../../utils/urgentCare.js';
import UrgentCareTypePicker from '../common/UrgentCareTypePicker.jsx';
// Legacy deferred-docs helpers — only the hidden Visit Completed pending-log
// columns still reference them; nothing in the live modules renders the
// deprecated post-SOC docs machinery anymore.
import {
  isDocumentationDeferred,
  getDocumentationClearChecklist,
} from '../../utils/documentationDeferred.js';
import { normalizeEpisodeType, episodeTypeLabel, episodeTypeLongLabel } from '../../utils/episodeType.js';
import {
  TRIAGE_FILTER_OPTIONS,
  buildTriagePresenceMap,
  matchesTriageFilter,
  triageColumnLabel,
} from '../../utils/triageColumn.js';
import ChangeIntakeOwnerModal from '../referrals/ChangeIntakeOwnerModal.jsx';
import DiscardReferralModal from '../common/DiscardReferralModal.jsx';
import MobileSocQueue from '../mobile/MobileSocQueue.jsx';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { discardReferral } from '../../utils/discardReferral.js';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import palette, { hexToRgba, hexOnWhite } from '../../utils/colors.js';
import { fmtCalendarDate, daysUntilCalendarDate, parseCalendarDate } from '../../utils/dateFormat.js';

/** Uniform queue row height — every module table row is this tall. */
const QUEUE_ROW_HEIGHT = 48;
const QUEUE_HEADER_HEIGHT = 40;
const FREEZE_PATIENT_KEY = 'wb.moduleFreezePatient';

function readFreezePatientPref() {
  try {
    const v = localStorage.getItem(FREEZE_PATIENT_KEY);
    if (v === null) return true;
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

/** Opaque sticky surfaces — translucent fills let scrolling rows bleed through. */
const QUEUE_STICKY_HEADER_BG = palette.backgroundLight.hex;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Read the pre-computed metric set by usePipelineData (single source of
// truth — see src/utils/referralMetrics.js). Falls back to 0 when missing
// so sort comparisons still behave.
function daysInStage(referral) {
  const v = referral?._days_in_stage;
  return Number.isFinite(v) ? v : 0;
}

function daysInPipeline(referral) {
  const v = referral?._days_in_pipeline;
  return Number.isFinite(v) ? v : 0;
}

function daysInReview(referral) {
  const v = referral?._days_in_clinical;
  return Number.isFinite(v) ? v : null;
}

function daysInStaffing(referral) {
  const v = referral?._days_in_staffing;
  return Number.isFinite(v) ? v : null;
}

/** Stage + assigned / in-review handoffs (excludes deferred-only holds). */
function isActiveClinicalQueueRow(r) {
  return isActiveClinicalHandoff(r) || isClinicalLeadPreCheck(r);
}

function queueRowWash(referral, { isSelected, hovered }) {
  if (isSelected) return hexToRgba(palette.primaryMagenta.hex, 0.06);
  const preCheck = isClinicalLeadPreCheck(referral);
  const postVisit = isPostVisitReferral(referral);
  if (hovered) {
    if (postVisit) return hexToRgba(palette.accentBlue.hex, 0.19);
    if (preCheck) return hexToRgba(palette.primaryDeepPlum.hex, 0.13);
    return hexToRgba(palette.primaryDeepPlum.hex, 0.03);
  }
  if (postVisit) return hexToRgba(palette.accentBlue.hex, 0.14);
  if (preCheck) return hexToRgba(palette.primaryDeepPlum.hex, 0.08);
  return 'transparent';
}

/** Prefer open assignee; otherwise completed-by stamp. */
function resolveClinicalRnLabel(referral, resolveUser) {
  if (referral?.clinical_review_assigned_to_id && !referral?.clinical_review_completed_at) {
    return resolveUser(referral.clinical_review_assigned_to_id) || '';
  }
  return resolveUser(referral?.clinical_review_completed_by_id || referral?.clinical_review_by) || '';
}

function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function F2FCountdown({ referral }) {
  if (!referral?.f2f_expiration) {
    return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>;
  }
  const days = daysUntilCalendarDate(referral.f2f_expiration);
  const color = days < 0 ? palette.primaryMagenta.hex
    : days <= 7  ? palette.primaryMagenta.hex
    : days <= 14 ? palette.accentOrange.hex
    : days <= 30 ? '#7A5F00'
    : palette.accentGreen.hex;
  const label = days < 0 ? `Exp ${Math.abs(days)}d` : `${days}d`;
  return (
    <span title={`F2F expires ${fmtCalendarDate(referral.f2f_expiration, '')}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: days <= 14 ? 650 : 500, color }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {days < 0 ? 'Expired' : label}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ModulePage({ stage }) {
  const { division } = useOutletContext();
  const location = useLocation();
  const { data: allReferrals, loading, refetch } = usePipelineData();
  const {
    resolveUser,
    resolveMarketer,
    resolveSource,
    resolveFacility,
    resolvePhysician,
    resolveEntity = (id) => id || '—',
    resolveSourceEntity = () => '—',
  } = useLookups();
  const { open: openPatient, isOpen: isPatientDrawerOpen } = usePatientDrawer();
  const { appUser, appUserId } = useCurrentAppUser();
  const { can: canPerm, canAny: canPermAny, hasDivision } = usePermissions();
  const { prefs, save: savePrefs } = usePreferences();
  const getReviewInProgress = useClinicalReviewInProgress();
  const isMobile = useIsMobile();

  // We track which referral the user clicked by its store row key (rec_id) and
  // DERIVE the live referral object from `allReferrals` on every render. The
  // right-hand panel + toolbar previously held a snapshot from click-time,
  // which meant any in-flight optimistic update to the store (Schedule SOC,
  // Mark Complete, etc.) didn't reach the panel until a manual refresh.
  // Tracking by id makes the selection automatically reflect the latest data.
  const [selectedReferralId, setSelectedReferralId] = useState(() => location.state?.selectReferralId || null);

  useEffect(() => {
    const id = location.state?.selectReferralId;
    if (!id) return;
    setSelectedReferralId(id);
    requestAnimationFrame(() => {
      document.querySelector(`[data-queue-row="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [location.state?.selectReferralId]);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days');
  const [sortDir, setSortDir] = useState('desc');
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [activeDraft, setActiveDraft] = useState(null);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [changeOwnerTarget, setChangeOwnerTarget] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  const canChangeIntakeOwner = canPerm(PERMISSION_KEYS.LEADS_CHANGE_INTAKE_OWNER);
  const canDiscardAny = canPerm(PERMISSION_KEYS.REFERRAL_DISCARD_ANY);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [toast, setToast] = useState(null);
  const [showColPicker, setShowColPicker] = useState(false);
  const lockedGrid = useLockedTableGrid();
  const [pinPatientCol, setFreezePatientCol] = useState(readFreezePatientPref);
  const freezePatientCol = pinPatientCol;
  const colPickerRef = useRef(null);

  const isSocCompleted = stage === 'SOC Completed';
  const isClinicalRnModule = stage === 'Clinical Intake RN Review';
  const isStaffingModule = stage === 'Staffing Feasibility';
  // Clinical queue: default to patients actually in this stage. Deferred-docs /
  // concurrent cases from other stages stay available behind an explicit toggle.
  const [includeDeferredClinical, setIncludeDeferredClinical] = useState(false);
  const canPendingLog = isSocCompleted && canPerm(PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG);
  const canPendingLogDefault = canPendingLog && canPerm(PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG_DEFAULT);
  const savedSocView = prefs?.socCompletedView;
  const socCompletedView = !canPendingLog
    ? 'standard'
    : (savedSocView === 'pending_log' || savedSocView === 'standard')
      ? savedSocView
      : (canPendingLogDefault ? 'pending_log' : 'standard');
  const isPendingLogView = canPendingLog && socCompletedView === 'pending_log';
  const columnDefs = isPendingLogView ? SOC_COMPLETED_PENDING_LOG_COLUMN_DEFS : moduleColumnDefsForStage(stage);

  const { visibleCols, setVisibleCols, activeColumns } = useColumnVisibility(columnDefs);

  function setFreezePatient(next) {
    setFreezePatientCol(next);
    try { localStorage.setItem(FREEZE_PATIENT_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }
  const { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters } = useColumnFilters(columnDefs);

  function toggleSocCompletedView() {
    if (!canPendingLog) return;
    const next = isPendingLogView ? 'standard' : 'pending_log';
    savePrefs({ socCompletedView: next });
    setSortField(next === 'pending_log' ? 'added_to_module' : 'days');
    setSortDir('desc');
  }

  const meta = STAGE_META[stage] || {};

  // Live selectedReferral — looked up from `allReferrals` every render so the
  // panel reflects optimistic store updates instantly. Falls back to null if
  // the patient is no longer in the pipeline (e.g. deleted), which collapses
  // the right panel to its empty state.
  const selectedReferral = useMemo(() => {
    if (!selectedReferralId) return null;
    return allReferrals.find((r) => r._id === selectedReferralId) || null;
  }, [allReferrals, selectedReferralId]);

  useEffect(() => {
    setSelectedReferralId(null);
    setSearch('');
    clearFilters();
    setShowDraftsPanel(false);
  }, [stage]);

  const refreshDraftCount = useCallback(async () => {
    if (stage !== 'Lead Entry' || !appUserId) {
      setDraftCount(0);
      return;
    }
    try {
      setDraftCount(await countReferralDrafts(appUserId));
    } catch {
      setDraftCount(0);
    }
  }, [stage, appUserId]);

  useEffect(() => {
    refreshDraftCount();
  }, [refreshDraftCount]);

  // ── Stage referrals with column filters ───────────────────────────────────
  // Decorate each referral with concurrent-presence flags so the per-stage
  // matchReferral predicate (see STAGE_META) can read them without having to
  // import the auth/disen stores itself. Auth rows use referral business id
  // (text "ref_xxx"); disenrollment flags may key by business id or row key,
  // so we match on both shapes.
  const authStore = useCareStore((s) => s.authorizations) || {};
  const disenStore = useCareStore((s) => s.disenrollmentAssistanceFlags) || {};
  const storeUsers = useCareStore((s) => s.users) || {};
  const storeNotes = useCareStore((s) => s.notes) || {};
  const mentionIndex = useMemo(() => pendingLogMentionIndex(storeNotes), [storeNotes]);
  const isMobilePendingLog = isMobile && stage === 'Completed';
  const decoratedReferrals = useMemo(() => {
    if (!allReferrals?.length) return allReferrals || [];
    // Pending-ish statuses always qualify. Rows with a request stamp also stay
    // in Auth Pending after a response is recorded — until Authorization Obtained.
    const ACTIVE_AUTH = new Set(['nar', 'pending', 'follow_up_needed']);
    const OPEN_DISEN = new Set(['open', 'in_review']);
    const refIdsWithAuth = new Set();
    Object.values(authStore).forEach((a) => {
      if (!a?.referral_id) return;
      const status = (a.auth_status || a.status || '').toString().toLowerCase();
      const requested = !!(a.request_initial_date || a.requested_by_user_id);
      if (ACTIVE_AUTH.has(status) || requested) refIdsWithAuth.add(a.referral_id);
    });
    const refRecIdsWithDisen = new Set();
    const refCustomIdsWithDisen = new Set();
    Object.values(disenStore).forEach((d) => {
      if (!d?.referral_id) return;
      if (!OPEN_DISEN.has(d.status)) return;
      const link = d.referral_id;
      if (Array.isArray(link)) link.forEach((id) => refRecIdsWithDisen.add(id));
      else refCustomIdsWithDisen.add(link);
    });
    return allReferrals.map((r) => ({
      ...r,
      _hasActiveAuthorization: refIdsWithAuth.has(r.id) && !r.auth_obtained_at,
      _hasOpenDisenrollmentFlag: refRecIdsWithDisen.has(r._id) || refCustomIdsWithDisen.has(r.id),
    }));
  }, [allReferrals, authStore, disenStore]);

  const triageAdultStore = useCareStore((s) => s.triageAdult);
  const triagePedStore = useCareStore((s) => s.triagePediatric);

  /**
   * referral business id → doctor display name.
   * Prefer triage PCP (Special Needs); fall back to referral.physician_id
   * (ALF / referring physician — what most SOC Completed rows actually have).
   */
  const pcpByReferralId = useMemo(() => {
    const map = {};
    for (const t of Object.values(triageAdultStore || {})) {
      if (t?.referral_id && t.pcp_name) map[t.referral_id] = String(t.pcp_name).trim();
    }
    for (const t of Object.values(triagePedStore || {})) {
      if (t?.referral_id && t.pcp_name) map[t.referral_id] = String(t.pcp_name).trim();
    }
    return map;
  }, [triageAdultStore, triagePedStore]);

  const triagePresence = useMemo(
    () => buildTriagePresenceMap(triageAdultStore, triagePedStore),
    [triageAdultStore, triagePedStore]
  );

  function resolvePcpName(referral) {
    const fromTriage = referral?.id ? pcpByReferralId[referral.id] : '';
    if (fromTriage) return fromTriage;
    const fromPhysician = resolvePhysician?.(referral?.physician_id);
    return fromPhysician && fromPhysician !== '—' ? fromPhysician : '';
  }

  const stageReferrals = useMemo(() => {
    // Prefer the modern predicate when present; fall back to the legacy
    // consolidatedStages array, then to a plain stage-equality check.
    const predicate = typeof meta.matchReferral === 'function'
      ? meta.matchReferral
      : meta.consolidatedStages
        ? (r) => meta.consolidatedStages.includes(r.current_stage)
        : (r) => r.current_stage === stage;
    let list = isMobilePendingLog
      ? decoratedReferrals.filter((r) => isPendingLogReferral(r, mentionIndex))
      : decoratedReferrals.filter(predicate);
    // Clinical default: stage + active concurrent handoffs (in_clinical_review /
    // assigned). Older deferred-only rows stay behind the Deferred toggle.
    if (isClinicalRnModule && !includeDeferredClinical) {
      list = list.filter(isActiveClinicalQueueRow);
    }
    // Never show a division the user cannot access (also covers stale "All"
    // selection before the sidebar default has been coerced).
    list = list.filter((r) => {
      if (r.division === 'ALF') return hasDivision('ALF');
      if (r.division === 'Special Needs') return hasDivision('Special Needs');
      return true;
    });
    if (division !== 'All') list = list.filter((r) => r.division === division);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.patientName || '').toLowerCase().includes(q) ||
          (r.patient_id || '').toLowerCase().includes(q)
      );
    }

    // Per-column filters (multi-select: match any checked value)
    for (const [key, val] of Object.entries(colFilters)) {
      if (!filterIsActive(val)) continue;
      const selected = selectedFilterValues(val);

      if (key === 'days_in_stage' || key === 'days_in_pipeline' || key === 'days_in_review') {
        list = list.filter((r) => {
          const d = key === 'days_in_pipeline'
            ? daysInPipeline(r)
            : key === 'days_in_review'
              ? daysInReview(r)
              : isStaffingModule
                ? daysInStaffing(r)
                : daysInStage(r);
          return matchesNumericFilter(d, val);
        });
        continue;
      }

      list = list.filter((r) => {
        if (key === 'urgent') return matchesYesNoFilter(isUrgentCare(r), val);
        if (key === 'urgent_care_type') {
          const types = getUrgentCareTypes(r);
          const label = urgentCareTypeLabel(types);
          const raw = types.join(' ');
          return selected.some((s) => cellMatchesFilter(label, [s]) || cellMatchesFilter(raw, [s]));
        }
        if (key === 'emr_onboarded') {
          return matchesYesNoFilter(!!(r.emr_onboarded_at || r.emr_initial_onboarded_at), val);
        }
        if (key === 'soc_completed_date') return matchesYesNoFilter(isSocCompletedReferral(r), val);
        if (key === 'soc_scheduled_date') return matchesYesNoFilter(!!r.soc_scheduled_date, val);
        if (key === 'waiting_docs') return matchesYesNoFilter(isDocumentationDeferred(r), val);
        if (key === 'triage') {
          const label = triageColumnLabel(r, !!(r?.id && triagePresence[r.id]));
          return matchesTriageFilter(label, val);
        }
        if (key === 'episode_type') {
          const et = normalizeEpisodeType(r);
          const long = episodeTypeLongLabel(r);
          return selected.some((s) => {
            const v = s.toLowerCase();
            if (v === 'soc' || v === 's' || v.includes('start')) return et === 'soc';
            if (v === 'roc' || v === 'r' || v.includes('resum')) return et === 'roc';
            return cellMatchesFilter(long, [s]) || cellMatchesFilter(et, [s]);
          });
        }
        let cellVal = '';
        switch (key) {
          case 'division': cellVal = r.division || ''; break;
          case 'stage': cellVal = r.current_stage || ''; break;
          case 'episode_type': cellVal = episodeTypeLongLabel(r); break;
          case 'licence': cellVal = resolveEntity(r.entity_id) || ''; break;
          case 'source': cellVal = resolveSource(r.referral_source_id) || ''; break;
          case 'source_entity': cellVal = resolveSourceEntity(r.referral_source_id) || ''; break;
          case 'marketer': cellVal = resolveMarketer(r.marketer_id) || ''; break;
          case 'owner': cellVal = resolveUser(r.intake_owner_id) || ''; break;
          case 'insurance': cellVal = r.patient?.insurance_plan || ''; break;
          case 'facility': cellVal = resolveFacility(r.facility_id) || ''; break;
          case 'pcp': cellVal = resolvePcpName(r) || ''; break;
          case 'clinical_rn': cellVal = resolveClinicalRnLabel(r, resolveUser) || ''; break;
          default: return true;
        }
        return cellMatchesFilter(cellVal, val);
      });
    }

    return [...list].sort((a, b) => {
      if (sortField === 'days_in_stage' || sortField === 'days' || sortField === 'days_in_review') {
        const reviewFirst = isClinicalRnModule && sortField === 'days';
        const pick = (r) => {
          if (sortField === 'days_in_review' || reviewFirst) return daysInReview(r) ?? daysInStage(r);
          if (isStaffingModule) return daysInStaffing(r) ?? -1;
          return daysInStage(r);
        };
        const va = pick(a);
        const vb = pick(b);
        return sortDir === 'desc' ? vb - va : va - vb;
      }
      if (sortField === 'days_in_pipeline') {
        const va = daysInPipeline(a);
        const vb = daysInPipeline(b);
        return sortDir === 'desc' ? vb - va : va - vb;
      }
      if (sortField === 'added_to_module') {
        const va = new Date(a._stage_entered_at || a.soc_completed_date || 0).getTime();
        const vb = new Date(b._stage_entered_at || b.soc_completed_date || 0).getTime();
        return sortDir === 'desc' ? vb - va : va - vb;
      }
      if (sortField === 'soc_completed_date' || sortField === 'soc_scheduled_date') {
        const va = parseCalendarDate(a[sortField])?.getTime() ?? 0;
        const vb = parseCalendarDate(b[sortField])?.getTime() ?? 0;
        return sortDir === 'desc' ? vb - va : va - vb;
      }
      if (sortField === 'name') {
        const va = (a.patientName || '').toLowerCase();
        const vb = (b.patientName || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      if (sortField === 'f2f') {
        const order = { Expired: 0, Red: 1, Orange: 2, Yellow: 3, Green: 4, '': 5 };
        return (order[a.f2f_urgency || ''] ?? 5) - (order[b.f2f_urgency || ''] ?? 5);
      }
      return 0;
    });
  }, [decoratedReferrals, stage, division, search, sortField, sortDir, colFilters, resolveSource, resolveSourceEntity, resolveMarketer, resolveUser, resolveFacility, resolveEntity, resolvePhysician, meta, hasDivision, pcpByReferralId, triagePresence, isClinicalRnModule, includeDeferredClinical, isMobilePendingLog, mentionIndex]);

  // Counts for the Clinical queue-scope toggle (division-scoped, ignores search/col filters).
  const clinicalQueueCounts = useMemo(() => {
    if (!isClinicalRnModule) return null;
    const predicate = typeof meta.matchReferral === 'function'
      ? meta.matchReferral
      : (r) => r.current_stage === 'Clinical Intake RN Review';
    let list = decoratedReferrals.filter(predicate).filter((r) => {
      if (r.division === 'ALF') return hasDivision('ALF');
      if (r.division === 'Special Needs') return hasDivision('Special Needs');
      return true;
    });
    if (division !== 'All') list = list.filter((r) => r.division === division);
    const active = list.filter(isActiveClinicalQueueRow).length;
    return { active, deferred: list.length - active, all: list.length };
  }, [isClinicalRnModule, decoratedReferrals, meta, hasDivision, division]);

  const queueHeaderH = QUEUE_HEADER_HEIGHT;
  const flip = useFlipWindow(stageReferrals, lockedGrid, {
    rowHeight: QUEUE_ROW_HEIGHT,
    headerHeight: queueHeaderH,
  });

  useEffect(() => {
    if (!lockedGrid || !selectedReferral) return;
    const idx = stageReferrals.findIndex((r) => r._id === selectedReferral._id);
    if (idx < 0) return;
    if (idx < flip.startIndex) flip.setStart(idx);
    else if (idx >= flip.startIndex + flip.slotCount) {
      flip.setStart(idx - flip.slotCount + 1);
    }
  }, [lockedGrid, selectedReferral, stageReferrals, flip.startIndex, flip.slotCount, flip.setStart]);

  // If the selected row drops out of the filtered queue (e.g. toggle flipped), clear it.
  useEffect(() => {
    if (!selectedReferralId) return;
    if (!stageReferrals.some((r) => r._id === selectedReferralId)) {
      setSelectedReferralId(null);
    }
  }, [stageReferrals, selectedReferralId]);

  // Distinct values per filterable column for datalist suggestions
  const colOptions = useMemo(() => {
    const predicate = typeof meta.matchReferral === 'function'
      ? meta.matchReferral
      : meta.consolidatedStages
        ? (r) => meta.consolidatedStages.includes(r.current_stage)
        : (r) => r.current_stage === stage;
    let base = decoratedReferrals.filter(predicate);
    if (isClinicalRnModule && !includeDeferredClinical) {
      base = base.filter(isActiveClinicalQueueRow);
    }
    const opts = {};
    columnDefs.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      base.forEach((r) => {
        switch (col.key) {
          case 'urgent': vals.add('yes'); vals.add('no'); break;
          case 'urgent_care_type':
            URGENT_CARE_TYPE_OPTIONS.forEach((o) => vals.add(o.label));
            break;
          case 'emr_onboarded': vals.add('yes'); vals.add('no'); break;
          case 'soc_completed_date': vals.add('yes'); vals.add('no'); break;
          case 'soc_scheduled_date': vals.add('yes'); vals.add('no'); break;
          case 'post_soc_docs':
            vals.add('yes'); vals.add('no');
            vals.add('waiting_docs'); vals.add('waiting_clinical'); vals.add('overdue');
            break;
          case 'division': if (r.division) vals.add(r.division); break;
          case 'stage': if (r.current_stage) vals.add(r.current_stage); break;
          case 'licence': {
            const v = resolveEntity(r.entity_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'triage':
            TRIAGE_FILTER_OPTIONS.forEach((opt) => vals.add(opt));
            break;
          case 'source': { const v = resolveSource(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'source_entity': { const v = resolveSourceEntity(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'marketer': { const v = resolveMarketer(r.marketer_id); if (v && v !== '—' && v !== r.marketer_id) vals.add(v); break; }
          case 'owner': { const v = resolveUser(r.intake_owner_id); if (v && v !== r.intake_owner_id && v !== '—') vals.add(v); break; }
          case 'insurance': { const v = r.patient?.insurance_plan; if (v) vals.add(v); break; }
          case 'facility': { const v = resolveFacility(r.facility_id); if (v && v !== '—') vals.add(v); break; }
          case 'pcp': { const v = resolvePcpName(r); if (v) vals.add(v); break; }
          case 'clinical_rn': {
            const v = resolveClinicalRnLabel(r, resolveUser);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'episode_type': vals.add(episodeTypeLongLabel(r)); break;
          case 'waiting_docs': vals.add('yes'); vals.add('no'); break;
          case 'days_in_stage': {
            const d = isStaffingModule ? daysInStaffing(r) : daysInStage(r);
            if (Number.isFinite(d)) vals.add(String(d));
            break;
          }
          case 'days_in_review': {
            const d = daysInReview(r);
            if (Number.isFinite(d)) vals.add(String(d));
            break;
          }
          case 'days_in_pipeline': {
            const d = daysInPipeline(r);
            if (Number.isFinite(d)) vals.add(String(d));
            break;
          }
        }
      });
      opts[col.key] = [...vals].sort((a, b) => a.localeCompare(b));
    });
    return opts;
  }, [decoratedReferrals, stage, resolveSource, resolveSourceEntity, resolveMarketer, resolveUser, resolveFacility, resolveEntity, resolvePhysician, meta, columnDefs, pcpByReferralId, isClinicalRnModule, includeDeferredClinical]);

  const triageStatus = triagePresence;

  // File upload flags
  const filesStore = useCareStore((s) => s.files);
  const fileUploadFlags = useMemo(() => {
    if (stage !== 'F2F/MD Orders Pending') return new Set();
    const patientIds = new Set(stageReferrals.map((r) => r.patient_id).filter(Boolean));
    if (!patientIds.size) return new Set();
    const flagged = new Set();
    for (const f of Object.values(filesStore)) {
      if ((f.category === 'F2F' || f.category === 'MD Orders') && patientIds.has(f.patient_id)) {
        flagged.add(f.patient_id);
      }
    }
    return flagged;
  }, [stage, stageReferrals, filesStore]);

  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e) { if (e.key === 'Escape') setContextMenu(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu]);

  function buildPatient(referral) {
    return referral.patient || {
      id: referral.patient_id,
      _id: referral.patient_id,
      first_name: referral.patientName?.split(' ')[0] || '',
      last_name: referral.patientName?.split(' ').slice(1).join(' ') || '',
      division: referral.division,
    };
  }

  function handleRowSelect(referral) { setSelectedReferralId(referral?._id || null); }
  function handleRowOpen(referral) { setSelectedReferralId(referral?._id || null); openPatient(buildPatient(referral), referral); }

  const selectAdjacentReferral = useCallback((delta) => {
    if (!stageReferrals.length) return;
    const idx = stageReferrals.findIndex((r) => r._id === selectedReferralId);
    const nextIdx = idx < 0
      ? (delta > 0 ? 0 : stageReferrals.length - 1)
      : Math.max(0, Math.min(stageReferrals.length - 1, idx + delta));
    const next = stageReferrals[nextIdx];
    if (!next) return;
    if (isPatientDrawerOpen) handleRowOpen(next);
    else handleRowSelect(next);
    requestAnimationFrame(() => {
      document.querySelector(`[data-queue-row="${next._id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [stageReferrals, selectedReferralId, isPatientDrawerOpen]);
  function handleRowOpenTab(referral, tab) {
    setSelectedReferralId(referral?._id || null);
    openPatient(buildPatient(referral), referral, tab);
  }
  function handleRowContextMenu(e, referral) { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, referral }); }

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const initiateTransition = useCallback((referral, toStage, prefilledNote) => {
    setContextMenu(null);
    if (!referral || !canMoveFromTo(referral.current_stage, toStage)) {
      showToast(`Cannot move from ${referral?.current_stage} to ${toStage}`, 'error');
      return;
    }
    // Conflict resolution flows pass a note already gathered in the panel —
    // skip the modal entirely so the user isn't re-prompted. NTUC and Hold
    // still need a modal because those require structured second-step data
    // beyond just a free-text note.
    if (prefilledNote && referral.current_stage === 'Conflict' && toStage !== 'NTUC' && toStage !== 'Hold' && toStage !== 'Conflict') {
      executeTransition(referral, toStage, prefilledNote);
      return;
    }
    if (needsModal(referral.current_stage, toStage)) {
      setPendingTransition({ referral, toStage, prefilledNote });
    } else {
      executeTransition(referral, toStage, prefilledNote || '');
    }
  }, []);

  async function executeTransition(referral, toStage, noteOrPayload) {
    setPendingTransition(null);
    const note = typeof noteOrPayload === 'string' ? noteOrPayload : '';

    // Conflict creation is a bespoke pre-step (needs UI-available record ids +
    // its own error message). Everything else — edge validation, NTUC
    // interception, field updates, stage-entry effects, audit, and the
    // leaving-Conflict auto-resolve — is owned by the transition engine.
    if (toStage === 'Conflict' && typeof noteOrPayload === 'object' && noteOrPayload) {
      // Conflicts.patient_id / created_by_id are Aurora text (pat_… / usr_…), not rec_ids.
      const patientCustomId = referral?.patient?.id || referral?.patient_id;
      const referralCustomId = referral?.id;
      if (!patientCustomId || !referralCustomId || !appUserId) {
        showToast('Cannot send to Conflict — missing patient/referral/user linkage', 'error');
        return;
      }
      try {
        await flagConflict({
          referral,
          patientRecordId: referral?.patient?._id,
          patientCustomId,
          referralCustomId,
          createdByUserRecordId: appUser?._id,
          actorUserId: appUserId,
          sourceModule: inferConflictSourceModuleFromStage(stage),
          category: noteOrPayload.category,
          severity: noteOrPayload.severity,
          description: noteOrPayload.description,
          origin: `module:${stage}`,
        });
      } catch (err) {
        console.error('Conflict create failed:', err);
        showToast(err?.message || 'Failed to create Conflict record — not moved', 'error');
        return;
      }
    }

    const result = attemptTransition({
      referral,
      toStage,
      context: {
        note,
        actorUserId: appUserId,
        canDirectNtuc: canPerm(PERMISSION_KEYS.REFERRAL_NTUC_DIRECT),
        resolveUserName: resolveUser,
      },
    });
    if (!result.allowed) {
      showToast(result.reason || `Cannot move to ${toStage}`, 'error');
      return;
    }
    try {
      await applyTransition({ referral, result, context: { actorUserId: appUserId } });
    } catch (err) {
      console.error('Stage move failed after conflict create:', err);
      showToast(err?.message || 'Failed to move patient — change reverted', 'error');
      return;
    }
    setSelectedReferralId(null);
    const label = result.wasIntercepted ? 'Sent to Admin Confirmation for NTUC review' : `moved to ${result.effectiveStage}`;
    showToast(`${referral.patientName || referral.patient_id} ${label}`);
  }

  function toggleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  const stageColor = meta.color || palette.accentBlue.hex;
  const hasAnyFilter = search.trim() || hasActiveFilters;

  function clearAll() { setSearch(''); clearFilters(); }

  // Clinical Review is restricted to clinical staff — no view, no edit —
  // including direct URL access to the module page.
  if (isClinicalRnModule && !canPerformClinicalRnReview(canPerm)) {
    return <AccessDenied message="Clinical Review is restricted to clinical staff." />;
  }
  if (loading) return <LoadingState message={`Loading ${stage}...`} />;

  // ── Render cell for a given column key ────────────────────────────────────
  function renderCell(col, referral, rowMeta = {}) {
    const days       = daysInStage(referral);
    const totalDays  = daysInPipeline(referral);
    const isSN = referral.division === 'Special Needs';
    const urgent = isUrgentCare(referral);
    const urgentTypes = getUrgentCareTypes(referral);
    const { isSelected = false, hovered = false } = rowMeta;
    const td = (extra = {}) => ({
      padding: '0 14px',
      height: QUEUE_ROW_HEIGHT,
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: 280,
      // Per-cell border — tr borders don't paint reliably with border-collapse: separate (needed for sticky cols).
      borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
      ...extra,
    });
    switch (col.key) {
      case 'added_to_module': {
        const raw = referral._stage_entered_at || referral.soc_completed_date || null;
        return (
          <td key="added_to_module" style={td({ maxWidth: 130, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.75) })}>
            {raw ? (fmtCalendarDate(raw) || String(raw).slice(0, 10)) : '—'}
          </td>
        );
      }
      case 'episode_type':
        return (
          <td key="episode_type" style={td({ maxWidth: 168 })}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <EpisodeTypeBadge referral={referral} size="tiny" />
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: hexToRgba(palette.backgroundDark.hex, 0.62),
                whiteSpace: 'nowrap',
              }}>
                {episodeTypeLongLabel(referral)}
              </span>
            </span>
          </td>
        );
      case 'soc_completed_date': {
        const raw = referral.soc_completed_date || null;
        return (
          <td key="soc_completed_date" style={td({ maxWidth: 130, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.75) })}>
            {raw ? (fmtCalendarDate(raw) || String(raw).slice(0, 10)) : '—'}
          </td>
        );
      }
      case 'soc_scheduled_date': {
        const raw = referral.soc_scheduled_date || null;
        return (
          <td key="soc_scheduled_date" style={td({ maxWidth: 130, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.75) })}>
            {raw ? (fmtCalendarDate(raw) || String(raw).slice(0, 10)) : '—'}
          </td>
        );
      }
      case 'waiting_docs': {
        const waiting = isDocumentationDeferred(referral);
        const docsCleared = !waiting && !!referral.documentation_cleared_at;
        const checklist = waiting ? getDocumentationClearChecklist(referral) : null;
        const clinicalAssigned = !!(
          referral.clinical_review_assigned_to_id
          && !referral.clinical_review_completed_at
        );
        const detail = !waiting
          ? (docsCleared ? 'Docs complete' : (clinicalAssigned ? 'Clinical assigned' : null))
          : [
              !checklist.f2f ? 'Need F2F' : 'Ready to send',
              clinicalAssigned ? 'RN assigned' : null,
            ].filter(Boolean).join(' · ');
        return (
          <td key="waiting_docs" style={td({ maxWidth: 170, textAlign: 'left' })}>
            {waiting ? (
              <div>
                <span style={{
                  fontSize: 10.5, fontWeight: 750, color: palette.accentOrange.hex,
                  padding: '2px 7px', borderRadius: 5,
                  background: hexOnWhite(palette.accentOrange.hex, 0.12),
                  border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.3)}`,
                }}>
                  Yes
                </span>
                {detail && (
                  <div style={{
                    marginTop: 4,
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: checklist.canClear
                      ? palette.accentGreen.hex
                      : hexToRgba(palette.backgroundDark.hex, 0.45),
                    lineHeight: 1.3,
                  }}>
                    {detail}
                  </div>
                )}
              </div>
            ) : docsCleared ? (
              <div>
                <span style={{
                  fontSize: 10.5, fontWeight: 750, color: palette.accentGreen.hex,
                  padding: '2px 7px', borderRadius: 5,
                  background: hexOnWhite(palette.accentGreen.hex, 0.12),
                  border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.3)}`,
                }}>
                  Complete
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>No</span>
            )}
          </td>
        );
      }
      case 'pcp':
        return (
          <td key="pcp" style={td({ maxWidth: 160, fontSize: 12.5 })}>
            {resolvePcpName(referral) || '—'}
          </td>
        );
      case 'account_manager_info': {
        // Nurse @Account manager info notes append here; keep clinical
        // send-back text visible above if present (separate workflow).
        const amLog = String(referral.account_manager_info || '').trim();
        const clinicalNote = String(referral.returned_from_clinical_note || '').trim();
        const parts = [];
        if (clinicalNote) parts.push(clinicalNote);
        if (amLog) parts.push(amLog);
        const note = parts.join('\n\n');
        return (
          <td
            key="account_manager_info"
            title={note || undefined}
            style={td({
              maxWidth: 320,
              minWidth: 180,
              height: 'auto',
              minHeight: QUEUE_ROW_HEIGHT,
              whiteSpace: 'pre-wrap',
              overflow: 'visible',
              textOverflow: 'clip',
              fontSize: 12,
              color: note ? hexToRgba(palette.backgroundDark.hex, 0.8) : hexToRgba(palette.backgroundDark.hex, 0.25),
              lineHeight: 1.35,
              paddingTop: 8,
              paddingBottom: 8,
            })}
          >
            {note || '—'}
          </td>
        );
      }
      case 'clinical_rn': {
        const assignedPending = !!(
          referral.clinical_review_assigned_to_id
          && !referral.clinical_review_completed_at
        );
        const name = resolveClinicalRnLabel(referral, resolveUser);
        return (
          <td key="clinical_rn" style={td({ maxWidth: 160, fontSize: 12.5 })} title={assignedPending ? 'Assigned — review open' : undefined}>
            {name && name !== '—' ? (
              <span>
                {name}
                {assignedPending && (
                  <span style={{
                    display: 'block', marginTop: 2, fontSize: 10.5, fontWeight: 650,
                    color: palette.primaryMagenta.hex,
                  }}>
                    Assigned
                  </span>
                )}
              </span>
            ) : '—'}
          </td>
        );
      }
      case 'urgent':
        return (
          <td key="urgent" style={td({ padding: '0 10px', textAlign: 'center', width: 40, maxWidth: 40 })}>
            {urgent ? <UrgentCareIcon size={14} types={urgentTypes} title="Urgent care required" /> : <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.2), fontSize: 11 }}>—</span>}
          </td>
        );
      case 'urgent_care_type': {
        return (
          <UrgentTypeCell
            key="urgent_care_type"
            referral={referral}
            appUserId={appUserId}
            td={td}
            onError={(err) => showToast(`Urgent type update failed: ${err.message}`, 'error')}
          />
        );
      }
      case 'patient': {
        const hasFile = fileUploadFlags.has(referral.patient_id);
        const name = referral.patientName || referral.patient_id || '—';
        const isMine = !!(appUserId && referral.intake_owner_id && referral.intake_owner_id === appUserId);
        const authObtainedAt = referral.auth_obtained_at;
        let authObtainedTitle = null;
        if (authObtainedAt) {
          try {
            const d = new Date(authObtainedAt);
            authObtainedTitle = `Authorization obtained on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
          } catch {
            authObtainedTitle = `Authorization obtained on ${authObtainedAt}`;
          }
        }
        // Stack tint over opaque page bg so sticky cells never show scrolling columns underneath.
        // Post-visit rows keep their blue tint in the frozen column too.
        const rowIsPostVisit = isPostVisitReferral(referral);
        const rowIsPreCheck = isClinicalLeadPreCheck(referral);
        const preCheckApproved = isClinicalLeadPreCheckApproved(referral);
        const stackTint = (tint) => `linear-gradient(${tint}, ${tint}), linear-gradient(${palette.backgroundLight.hex}, ${palette.backgroundLight.hex})`;
        const patientWash = queueRowWash(referral, { isSelected, hovered });
        const patientBg = isSelected || rowIsPostVisit || rowIsPreCheck || hovered
          ? stackTint(patientWash === 'transparent' ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : patientWash)
          : palette.backgroundLight.hex;
        return (
          <td
            key="patient"
            style={td({
              maxWidth: 220,
              minWidth: 160,
              ...(freezePatientCol ? {
                position: 'sticky',
                left: 0,
                zIndex: 2,
                background: patientBg,
                boxShadow: `2px 0 0 ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
              } : {}),
            })}
          >
            <span
              title={[name, isMine ? 'You own this case' : null, preCheckApproved ? 'Clinical pre-check approved' : null, hasFile ? 'File uploaded' : null, authObtainedTitle].filter(Boolean).join(' · ')}
              style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', overflow: 'hidden' }}
            >
              {isMine && <OwnedByMeIcon size={11} />}
              {preCheckApproved && <ClinicalPreCheckApprovedIcon size={11} />}
              {urgent && <UrgentCareIcon size={12} types={urgentTypes} title="Urgent care required" />}
              {/* Deferred-docs DOCS chip removed from the updated UI — the
                  post-visit flow replaces it (backend fields kept for old UI). */}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
              {isSocCompleted && referral.current_stage && referral.current_stage !== 'SOC Completed' && (
                <span
                  title={`Also working in ${referral.current_stage}`}
                  style={{
                    flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                    color: palette.accentBlue.hex,
                    background: hexOnWhite(palette.accentBlue.hex, 0.12),
                    border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.35)}`,
                    borderRadius: 4, padding: '1px 4px', whiteSpace: 'nowrap',
                  }}
                >
                  also {referral.current_stage === 'Intake' ? 'Intake' : referral.current_stage}
                </span>
              )}
              {!isSocCompleted && isSocCompletedReferral(referral) && (
                <HoverInfoCard
                  title={`${episodeTypeLabel(referral)} completed`}
                  detail={fmtCalendarDate(referral.soc_completed_date) || '—'}
                  accent={palette.accentGreen.hex}
                >
                  <span
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                      color: palette.accentGreen.hex,
                      background: hexOnWhite(palette.accentGreen.hex, 0.12),
                      border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`,
                      borderRadius: 4, padding: '1px 4px',
                    }}
                  >
                    {episodeTypeLabel(referral)}
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <circle cx="6" cy="6" r="5.5" fill={palette.accentGreen.hex} />
                      <path d="M3.5 6l2 2 3-3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </HoverInfoCard>
              )}
              {!isSocCompletedReferral(referral) && referral.soc_scheduled_date && (
                <HoverInfoCard
                  title={`${episodeTypeLabel(referral)} scheduled for`}
                  detail={fmtCalendarDate(referral.soc_scheduled_date) || '—'}
                  accent={palette.accentBlue.hex}
                >
                  <span style={{ display: 'inline-flex', flexShrink: 0, color: palette.accentBlue.hex }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="2" />
                      <path d="M3 9.5h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
                    </svg>
                  </span>
                </HoverInfoCard>
              )}
              {authObtainedAt && (
                <span title={authObtainedTitle} style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <AuthObtainedIcon size={13} title={authObtainedTitle} />
                </span>
              )}
              {hasFile && (
                <span title="File uploaded" style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </span>
            {(() => {
              const review = getReviewInProgress(referral);
              return review ? <ClinicalReviewByline name={review.starterName} /> : null;
            })()}
          </td>
        );
      }
      case 'division':
        return <td key="division" style={td({ maxWidth: 90 })}><DivisionBadge division={referral.division} size="small" /></td>;
      case 'licence': {
        const label = resolveEntity(referral.entity_id);
        if (!referral.entity_id || !label || label === '—') return <td key="licence" style={td({ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.25), maxWidth: 120 })}>—</td>;
        const isWBII = /WBII|WELLBOUND II/i.test(label);
        return (
          <td key="licence" style={td({ maxWidth: 140 })}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 20,
              fontSize: 11, fontWeight: 650, letterSpacing: '0.02em',
              background: isWBII ? hexOnWhite(palette.accentBlue.hex, 0.14) : hexOnWhite(palette.accentGreen.hex, 0.14),
              color: isWBII ? palette.accentBlue.hex : palette.accentGreen.hex,
            }}>
              {label}
            </span>
          </td>
        );
      }
      case 'source':
        return (
          <td key="source" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), maxWidth: 160 })} title={resolveSource(referral.referral_source_id) || ''}>
            {resolveSource(referral.referral_source_id) || '—'}
          </td>
        );
      case 'source_entity': {
        const label = resolveSourceEntity(referral.referral_source_id);
        return (
          <td key="source_entity" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), maxWidth: 180 })} title={label && label !== '—' ? label : ''}>
            {label && label !== '—' ? label : '—'}
          </td>
        );
      }
      case 'marketer':
        return (
          <td key="marketer" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), maxWidth: 140 })}>
            {referral?.marketer_id ? resolveMarketer(referral.marketer_id) : '—'}
          </td>
        );
      case 'stage': {
        const isOnTrackRow = referral.current_stage === 'Staffing Feasibility';
        return (
          <td key="stage" style={td({ maxWidth: 200 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StageBadge stage={referral.current_stage} referral={referral} size="small" />
              {isOnTrackRow && <img src="/feasibility-badge.png" alt="On Track" title="On Track" style={{ width: 16, height: 16 }} />}
              {referral.current_stage === 'Conflict' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: hexOnWhite(palette.accentOrange.hex, 0.15), color: palette.accentOrange.hex }}>!</span>}
            </div>
          </td>
        );
      }
      case 'triage':
        return (
          <td key="triage" style={td({ maxWidth: 100 })}>
            {isSN ? (
              triageStatus[referral.id] ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 650, color: palette.accentGreen.hex, background: hexOnWhite(palette.accentGreen.hex, 0.1), padding: '2px 8px', borderRadius: 20 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke={palette.accentGreen.hex} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Done
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.accentOrange.hex, 0.9), background: hexOnWhite(palette.accentOrange.hex, 0.1), padding: '2px 8px', borderRadius: 20 }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><circle cx="4" cy="4" r="3.5" stroke={palette.accentOrange.hex} strokeWidth="1.5" /></svg>
                  Needed
                </span>
              )
            ) : (
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>N/A</span>
            )}
          </td>
        );
      case 'days_in_stage': {
        if (isStaffingModule) {
          const staffingDays = daysInStaffing(referral);
          const color = staffingDays == null ? hexToRgba(palette.backgroundDark.hex, 0.28)
            : staffingDays > 14 ? palette.primaryMagenta.hex
            : staffingDays > 7 ? palette.accentOrange.hex
            : hexToRgba(palette.backgroundDark.hex, 0.7);
          return (
            <td key="days_in_stage" style={td({ maxWidth: 220 })}>
              <span
                title={staffingDays == null
                  ? 'Clock starts when the case is hard-pushed to Staffing (On Track)'
                  : `${staffingDays} day${staffingDays === 1 ? '' : 's'} in Staffing — since On Track`}
                style={{ fontSize: 12, color, fontWeight: staffingDays > 7 ? 650 : 500 }}
              >
                {staffingDays == null ? (
                  <span>—</span>
                ) : (
                  <>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{staffingDays}</span>
                    <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 400, marginLeft: 4 }}>
                      day{staffingDays === 1 ? '' : 's'} in Staffing
                    </span>
                  </>
                )}
              </span>
            </td>
          );
        }
        const stageName = displayStageName(referral) || referral.current_stage || 'stage';
        const color = days > 14 ? palette.primaryMagenta.hex
          : days > 7 ? palette.accentOrange.hex
          : hexToRgba(palette.backgroundDark.hex, 0.7);
        return (
          <td key="days_in_stage" style={td({ maxWidth: 220 })}>
            <span
              title={`${days} day${days === 1 ? '' : 's'} in ${referral.current_stage || 'stage'} — pipeline stage clock`}
              style={{ fontSize: 12, color, fontWeight: days > 7 ? 650 : 500 }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{days}</span>
              <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 400, marginLeft: 4 }}>
                day{days === 1 ? '' : 's'} in {stageName}
              </span>
            </span>
          </td>
        );
      }
      case 'days_in_review': {
        const reviewDays = daysInReview(referral);
        const color = reviewDays == null ? hexToRgba(palette.backgroundDark.hex, 0.28)
          : reviewDays > 14 ? palette.primaryMagenta.hex
          : reviewDays > 7 ? palette.accentOrange.hex
          : hexToRgba(palette.backgroundDark.hex, 0.7);
        return (
          <td key="days_in_review" style={td({ maxWidth: 180 })}>
            <span
              title={reviewDays == null
                ? 'No push or assign stamp for clinical review'
                : `${reviewDays} day${reviewDays === 1 ? '' : 's'} in Clinical Review`}
              style={{ fontSize: 12, color, fontWeight: reviewDays > 7 ? 650 : 500 }}
            >
              {reviewDays == null ? (
                <span>-</span>
              ) : (
                <>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{reviewDays}</span>
                  <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 400, marginLeft: 4 }}>
                    day{reviewDays === 1 ? '' : 's'} in review
                  </span>
                </>
              )}
            </span>
          </td>
        );
      }
      case 'days_in_pipeline': {
        return (
          <td key="days_in_pipeline" style={td({ maxWidth: 180 })}>
            <span
              title={`${totalDays} day${totalDays === 1 ? '' : 's'} in pipeline — since referral was created`}
              style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.65), fontWeight: 500 }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalDays}</span>
              <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 400, marginLeft: 4 }}>
                day{totalDays === 1 ? '' : 's'} in pipeline
              </span>
            </span>
          </td>
        );
      }
      case 'f2f':
        return <td key="f2f" style={td({ maxWidth: 100 })}><F2FCountdown referral={referral} /></td>;
      case 'owner': {
        const n = resolveUser(referral.intake_owner_id);
        const label = n !== referral.intake_owner_id ? n : (n || '—');
        const ownerUser = referral.intake_owner_id
          ? Object.values(storeUsers).find((u) => u.id === referral.intake_owner_id)
          : null;
        const isMine = !!(appUserId && referral.intake_owner_id && referral.intake_owner_id === appUserId);
        return (
          <td key="owner" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), maxWidth: 160 })} title={isMine ? `${label} (you)` : label}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
              {isMine && <OwnedByMeIcon size={10} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isMine ? 650 : 400 }}>{label}</span>
              <OooBadge user={ownerUser} />
            </span>
          </td>
        );
      }
      case 'insurance': {
        const plan = referral.patient?.insurance_plan || '—';
        return (
          <td key="insurance" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), maxWidth: 160 })} title={plan}>
            {plan}
          </td>
        );
      }
      case 'facility': {
        const fac = referral.facility_id ? resolveFacility(referral.facility_id) : '—';
        // Pending Log: show the full facility name (wrap, no ellipsis truncate).
        if (isPendingLogView) {
          return (
            <td
              key="facility"
              title={fac}
              style={td({
                fontSize: 12.5,
                color: hexToRgba(palette.backgroundDark.hex, 0.7),
                maxWidth: 320,
                whiteSpace: 'normal',
                overflow: 'visible',
                textOverflow: 'clip',
                lineHeight: 1.35,
              })}
            >
              {fac}
            </td>
          );
        }
        return (
          <td key="facility" style={td({ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), maxWidth: 160 })} title={fac}>
            {fac}
          </td>
        );
      }
      case 'emr_onboarded': {
        const full = !!referral.emr_onboarded_at;
        const initial = !!referral.emr_initial_onboarded_at;
        const yes = full || initial;
        const title = full
          ? `EMR onboarded ${new Date(referral.emr_onboarded_at).toLocaleDateString()}`
          : initial
            ? `Initial EMR onboarding ${new Date(referral.emr_initial_onboarded_at).toLocaleDateString()}`
            : 'Not EMR onboarded';
        return (
          <td key="emr_onboarded" style={td({ maxWidth: 110 })}>
            <span
              title={title}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 650,
                background: yes
                  ? hexOnWhite(palette.accentGreen.hex, 0.12)
                  : hexOnWhite(palette.backgroundDark.hex, 0.06),
                color: yes
                  ? palette.accentGreen.hex
                  : hexToRgba(palette.backgroundDark.hex, 0.4),
              }}
            >
              {yes ? 'Yes' : 'No'}
            </span>
          </td>
        );
      }
      case 'activity':
        return (
          <td key="activity" style={td({ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), maxWidth: 100 })}>
            {relativeTime(referral.updated_at)}
          </td>
        );
      default:
        return <td key={col.key} style={td()} />;
    }
  }

  // ── Mobile: card queue (SOC Completed / Pending Log first-class) ───────────
  if (isMobile) {
    return (
      <>
        {showNewReferral && (
          <NewReferralForm
            key={activeDraft?.id || 'new-lead'}
            draftRecordId={activeDraft?.id || null}
            draftBusinessId={activeDraft?.fields?.id || null}
            draftNumber={activeDraft?.fields?.draft_number || null}
            initialForm={activeDraft?.fields?.form_data || null}
            onClose={() => {
              setShowNewReferral(false);
              setActiveDraft(null);
              refreshDraftCount();
            }}
            onSuccess={({ patient, referral }) => {
              setActiveDraft(null);
              refreshDraftCount();
              refetch?.();
              openPatient(patient, referral, 'files');
            }}
          />
        )}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
            left: 16, right: 16, zIndex: 9997,
            background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
            color: palette.backgroundLight.hex, padding: '12px 16px', borderRadius: 10,
            fontSize: 13, fontWeight: 550,
            boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
            textAlign: 'center',
          }}>
            {toast.message}
          </div>
        )}
        {isSocCompleted ? (
          <MobileSocQueue
            meta={meta}
            stageColor={stageColor}
            referrals={stageReferrals}
            search={search}
            setSearch={setSearch}
            isPendingLogView={isPendingLogView}
            canPendingLog={canPendingLog}
            isSocCompleted
            onTogglePendingLog={toggleSocCompletedView}
            onOpenPatient={handleRowOpen}
            onOpenFiles={(r) => handleRowOpenTab(r, 'files')}
            onOpenNotes={(r) => handleRowOpenTab(r, 'notes')}
            onOpenConflicts={(r) => handleRowOpenTab(r, 'conflicts')}
            resolveFacility={resolveFacility}
            resolveMarketer={resolveMarketer}
            resolveUser={resolveUser}
            resolvePhysician={resolvePhysician}
            pcpByReferralId={pcpByReferralId}
          />
        ) : (
          <MobileSocQueue
            meta={isMobilePendingLog ? { ...meta, displayName: 'Pending Log' } : meta}
            stageColor={stageColor}
            referrals={stageReferrals}
            search={search}
            setSearch={setSearch}
            isPendingLogView={isMobilePendingLog}
            canPendingLog={false}
            isSocCompleted={false}
            reportMode={isMobilePendingLog}
            onOpenPatient={handleRowOpen}
            onOpenFiles={(r) => handleRowOpenTab(r, 'files')}
            onOpenNotes={(r) => handleRowOpenTab(r, 'notes')}
            onOpenConflicts={(r) => handleRowOpenTab(r, 'conflicts')}
            resolveFacility={resolveFacility}
            resolveMarketer={resolveMarketer}
            resolveUser={resolveUser}
            resolvePhysician={resolvePhysician}
            pcpByReferralId={pcpByReferralId}
          />
        )}
      </>
    );
  }

  return (
    <>
      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x} y={contextMenu.y} referral={contextMenu.referral}
          canChangeOwner={canChangeIntakeOwner}
          canDiscard={canDiscardAny && contextMenu.referral?.current_stage !== 'Discarded Leads'}
          onOpen={() => { handleRowOpen(contextMenu.referral); setContextMenu(null); }}
          onOpenTriage={() => { openPatient(buildPatient(contextMenu.referral), contextMenu.referral, 'triage'); setContextMenu(null); }}
          onChangeOwner={() => {
            setChangeOwnerTarget(contextMenu.referral);
            setContextMenu(null);
          }}
          onDiscard={() => {
            setDiscardTarget(contextMenu.referral);
            setContextMenu(null);
          }}
          onMarkUrgent={async (types) => {
            const ref = contextMenu.referral;
            setContextMenu(null);
            try {
              await setUrgentCare({ referral: ref, next: true, actorUserId: appUserId, type: types });
              const label = urgentCareTypeLabel(types);
              showToast(`${ref.patientName || ref.patient_id} flagged urgent care${label ? ` (${label})` : ''}`);
            } catch (err) {
              showToast(`Urgent care toggle failed: ${err.message}`, 'error');
            }
          }}
          onToggleUrgentTypes={async (types) => {
            const ref = contextMenu.referral;
            try {
              await setUrgentCareType({ referral: ref, types, actorUserId: appUserId });
            } catch (err) {
              showToast(`Urgent type update failed: ${err.message}`, 'error');
            }
          }}
          onClearUrgent={async () => {
            const ref = contextMenu.referral;
            setContextMenu(null);
            try {
              await setUrgentCare({ referral: ref, next: false, actorUserId: appUserId });
              showToast(`${ref.patientName || ref.patient_id} urgent care cleared`);
            } catch (err) {
              showToast(`Urgent care toggle failed: ${err.message}`, 'error');
            }
          }}
          onDismiss={() => setContextMenu(null)}
        />
      )}
      {discardTarget && (
        <DiscardReferralModal
          referral={discardTarget}
          title={discardTarget.current_stage === 'Lead Entry' ? 'Discard Lead' : 'Discard Referral'}
          confirmLabel={discardTarget.current_stage === 'Lead Entry' ? 'Discard Lead' : 'Discard Referral'}
          onCancel={() => setDiscardTarget(null)}
          onConfirm={async (reason, explanation) => {
            const result = await discardReferral({
              referral: discardTarget,
              reason,
              explanation,
              actorUserId: appUserId,
            });
            if (!result.ok) {
              showToast(result.reason || 'Discard failed', 'error');
              return;
            }
            showToast(`${discardTarget.patientName || discardTarget.patient_id} discarded`);
            setDiscardTarget(null);
            setSelectedReferralId(null);
            triggerDataRefresh();
          }}
        />
      )}
      {changeOwnerTarget && (
        <ChangeIntakeOwnerModal
          referral={changeOwnerTarget}
          patientName={changeOwnerTarget.patientName}
          onCancel={() => setChangeOwnerTarget(null)}
          onDone={() => {
            setChangeOwnerTarget(null);
            showToast('Intake owner updated');
            refetch?.();
          }}
        />
      )}
      {showNewReferral && (
        <NewReferralForm
          key={activeDraft?.id || 'new-lead'}
          draftRecordId={activeDraft?.id || null}
          draftBusinessId={activeDraft?.fields?.id || null}
          draftNumber={activeDraft?.fields?.draft_number || null}
          initialForm={activeDraft?.fields?.form_data || null}
          onClose={() => {
            setShowNewReferral(false);
            setActiveDraft(null);
            refreshDraftCount();
          }}
          onSuccess={({ patient, referral }) => {
            setActiveDraft(null);
            refreshDraftCount();
            refetch?.();
            openPatient(patient, referral);
          }}
        />
      )}
      {pendingTransition && (
        <TransitionModal
          referral={pendingTransition.referral}
          toStage={pendingTransition.toStage}
          initialNote={pendingTransition.prefilledNote}
          loading={false}
          onConfirm={(note) => executeTransition(pendingTransition.referral, pendingTransition.toStage, note)}
          onCancel={() => setPendingTransition(null)}
        />
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.message}
        </div>
      )}

      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={() => contextMenu && setContextMenu(null)}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, borderTop: `3px solid ${stageColor}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                <h1 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex }}>{meta.displayName || stage}</h1>
                {/* Count is information, not a notification — plain text, same ink as the title */}
                <span style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex, display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden style={{ color: hexToRgba(palette.backgroundDark.hex, 0.28), fontWeight: 400 }}>·</span>
                  {stageReferrals.length}
                </span>
                {/* Scope before content — make it explicit when this queue only shows one division */}
                {(() => {
                  const onlyALF = hasDivision('ALF') && !hasDivision('Special Needs');
                  const onlySPN = hasDivision('Special Needs') && !hasDivision('ALF');
                  const scoped = division !== 'All' ? division : (onlyALF ? 'ALF' : onlySPN ? 'Special Needs' : null);
                  if (!scoped) return null;
                  return (
                    <span
                      data-testid="module-division-scope"
                      title={`Showing ${scoped === 'Special Needs' ? 'Special Needs' : 'ALF'} referrals only`}
                      style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.5), background: hexToRgba(palette.backgroundDark.hex, 0.06), border: `1px solid var(--color-border)`, borderRadius: 4, padding: '1px 6px' }}
                    >
                      {scoped === 'Special Needs' ? 'SPN' : 'ALF'} only
                    </span>
                  );
                })()}
                {meta.isGlobal && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), background: hexToRgba(palette.backgroundDark.hex, 0.06), borderRadius: 4, padding: '1px 6px' }}>Global</span>}
                {meta.isTerminal && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.accentGreen.hex, 0.8), background: hexToRgba(palette.accentGreen.hex, 0.1), borderRadius: 4, padding: '1px 6px' }}>Terminal</span>}
              </div>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{meta.description}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Record actions — appear once a referral is selected; they act on
                  the selected row. Live here in the title row (which has spare
                  width) so the toolbar below always stays a single line. */}
              {(() => {
                if (!selectedReferral) return null;
                const discardVisible = canDiscardAny && stage !== 'Discarded Leads' && selectedReferral.current_stage !== 'Discarded Leads';
                // Conflict workflow applies after Intake — leads are not active referrals yet.
                const conflictVisible = !['Conflict', 'Discarded Leads', 'SOC Completed', 'Completed', 'NTUC', 'Lead Entry'].includes(stage);
                if (!discardVisible && !conflictVisible) return null;
                const canConflict = conflictVisible && canMoveFromTo(selectedReferral.current_stage, 'Conflict');
                return (
                  <>
                    {discardVisible && (
                      <button
                        type="button"
                        data-testid="discard-any-toolbar"
                        onClick={() => setDiscardTarget(selectedReferral)}
                        title={`Discard ${selectedReferral.patientName || 'this'}'s ${stage === 'Lead Entry' ? 'lead' : 'referral'}`}
                        style={{
                          height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                          borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', flexShrink: 0,
                          background: hexToRgba(palette.accentOrange.hex, 0.14),
                          color: palette.accentOrange.hex,
                        }}
                      >
                        {stage === 'Lead Entry' ? 'Discard Lead' : 'Discard Referral'}
                      </button>
                    )}
                    {conflictVisible && (
                      <button
                        type="button"
                        onClick={canConflict ? () => initiateTransition(selectedReferral, 'Conflict') : undefined}
                        disabled={!canConflict}
                        title={canConflict
                          ? `Send ${selectedReferral.patientName || 'this referral'} to the Conflict module`
                          : 'This referral cannot move to Conflict from its current stage'}
                        style={{
                          height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                          borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600, cursor: canConflict ? 'pointer' : 'default', flexShrink: 0,
                          background: canConflict ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
                          color: canConflict ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                          transition: 'all 0.12s',
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                          <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                        Send to Conflict
                      </button>
                    )}
                  </>
                );
              })()}
              {stage === 'Pre-SOC' && canPerm(PERMISSION_KEYS.MODULE_SCHEDULING) && (
                <Link
                  to="/tools/hchb-visit-check"
                  data-testid="hchb-visit-check-open"
                  title="Check scheduled SOC/ROC visits against HCHB logshipping"
                  style={{
                    height: 34, padding: '0 14px', borderRadius: 8, flexShrink: 0,
                    border: `1px solid var(--color-border)`,
                    background: 'none',
                    fontSize: 12.5, fontWeight: 650,
                    color: hexToRgba(palette.backgroundDark.hex, 0.65),
                    textDecoration: 'none',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  HCHB visit check
                </Link>
              )}
              {stage === 'Lead Entry' && canPermAny(PERMISSION_KEYS.LEADS_CREATE, PERMISSION_KEYS.REFERRAL_CREATE) && (
                <div style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowDraftsPanel((v) => !v)}
                    title="Open saved lead drafts"
                    style={{
                      height: 34, padding: '0 14px', borderRadius: 8, flexShrink: 0,
                      border: `1px solid ${showDraftsPanel ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                      background: showDraftsPanel ? hexToRgba(palette.primaryMagenta.hex, 0.07) : 'none',
                      fontSize: 12.5, fontWeight: 650,
                      color: showDraftsPanel ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
                      cursor: 'pointer', transition: 'all 0.12s',
                      display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                    }}
                  >
                    Drafts
                    {draftCount > 0 && (
                      <span style={{
                        minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                        background: hexToRgba(palette.backgroundDark.hex, 0.08),
                        color: hexToRgba(palette.backgroundDark.hex, 0.65),
                        fontSize: 10, fontWeight: 700, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {draftCount > 99 ? '99+' : draftCount}
                      </span>
                    )}
                  </button>
                  <ReferralDraftsPanel
                    open={showDraftsPanel}
                    onClose={() => setShowDraftsPanel(false)}
                    onOpenDraft={(rec) => {
                      setShowDraftsPanel(false);
                      let formData = rec?.fields?.form_data;
                      if (typeof formData === 'string') {
                        try { formData = JSON.parse(formData); } catch { formData = null; }
                      }
                      setActiveDraft({
                        ...rec,
                        fields: { ...(rec.fields || {}), form_data: formData && typeof formData === 'object' ? formData : {} },
                      });
                      setShowNewReferral(true);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDraft(null);
                      setShowNewReferral(true);
                    }}
                    title="Enter a new lead"
                    style={{
                      height: 34, padding: '0 16px', borderRadius: 8, border: 'none', flexShrink: 0,
                      background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
                      fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    + New Lead
                  </button>
                </div>
              )}
              <StageActions stage={stage} />
            </div>
          </div>

          {/* Toolbar — single line; record actions live in the title row above */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 7, padding: '0 10px', height: 32, flex: 1, minWidth: 180, maxWidth: 380, position: 'relative' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
                <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by patient name…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
              {search && (
                <button type="button" onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 4, width: 16, height: 16, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>
              )}
            </div>

            {/* Sort group — labeled so these read as sorts, not filters or actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginRight: 2 }}>Sort</span>
              <SortBtn label="Days" field="days" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortBtn label="F2F" field="f2f" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortBtn label="Name" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />
            </div>

            <div style={{ flex: 1 }} />

            {/* Queue review — separated from the view controls that follow */}
            <DuplicateChecker
              selectedReferral={selectedReferral}
              allReferrals={allReferrals}
              onSelectReferral={handleRowSelect}
              onOpenReferral={handleRowOpen}
            />
            <div aria-hidden style={{ width: 1, height: 20, background: 'var(--color-border)', flexShrink: 0, margin: '0 2px' }} />

            {isClinicalRnModule && clinicalQueueCounts && (
              <button
                type="button"
                data-testid="clinical-queue-scope"
                aria-pressed={includeDeferredClinical}
                onClick={() => setIncludeDeferredClinical((v) => !v)}
                title={includeDeferredClinical
                  ? 'Showing active clinical plus older deferred-only holds. Click to hide deferred-only.'
                  : `Active clinical + assigned handoffs. Click to also include ${clinicalQueueCounts.deferred} deferred-only case${clinicalQueueCounts.deferred === 1 ? '' : 's'}.`}
                style={{
                  height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, flexShrink: 0,
                  border: `1px solid ${includeDeferredClinical ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                  background: includeDeferredClinical ? hexToRgba(palette.primaryMagenta.hex, 0.07) : 'none',
                  fontSize: 12, fontWeight: 600,
                  color: includeDeferredClinical ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {includeDeferredClinical ? 'Deferred on' : 'Deferred off'}
                {clinicalQueueCounts.deferred > 0 && (
                  <span style={{
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: includeDeferredClinical
                      ? hexToRgba(palette.primaryMagenta.hex, 0.12)
                      : hexToRgba(palette.backgroundDark.hex, 0.08),
                    color: includeDeferredClinical
                      ? palette.primaryMagenta.hex
                      : hexToRgba(palette.backgroundDark.hex, 0.55),
                  }}>
                    {clinicalQueueCounts.deferred}
                  </span>
                )}
              </button>
            )}

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              title={showFilters ? 'Hide column filters' : 'Show column filters'}
              style={{
                height: 32, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7,
                border: 'none', background: 'transparent', fontSize: 12, fontWeight: showFilters || hasActiveFilters ? 700 : 600,
                color: showFilters || hasActiveFilters ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <FilterIcon /> Filters
              {hasActiveFilters && <span style={{ width: 6, height: 6, borderRadius: '50%', background: palette.primaryMagenta.hex, flexShrink: 0 }} />}
            </button>

            {/* Pin / unpin patient column */}
            <button
              type="button"
              onClick={() => setFreezePatient(!pinPatientCol)}
              title={pinPatientCol ? 'Unfreeze the patient name column (scrolls with the table)' : 'Freeze the patient name column while scrolling the table'}
              aria-pressed={pinPatientCol}
              style={{
                height: 32, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, flexShrink: 0,
                border: 'none', background: 'transparent',
                fontSize: 12, fontWeight: pinPatientCol ? 700 : 600,
                color: pinPatientCol ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                {pinPatientCol ? (
                  <path d="M12 17v5M9 3h6l1 7h2a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4h2L9 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M12 17v5M9 3h6l1 7h2a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4h2L9 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                )}
              </svg>
              {pinPatientCol ? 'Column frozen' : 'Freeze column'}
            </button>

            {/* SOC Completed — Pending Log alternate view */}
            {canPendingLog && (
              <button
                type="button"
                onClick={toggleSocCompletedView}
                data-testid="soc-completed-view-toggle"
                title={isPendingLogView ? 'Switch back to the standard SOC Completed queue' : 'Open the Pending Log (facility, docs wait, clinical note, …)'}
                style={{
                  height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, flexShrink: 0,
                  border: `1px solid ${isPendingLogView ? palette.accentOrange.hex : 'var(--color-border)'}`,
                  background: isPendingLogView ? palette.accentOrange.hex : 'none',
                  fontSize: 12, fontWeight: 650,
                  color: isPendingLogView ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {isPendingLogView ? 'Standard view' : 'Pending Log'}
              </button>
            )}

            {/* Column picker (standard queue only — Pending Log has a fixed column set) */}
            {!isPendingLogView && (
              <div ref={colPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setShowColPicker((v) => !v)}
                  title="Customize columns"
                  style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, border: `1px solid ${showColPicker ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: showColPicker ? hexToRgba(palette.primaryMagenta.hex, 0.07) : 'none', fontSize: 12, fontWeight: 600, color: showColPicker ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer', transition: 'all 0.12s' }}
                >
                  <ColsIcon /> Columns
                </button>
                {showColPicker && (
                  <ColumnPicker
                    columnDefs={columnDefs}
                    visibleCols={visibleCols}
                    onChange={setVisibleCols}
                    onClose={() => setShowColPicker(false)}
                    freezePatient={freezePatientCol}
                    onFreezePatientChange={setFreezePatient}
                  />
                )}
              </div>
            )}

            {/* Clear all */}
            <button
              onClick={clearAll}
              style={{ height: 32, padding: '0 12px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer', flexShrink: 0, visibility: hasAnyFilter ? 'visible' : 'hidden', transition: 'all 0.12s' }}
            >
              Clear all
            </button>

          </div>
        </div>

        {/* Body: queue + panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Queue — horizontal scroll with sticky L/R controls for non-trackpad users */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {stageReferrals.length === 0 ? (
              hasAnyFilter ? (
                /* Empty because of filters — very different from a truly empty queue */
                <EmptyState
                  title="No referrals match your current filters"
                  subtitle="Referrals in this queue may be hidden by your search or column filters."
                  action={(
                    <button
                      type="button"
                      onClick={clearAll}
                      style={{ height: 34, padding: '0 16px', borderRadius: 8, border: `1px solid var(--color-border)`, background: 'none', fontSize: 12.5, fontWeight: 650, color: palette.primaryMagenta.hex, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Clear filters
                    </button>
                  )}
                />
              ) : stage === 'Lead Entry' ? (
                <EmptyState
                  title="No leads in this queue"
                  subtitle="New referrals will appear here after submission and clinical pre-check."
                  action={canPermAny(PERMISSION_KEYS.LEADS_CREATE, PERMISSION_KEYS.REFERRAL_CREATE) ? (
                    /* Mirrors the header pair: one filled primary, one quiet bordered
                       secondary — same height and type so the cluster reads as one row */
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => { setActiveDraft(null); setShowNewReferral(true); }}
                        style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        + New Lead
                      </button>
                      {draftCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowDraftsPanel(true)}
                          style={{
                            height: 34, padding: '0 14px', borderRadius: 8,
                            border: `1px solid var(--color-border)`, background: 'none',
                            fontSize: 12.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.65),
                            cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}
                        >
                          View drafts
                          <span style={{
                            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                            background: hexToRgba(palette.backgroundDark.hex, 0.08),
                            color: hexToRgba(palette.backgroundDark.hex, 0.65),
                            fontSize: 10, fontWeight: 700, display: 'inline-flex',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            {draftCount > 99 ? '99+' : draftCount}
                          </span>
                        </button>
                      )}
                    </div>
                  ) : undefined}
                />
              ) : (
                <EmptyState
                  title={`No referrals in ${meta.displayName || stage}`}
                  subtitle="Referrals will appear here when they reach this stage."
                />
              )
            ) : (
              <QueueScrollFrame
                freezePatientCol={freezePatientCol}
                lockedGrid={lockedGrid}
                flip={flip}
                headerHeight={queueHeaderH}
                keyboardEnabled={!showNewReferral && !pendingTransition && !discardTarget && !changeOwnerTarget && !contextMenu}
                onNavigateRow={selectAdjacentReferral}
              >
                <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ height: QUEUE_HEADER_HEIGHT, borderBottom: `1px solid var(--color-border)` }}>
                      {activeColumns.map((col) => {
                        const isPatient = col.key === 'patient';
                        return (
                          <th
                            key={col.key}
                            title={col.tooltip || undefined}
                            style={{
                              padding: '0 14px',
                              height: QUEUE_HEADER_HEIGHT,
                              textAlign: 'left',
                              fontSize: 10.5,
                              fontWeight: 700,
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              color: hexToRgba(palette.backgroundDark.hex, 0.4),
                              whiteSpace: 'nowrap',
                              cursor: col.tooltip ? 'help' : 'default',
                              verticalAlign: 'middle',
                              position: 'sticky',
                              top: 0,
                              zIndex: isPatient && freezePatientCol ? 6 : 4,
                              background: QUEUE_STICKY_HEADER_BG,
                              boxShadow: `inset 0 -1px 0 var(--color-border)`,
                              ...(isPatient && freezePatientCol ? {
                                left: 0,
                                minWidth: 160,
                                boxShadow: `inset 0 -1px 0 var(--color-border), 2px 0 0 ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
                              } : {}),
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {col.label}
                              {col.tooltip && <span style={{ opacity: 0.5, fontSize: 9 }}>ⓘ</span>}
                              {col.filterable && (
                                <span style={{ width: 18, display: 'inline-flex', visibility: showFilters ? 'visible' : 'hidden' }}>
                                  {showFilters && (
                                    <ColumnFilterButton
                                      value={colFilters[col.key]}
                                      onChange={(v) => setColFilter(col.key, v)}
                                      label={col.label}
                                      options={colOptions[col.key] || []}
                                    />
                                  )}
                                </span>
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {flip.windowItems.map((ref) => (
                      <QueueRow
                        key={ref._id}
                        referral={ref}
                        activeColumns={activeColumns}
                        renderCell={renderCell}
                        isSelected={selectedReferral?._id === ref._id}
                        flexibleHeight={isPendingLogView}
                        onClick={() => handleRowSelect(ref)}
                        onDoubleClick={() => handleRowOpen(ref)}
                        onContextMenu={(e) => handleRowContextMenu(e, ref)}
                      />
                    ))}
                  </tbody>
                </table>
              </QueueScrollFrame>
            )}
          </div>

          {/* Stage-specific panel */}
          <StagePanel
            stage={stage} referrals={stageReferrals} allReferrals={allReferrals} selectedReferral={selectedReferral}
            resolveUser={resolveUser} resolveSource={resolveSource}
            onNewReferral={() => setShowNewReferral(true)}
            onOpenTriage={(ref) => openPatient(buildPatient(ref), ref, 'triage')}
            onOpenFiles={(ref) => openPatient(buildPatient(ref), ref, 'files')}
            onOpenEligibility={(ref) => openPatient(buildPatient(ref), ref, 'eligibility')}
            onOpenTab={(ref, tab) => openPatient(buildPatient(ref), ref, tab)}
            onInitiateTransition={(ref, toStage, prefilledNote) => initiateTransition(ref, toStage, prefilledNote)}
            onSelectedReferralLeftModule={() => setSelectedReferralId(null)}
          />
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/**
 * Queue table scroll shell: sticky left/right chevron controls + a clean
 * bottom track so Windows / mouse users can pan wide column sets without a
 * trackpad. Vertical scroll stays on the same pane.
 */
function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('[contenteditable="true"], [role="dialog"], [data-modal]');
}

function QueueScrollFrame({ children, freezePatientCol = false, lockedGrid = false, flip = null, headerHeight = QUEUE_HEADER_HEIGHT, keyboardEnabled = true, onNavigateRow }) {
  const scrollerRef = useRef(null);
  const setScroller = useCallback((node) => {
    scrollerRef.current = node;
    if (flip?.viewportRef) flip.viewportRef.current = node;
  }, [flip]);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, maxScroll: 0, viewW: 0 });

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const scrollLeft = el.scrollLeft;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft < maxScroll - 2);
    setMetrics({ scrollLeft, maxScroll, viewW: el.clientWidth });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Table width can change when columns toggle — observe first child too.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [update, children]);

  function scrollBy(delta) {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!keyboardEnabled) return undefined;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') scrollBy(-240);
      else if (e.key === 'ArrowRight') scrollBy(240);
      else onNavigateRow?.(e.key === 'ArrowDown' ? 1 : -1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardEnabled, onNavigateRow]);

  function seekFromClientX(clientX, trackEl) {
    const el = scrollerRef.current;
    if (!el || !trackEl) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    if (maxScroll <= 0) return;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.scrollLeft = ratio * maxScroll;
  }

  function onTrackPointerDown(e) {
    const el = scrollerRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    const track = e.currentTarget;
    seekFromClientX(e.clientX, track);
    function onMove(ev) { seekFromClientX(ev.clientX, track); }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const thumbW = metrics.maxScroll > 0
    ? Math.max(28, (metrics.viewW / (metrics.viewW + metrics.maxScroll)) * 100)
    : 100;
  const thumbLeft = metrics.maxScroll > 0
    ? (metrics.scrollLeft / metrics.maxScroll) * (100 - thumbW)
    : 0;
  const showControls = canLeft || canRight;

  const chevronBtn = (side) => {
    const enabled = side === 'left' ? canLeft : canRight;
    return (
      <button
        type="button"
        aria-label={side === 'left' ? 'Scroll columns left' : 'Scroll columns right'}
        title={side === 'left' ? 'Scroll left' : 'Scroll right'}
        disabled={!enabled}
        onClick={() => scrollBy(side === 'left' ? -240 : 240)}
        style={{
          position: 'absolute',
          [side]: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 3,
          width: 32,
          height: 32,
          borderRadius: 999,
          border: `1px solid ${hexToRgba(palette.backgroundDark.hex, enabled ? 0.12 : 0.06)}`,
          background: enabled ? palette.backgroundLight.hex : hexToRgba(palette.backgroundLight.hex, 0.7),
          color: hexToRgba(palette.backgroundDark.hex, enabled ? 0.65 : 0.25),
          boxShadow: enabled ? `0 2px 10px ${hexToRgba(palette.backgroundDark.hex, 0.1)}` : 'none',
          cursor: enabled ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls && enabled ? 'auto' : showControls ? 'none' : 'none',
          transition: 'opacity 0.15s, background 0.12s, color 0.12s, box-shadow 0.12s',
        }}
        onMouseEnter={(e) => {
          if (!enabled) return;
          e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.06);
          e.currentTarget.style.color = palette.primaryMagenta.hex;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = palette.backgroundLight.hex;
          e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.65);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          {side === 'left'
            ? <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      </button>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* When Patient is frozen, skip the left edge fade — it would cover the name. */}
        {canLeft && !freezePatientCol && (
          <div aria-hidden style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 36, zIndex: 2, pointerEvents: 'none',
            background: `linear-gradient(to right, ${palette.backgroundLight.hex} 30%, transparent)`,
          }} />
        )}
        {canRight && (
          <div aria-hidden style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 36, zIndex: 2, pointerEvents: 'none',
            background: `linear-gradient(to left, ${palette.backgroundLight.hex} 30%, transparent)`,
          }} />
        )}
        {!freezePatientCol && chevronBtn('left')}
        {chevronBtn('right')}
        <div
          ref={setScroller}
          className={`queue-h-scroll ${lockedGridClass(lockedGrid)}`.trim()}
          data-testid="queue-h-scroll"
          style={{
            height: '100%',
            overflowX: 'auto',
            overflowY: lockedGrid ? 'hidden' : 'auto',
          }}
        >
          {children}
        </div>
        {lockedGrid && flip && (
          <FlipScrollBar
            start={flip.startIndex}
            maxStart={flip.maxStart}
            slotCount={flip.slotCount}
            total={flip.total}
            headerHeight={headerHeight}
            onChange={flip.setStart}
          />
        )}
      </div>

      {/* Bottom track — always-available horizontal slider for mouse users */}
      <div
        data-testid="queue-h-track"
        onPointerDown={onTrackPointerDown}
        title="Scroll columns · Arrow keys: left/right scroll, up/down next patient"
        style={{
          flexShrink: 0,
          height: 14,
          margin: '0 10px 8px',
          borderRadius: 999,
          background: hexToRgba(palette.backgroundDark.hex, showControls ? 0.06 : 0.03),
          position: 'relative',
          cursor: showControls ? 'pointer' : 'default',
          transition: 'background 0.15s',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: `${thumbLeft}%`,
            width: `${thumbW}%`,
            borderRadius: 999,
            background: showControls
              ? hexToRgba(palette.backgroundDark.hex, 0.28)
              : hexToRgba(palette.backgroundDark.hex, 0.1),
            transition: 'background 0.15s',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

function QueueRow({ referral, activeColumns, renderCell, isSelected, onClick, onDoubleClick, onContextMenu, flexibleHeight = false }) {
  const [hovered, setHovered] = useState(false);
  const postVisit = isPostVisitReferral(referral);
  const preCheck = isClinicalLeadPreCheck(referral);
  const background = queueRowWash(referral, { isSelected, hovered });
  return (
    <tr
      data-queue-row={referral._id}
      data-post-visit={postVisit ? 'true' : undefined}
      data-lead-precheck={preCheck ? 'true' : undefined}
      onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        height: flexibleHeight ? 'auto' : QUEUE_ROW_HEIGHT,
        minHeight: QUEUE_ROW_HEIGHT,
        background,
        cursor: 'pointer', transition: 'background 0.1s',
      }}
    >
      {activeColumns.map((col) => renderCell(col, referral, { isSelected, hovered }))}
    </tr>
  );
}

function UrgentTypeCell({ referral, appUserId, td, onError }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const types = getUrgentCareTypes(referral);
  const label = urgentCareTypeLabel(types);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <td
      style={td({ maxWidth: 160, overflow: 'visible' })}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Wound care, Insulin, Injection"
          style={{
            width: '100%',
            maxWidth: 150,
            fontSize: 12,
            fontFamily: 'inherit',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: 6,
            border: 'none',
            textAlign: 'left',
            background: types.length ? urgentCareTypeBg(types[0]) : '#EEECEF',
            color: types.length ? urgentCareTypeColor(types[0]) : '#8A8494',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {types.length > 0 && <UrgentCareIcon size={12} types={types} />}
            {label || 'Type'}
          </span>
        </button>
        {open && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 40,
            minWidth: 168,
            background: palette.backgroundLight.hex,
            borderRadius: 10,
            boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`,
            padding: '6px 4px',
          }}>
            <UrgentCareTypePicker
              types={types}
              onChange={async (next) => {
                try {
                  await setUrgentCareType({ referral, types: next, actorUserId: appUserId });
                } catch (err) {
                  onError?.(err);
                }
              }}
            />
          </div>
        )}
      </div>
    </td>
  );
}

function MarkUrgentMenuBlock({ onSave }) {
  const [picked, setPicked] = useState([]);
  return (
    <>
      <div style={{
        padding: '6px 12px 2px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.4),
      }}>
        Mark urgent care
      </div>
      <div style={{ padding: '0 6px 6px' }}>
        <UrgentCareTypePicker types={picked} onChange={setPicked} />
        <button
          type="button"
          disabled={picked.length === 0}
          onClick={() => onSave(picked)}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '8px',
            borderRadius: 7,
            border: 'none',
            background: picked.length ? palette.primaryMagenta.hex : '#E8E6ED',
            color: picked.length ? palette.backgroundLight.hex : '#8A8494',
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: picked.length ? 'pointer' : 'not-allowed',
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

function RowContextMenu({ x, y, referral, onOpen, onOpenTriage, onChangeOwner, canChangeOwner, canDiscard, onDiscard, onMarkUrgent, onToggleUrgentTypes, onClearUrgent, onDismiss }) {
  const ref = useRef(null);
  const isSN = referral.division === 'Special Needs';
  const urgent = isUrgentCare(referral);
  const urgentType = getUrgentCareType(referral);
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) ref.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) ref.current.style.top = `${y - rect.height}px`;
  }, [x, y]);

  function MenuItem({ label, icon, onClick, accent }) {
    return (
      <button onClick={onClick} style={{ width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: accent || palette.backgroundDark.hex, display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.1s' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05))}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >{icon}{label}</button>
    );
  }

  return (
    <>
      <div onClick={onDismiss} style={{ position: 'fixed', inset: 0, zIndex: 9990 }} />
      <div ref={ref} style={{ position: 'fixed', top: y, left: x, zIndex: 9991, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 10, overflow: 'hidden', minWidth: 220, boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.13)}` }}>
        <div style={{ padding: '8px 14px 6px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {urgent && <UrgentCareIcon size={11} types={getUrgentCareTypes(referral)} />} {referral.patientName || referral.patient_id}
          </p>
        </div>
        <div style={{ padding: '4px 0' }}>
          <MenuItem label="Open" onClick={onOpen} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />
          {isSN && <MenuItem label="Open Triage Form" onClick={onOpenTriage} accent={palette.primaryMagenta.hex} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />}
          {canChangeOwner && (
            <MenuItem
              label="Change intake owner"
              onClick={onChangeOwner}
              accent={palette.accentBlue.hex}
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7" /><path d="M19 8v6M22 11h-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>}
            />
          )}
          {canDiscard && (
            <MenuItem
              label="Discard"
              onClick={onDiscard}
              accent={palette.accentOrange.hex}
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            />
          )}
          {/* Urgent care: checkboxes for wound / insulin / injection. */}
          {urgent ? (
            <>
              <MenuItem
                label={`Clear urgent care${urgentType ? ` (${urgentCareTypeLabel(urgentType)})` : ''}`}
                onClick={onClearUrgent}
                accent={palette.primaryMagenta.hex}
                icon={<UrgentCareIcon size={14} muted={false} title="Clear urgent care" />}
              />
              <div style={{
                padding: '6px 12px 2px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.4),
              }}>
                Change type
              </div>
              <div style={{ padding: '0 6px 6px' }}>
                <UrgentCareTypePicker
                  types={getUrgentCareTypes(referral)}
                  onChange={(next) => onToggleUrgentTypes?.(next)}
                />
              </div>
            </>
          ) : (
            <MarkUrgentMenuBlock onSave={(types) => onMarkUrgent(types)} />
          )}
        </div>
      </div>
    </>
  );
}

function SortBtn({ label, field, current, dir, onSort }) {
  const active = current === field;
  return (
    <button onClick={() => onSort(field)} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid var(--color-border)`, background: active ? palette.primaryMagenta.hex : 'none', color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
      {label}
      {active && <span style={{ fontSize: 9 }}>{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

function StageActions({ stage }) {
  if (stage === 'Lead Entry') return null;
  const secondaryActions = {
    'Eligibility Verification': 'Batch Recheck',
    'Hold': 'Export Hold Report',
    'NTUC': 'Export NTUC Report',
  };
  const label = secondaryActions[stage];
  if (!label) return null;
  return (
    <button style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid var(--color-border)`, background: hexToRgba(palette.backgroundDark.hex, 0.04), color: hexToRgba(palette.backgroundDark.hex, 0.7), fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
      {label}
    </button>
  );
}
