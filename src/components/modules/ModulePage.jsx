import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePipelineData } from '../../hooks/usePipelineData.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import { STAGE_META } from '../../data/stageConfig.js';
import { canMoveFromTo, needsModal } from '../../utils/stageTransitions.js';
import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { flagConflict, inferConflictSourceModuleFromStage } from '../../utils/conflictFlagging.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  MODULE_COLUMN_DEFS,
  useColumnVisibility,
  useColumnFilters,
  ColumnPicker,
  FilterInput,
  FilterIcon,
  ColsIcon,
} from '../../utils/columnModel.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import StageBadge from '../common/StageBadge.jsx';
import LoadingState from '../common/LoadingState.jsx';
import EmptyState from '../common/EmptyState.jsx';
import UrgentCareIcon from '../common/UrgentCareIcon.jsx';
import StagePanel from './StagePanel.jsx';
import NewReferralForm from '../forms/NewReferralForm.jsx';
import TransitionModal from '../pipeline/TransitionModal.jsx';
import { setUrgentCare, isUrgentCare } from '../../utils/urgentCare.js';
import palette, { hexToRgba } from '../../utils/colors.js';

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
  const days = Math.ceil((new Date(referral.f2f_expiration) - Date.now()) / 86400000);
  const color = days < 0 ? palette.primaryMagenta.hex
    : days <= 7  ? palette.primaryMagenta.hex
    : days <= 14 ? palette.accentOrange.hex
    : days <= 30 ? '#7A5F00'
    : palette.accentGreen.hex;
  const label = days < 0 ? `Exp ${Math.abs(days)}d` : `${days}d`;
  return (
    <span title={`F2F expires ${new Date(referral.f2f_expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
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
  const { data: allReferrals, loading, refetch } = usePipelineData();
  const {
    resolveUser,
    resolveMarketer,
    resolveSource,
    resolveFacility,
    resolveEntity = (id) => id || '—',
  } = useLookups();
  const { open: openPatient } = usePatientDrawer();
  const { appUser, appUserId } = useCurrentAppUser();
  const { can: canPerm } = usePermissions();

  // We track which referral the user clicked by its Airtable record id and
  // DERIVE the live referral object from `allReferrals` on every render. The
  // right-hand panel + toolbar previously held a snapshot from click-time,
  // which meant any in-flight optimistic update to the store (Schedule SOC,
  // Mark Complete, etc.) didn't reach the panel until a manual refresh.
  // Tracking by id makes the selection automatically reflect the latest data.
  const [selectedReferralId, setSelectedReferralId] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days');
  const [sortDir, setSortDir] = useState('desc');
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [toast, setToast] = useState(null);
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef(null);

  const { visibleCols, setVisibleCols, activeColumns } = useColumnVisibility(MODULE_COLUMN_DEFS);
  const { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters } = useColumnFilters(MODULE_COLUMN_DEFS);

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
  }, [stage]);

  // ── Stage referrals with column filters ───────────────────────────────────
  // Decorate each referral with concurrent-presence flags so the per-stage
  // matchReferral predicate (see STAGE_META) can read them without having to
  // import the auth/disen stores itself. Auth rows use the custom referral_id
  // (text "ref_xxx"); disenrollment flag rows use multipleRecordLinks
  // (array of Airtable record IDs), so we match on both shapes.
  const authStore = useCareStore((s) => s.authorizations) || {};
  const disenStore = useCareStore((s) => s.disenrollmentAssistanceFlags) || {};
  const decoratedReferrals = useMemo(() => {
    if (!allReferrals?.length) return allReferrals || [];
    const ACTIVE_AUTH = new Set(['nar', 'pending', 'follow_up_needed']);
    const OPEN_DISEN = new Set(['open', 'in_review']);
    const refIdsWithAuth = new Set();
    Object.values(authStore).forEach((a) => {
      if (!a?.referral_id) return;
      const status = (a.auth_status || a.status || '').toString().toLowerCase();
      if (ACTIVE_AUTH.has(status)) refIdsWithAuth.add(a.referral_id);
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
      _hasActiveAuthorization: refIdsWithAuth.has(r.id),
      _hasOpenDisenrollmentFlag: refRecIdsWithDisen.has(r._id) || refCustomIdsWithDisen.has(r.id),
    }));
  }, [allReferrals, authStore, disenStore]);

  const stageReferrals = useMemo(() => {
    // Prefer the modern predicate when present; fall back to the legacy
    // consolidatedStages array, then to a plain stage-equality check.
    const predicate = typeof meta.matchReferral === 'function'
      ? meta.matchReferral
      : meta.consolidatedStages
        ? (r) => meta.consolidatedStages.includes(r.current_stage)
        : (r) => r.current_stage === stage;
    let list = decoratedReferrals.filter(predicate);
    if (division !== 'All') list = list.filter((r) => r.division === division);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.patientName || '').toLowerCase().includes(q) ||
          (r.patient_id || '').toLowerCase().includes(q)
      );
    }

    // Per-column filters
    for (const [key, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const q = val.toLowerCase();

      // Numeric "days in …" filters: typing a number means "≥ N days".
      if (key === 'days_in_stage' || key === 'days_in_pipeline') {
        const n = parseInt(val.trim(), 10);
        if (Number.isFinite(n)) {
          list = list.filter((r) => {
            const d = key === 'days_in_stage' ? daysInStage(r) : daysInPipeline(r);
            return Number.isFinite(d) && d >= n;
          });
        }
        continue;
      }

      list = list.filter((r) => {
        // Boolean-style filter for the urgent care indicator. "yes" / "y" /
        // "true" → urgent only; "no" / "n" / "false" → not-urgent only.
        if (key === 'urgent') {
          const v = q.trim();
          const wantsUrgent = v === 'yes' || v === 'y' || v === 'true';
          const wantsNonUrgent = v === 'no' || v === 'n' || v === 'false';
          if (wantsUrgent) return isUrgentCare(r);
          if (wantsNonUrgent) return !isUrgentCare(r);
          return true; // partial typing — don't filter yet
        }
        let cellVal = '';
        switch (key) {
          case 'division': cellVal = r.division || ''; break;
          case 'licence': cellVal = resolveEntity(r.entity_id) || ''; break;
          case 'source': cellVal = resolveSource(r.referral_source_id) || ''; break;
          case 'marketer': cellVal = resolveMarketer(r.marketer_id) || ''; break;
          case 'owner': cellVal = resolveUser(r.intake_owner_id) || ''; break;
          case 'insurance': cellVal = r.patient?.insurance_plan || ''; break;
          case 'facility': cellVal = resolveFacility(r.facility_id) || ''; break;
          default: return true;
        }
        return cellVal.toLowerCase().includes(q);
      });
    }

    return [...list].sort((a, b) => {
      if (sortField === 'days_in_stage' || sortField === 'days') {
        const va = daysInStage(a);
        const vb = daysInStage(b);
        return sortDir === 'desc' ? vb - va : va - vb;
      }
      if (sortField === 'days_in_pipeline') {
        const va = daysInPipeline(a);
        const vb = daysInPipeline(b);
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
  }, [decoratedReferrals, stage, division, search, sortField, sortDir, colFilters, resolveSource, resolveMarketer, resolveUser, resolveFacility, resolveEntity, meta]);

  // Distinct values per filterable column for datalist suggestions
  const colOptions = useMemo(() => {
    const predicate = typeof meta.matchReferral === 'function'
      ? meta.matchReferral
      : meta.consolidatedStages
        ? (r) => meta.consolidatedStages.includes(r.current_stage)
        : (r) => r.current_stage === stage;
    const base = decoratedReferrals.filter(predicate);
    const opts = {};
    MODULE_COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      base.forEach((r) => {
        switch (col.key) {
          case 'urgent': vals.add('yes'); vals.add('no'); break;
          case 'division': if (r.division) vals.add(r.division); break;
          case 'licence': {
            const v = resolveEntity(r.entity_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'source': { const v = resolveSource(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'marketer': { const v = resolveMarketer(r.marketer_id); if (v && v !== '—' && v !== r.marketer_id) vals.add(v); break; }
          case 'owner': { const v = resolveUser(r.intake_owner_id); if (v && v !== r.intake_owner_id && v !== '—') vals.add(v); break; }
          case 'insurance': { const v = r.patient?.insurance_plan; if (v) vals.add(v); break; }
          case 'facility': { const v = resolveFacility(r.facility_id); if (v && v !== '—') vals.add(v); break; }
        }
      });
      opts[col.key] = [...vals].sort((a, b) => a.localeCompare(b));
    });
    return opts;
  }, [decoratedReferrals, stage, resolveSource, resolveMarketer, resolveUser, resolveFacility, resolveEntity, meta]);

  // Triage completion status
  const triageAdultStore = useCareStore((s) => s.triageAdult);
  const triagePedStore = useCareStore((s) => s.triagePediatric);

  const triageStatus = useMemo(() => {
    const snRefIds = new Set(
      stageReferrals.filter((r) => r.division === 'Special Needs' && r.id).map((r) => r.id)
    );
    if (!snRefIds.size) return {};
    const status = {};
    for (const t of Object.values(triageAdultStore)) {
      if (t.referral_id && snRefIds.has(t.referral_id)) status[t.referral_id] = true;
    }
    for (const t of Object.values(triagePedStore)) {
      if (t.referral_id && snRefIds.has(t.referral_id)) status[t.referral_id] = true;
    }
    return status;
  }, [stageReferrals, triageAdultStore, triagePedStore]);

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
      const patientRecordId = referral?.patient?._id;
      const patientCustomId = referral?.patient?.id || referral?.patient_id;
      const referralCustomId = referral?.id;
      const createdByUserRecordId = appUser?._id;
      if (!patientRecordId || !referralCustomId || !createdByUserRecordId) {
        showToast('Cannot send to Conflict — missing patient/referral/user linkage', 'error');
        return;
      }
      try {
        await flagConflict({
          referral,
          patientRecordId,
          patientCustomId,
          referralCustomId,
          createdByUserRecordId,
          actorUserId: appUserId,
          sourceModule: inferConflictSourceModuleFromStage(stage),
          category: noteOrPayload.category,
          severity: noteOrPayload.severity,
          description: noteOrPayload.description,
          origin: `module:${stage}`,
        });
      } catch (err) {
        console.error('Conflict create failed:', err);
        showToast('Failed to create Conflict record — not moved', 'error');
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
    } catch {
      showToast('Failed to move patient — change reverted', 'error');
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

  if (loading) return <LoadingState message={`Loading ${stage}...`} />;

  // ── Render cell for a given column key ────────────────────────────────────
  function renderCell(col, referral) {
    const days       = daysInStage(referral);
    const totalDays  = daysInPipeline(referral);
    const isSN = referral.division === 'Special Needs';
    const urgent = isUrgentCare(referral);
    switch (col.key) {
      case 'urgent':
        return (
          <td key="urgent" style={{ padding: '11px 10px', textAlign: 'center', width: 40 }}>
            {urgent ? <UrgentCareIcon size={14} title="Urgent care required" /> : <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.2), fontSize: 11 }}>—</span>}
          </td>
        );
      case 'patient':
        return (
          <td key="patient" style={{ padding: '11px 14px' }}>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {urgent && <UrgentCareIcon size={12} title="Urgent care required" />}
              {referral.patientName || referral.patient_id || '—'}
            </p>
            {fileUploadFlags.has(referral.patient_id) && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                File uploaded
              </p>
            )}
          </td>
        );
      case 'division':
        return <td key="division" style={{ padding: '11px 14px' }}><DivisionBadge division={referral.division} size="small" /></td>;
      case 'licence': {
        const label = resolveEntity(referral.entity_id);
        if (!referral.entity_id || !label || label === '—') return <td key="licence" style={{ padding: '11px 14px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</td>;
        const isWBII = /WBII|WELLBOUND II/i.test(label);
        return (
          <td key="licence" style={{ padding: '11px 14px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 20,
              fontSize: 11, fontWeight: 650, letterSpacing: '0.02em',
              background: isWBII ? hexToRgba(palette.accentBlue.hex, 0.14) : hexToRgba(palette.accentGreen.hex, 0.14),
              color: isWBII ? palette.accentBlue.hex : palette.accentGreen.hex,
            }}>
              {label}
            </span>
          </td>
        );
      }
      case 'source':
        return (
          <td key="source" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {resolveSource(referral.referral_source_id) || '—'}
          </td>
        );
      case 'marketer':
        return (
          <td key="marketer" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {referral?.marketer_id ? resolveMarketer(referral.marketer_id) : '—'}
          </td>
        );
      case 'stage': {
        const isOnTrackRow = referral.current_stage === 'Staffing Feasibility';
        return (
          <td key="stage" style={{ padding: '11px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StageBadge stage={referral.current_stage} size="small" />
              {isOnTrackRow && <img src="/feasibility-badge.png" alt="On Track" title="On Track" style={{ width: 16, height: 16 }} />}
              {referral.current_stage === 'Conflict' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: hexToRgba(palette.accentOrange.hex, 0.15), color: palette.accentOrange.hex }}>!</span>}
            </div>
          </td>
        );
      }
      case 'triage':
        return (
          <td key="triage" style={{ padding: '11px 14px' }}>
            {isSN ? (
              triageStatus[referral.id] ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 650, color: palette.accentGreen.hex, background: hexToRgba(palette.accentGreen.hex, 0.1), padding: '2px 8px', borderRadius: 20 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke={palette.accentGreen.hex} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Done
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.accentOrange.hex, 0.9), background: hexToRgba(palette.accentOrange.hex, 0.1), padding: '2px 8px', borderRadius: 20 }}>
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
        const stageName = referral.current_stage || 'stage';
        const color = days > 14 ? palette.primaryMagenta.hex
          : days > 7 ? palette.accentOrange.hex
          : hexToRgba(palette.backgroundDark.hex, 0.7);
        return (
          <td key="days_in_stage" style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
            <span
              title={`${days} day${days === 1 ? '' : 's'} in ${stageName} stage — resets on every stage change`}
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
      case 'days_in_pipeline': {
        return (
          <td key="days_in_pipeline" style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
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
        return <td key="f2f" style={{ padding: '11px 14px' }}><F2FCountdown referral={referral} /></td>;
      case 'owner':
        return (
          <td key="owner" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {(() => { const n = resolveUser(referral.intake_owner_id); return n !== referral.intake_owner_id ? n : (n || '—'); })()}
          </td>
        );
      case 'insurance':
        return (
          <td key="insurance" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {referral.patient?.insurance_plan || '—'}
          </td>
        );
      case 'facility':
        return (
          <td key="facility" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {referral.facility_id ? resolveFacility(referral.facility_id) : '—'}
          </td>
        );
      case 'activity':
        return (
          <td key="activity" style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            {relativeTime(referral.updated_at)}
          </td>
        );
      default:
        return <td key={col.key} />;
    }
  }

  return (
    <>
      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x} y={contextMenu.y} referral={contextMenu.referral}
          onOpen={() => { handleRowOpen(contextMenu.referral); setContextMenu(null); }}
          onOpenTriage={() => { openPatient(buildPatient(contextMenu.referral), contextMenu.referral, 'triage'); setContextMenu(null); }}
          onToggleUrgent={async () => {
            const ref = contextMenu.referral;
            setContextMenu(null);
            try {
              const next = !isUrgentCare(ref);
              await setUrgentCare({ referral: ref, next, actorUserId: appUserId });
              showToast(`${ref.patientName || ref.patient_id} ${next ? 'flagged urgent care' : 'urgent care cleared'}`);
            } catch (err) {
              showToast(`Urgent care toggle failed: ${err.message}`, 'error');
            }
          }}
          onDismiss={() => setContextMenu(null)}
        />
      )}
      {showNewReferral && (
        <NewReferralForm onClose={() => setShowNewReferral(false)} onSuccess={({ patient, referral }) => { refetch?.(); openPatient(patient, referral); }} />
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
                <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: hexToRgba(stageColor, 0.12), color: stageColor }}>
                  {stageReferrals.length}
                </span>
                {meta.isGlobal && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), background: hexToRgba(palette.backgroundDark.hex, 0.06), borderRadius: 4, padding: '1px 6px' }}>Global</span>}
                {meta.isTerminal && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.accentGreen.hex, 0.8), background: hexToRgba(palette.accentGreen.hex, 0.1), borderRadius: 4, padding: '1px 6px' }}>Terminal</span>}
              </div>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{meta.description}</p>
            </div>
            <StageActions stage={stage} />
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 7, padding: '0 10px', height: 32, flex: 1, maxWidth: 260, position: 'relative' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
                <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients..." style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12.5, color: palette.backgroundDark.hex, width: '100%' }} />
              {search && (
                <button type="button" onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 4, width: 16, height: 16, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>
              )}
            </div>

            <SortBtn label="Days" field="days" current={sortField} dir={sortDir} onSort={toggleSort} />
            <SortBtn label="F2F" field="f2f" current={sortField} dir={sortDir} onSort={toggleSort} />
            <SortBtn label="Name" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />

            <div style={{ flex: 1 }} />

            {stage === 'Lead Entry' && canPerm(PERMISSION_KEYS.REFERRAL_CREATE) && (
              <button
                type="button"
                onClick={() => setShowNewReferral(true)}
                title="Create a new referral"
                style={{
                  height: 32, padding: '0 14px', borderRadius: 7, border: 'none', flexShrink: 0,
                  background: palette.accentGreen.hex, color: palette.backgroundLight.hex,
                  fontSize: 12, fontWeight: 650, cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                + New Referral
              </button>
            )}

            <DuplicateChecker selectedReferral={selectedReferral} allReferrals={allReferrals} />

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              title={showFilters ? 'Hide column filters' : 'Show column filters'}
              style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none', fontSize: 12, fontWeight: 600, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer', flexShrink: 0, transition: 'all 0.12s' }}
            >
              <FilterIcon /> Filters
              {hasActiveFilters && <span style={{ width: 6, height: 6, borderRadius: '50%', background: palette.accentBlue.hex, flexShrink: 0 }} />}
            </button>

            {/* Column picker */}
            <div ref={colPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setShowColPicker((v) => !v)}
                title="Customize columns"
                style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, border: `1px solid ${showColPicker ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: showColPicker ? hexToRgba(palette.primaryMagenta.hex, 0.07) : 'none', fontSize: 12, fontWeight: 600, color: showColPicker ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer', transition: 'all 0.12s' }}
              >
                <ColsIcon /> Columns
              </button>
              {showColPicker && (
                <ColumnPicker columnDefs={MODULE_COLUMN_DEFS} visibleCols={visibleCols} onChange={setVisibleCols} onClose={() => setShowColPicker(false)} />
              )}
            </div>

            {/* Send to Conflict */}
            {stage !== 'Conflict' && stage !== 'Discarded Leads' && stage !== 'SOC Completed' && stage !== 'NTUC' && (() => {
              const isLeadsModule = stage === 'Lead Entry';
              const canTransition = selectedReferral && canMoveFromTo(selectedReferral.current_stage, 'Conflict');
              const canSend = canTransition && !isLeadsModule;
              const conflictTitle = isLeadsModule
                ? 'Conflict workflow applies after Intake — leads are not active referrals yet'
                : !selectedReferral
                  ? 'Select a patient to send to Conflict'
                  : !canTransition
                    ? 'This patient cannot move to Conflict from their current stage'
                    : `Send ${selectedReferral?.patientName || 'patient'} to Conflict`;
              return (
                <button
                  type="button"
                  onClick={canSend ? () => initiateTransition(selectedReferral, 'Conflict') : undefined}
                  disabled={!canSend}
                  title={conflictTitle}
                  style={{
                    height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
                    borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600, cursor: canSend ? 'pointer' : 'default', flexShrink: 0,
                    background: canSend ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
                    color: canSend ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
                    transition: 'all 0.12s',
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  Conflict
                </button>
              );
            })()}

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
          {/* Queue */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {stageReferrals.length === 0 ? (
              <EmptyState title={`No patients in ${meta.displayName || stage}`} subtitle={hasAnyFilter ? 'Try clearing filters or search.' : 'Patients will appear here when they reach this stage.'} />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead>
                  <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                    {activeColumns.map((col) => (
                      <th key={col.key} title={col.tooltip || undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: col.tooltip ? 'help' : 'default' }}>
                        {col.label}
                        {col.tooltip && <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 9 }}>ⓘ</span>}
                      </th>
                    ))}
                  </tr>
                  {showFilters && (
                    <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                      {activeColumns.map((col) => (
                        <th key={col.key} style={{ padding: '4px 8px' }}>
                          {col.filterable ? (
                            <FilterInput
                              value={colFilters[col.key] || ''}
                              onChange={(v) => setColFilter(col.key, v)}
                              placeholder={col.label}
                              options={colOptions[col.key] || []}
                            />
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {stageReferrals.map((ref) => (
                    <QueueRow
                      key={ref._id}
                      referral={ref}
                      activeColumns={activeColumns}
                      renderCell={renderCell}
                      isSelected={selectedReferral?._id === ref._id}
                      onClick={() => handleRowSelect(ref)}
                      onDoubleClick={() => handleRowOpen(ref)}
                      onContextMenu={(e) => handleRowContextMenu(e, ref)}
                    />
                  ))}
                </tbody>
              </table>
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

function QueueRow({ referral, activeColumns, renderCell, isSelected, onClick, onDoubleClick, onContextMenu }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
        background: isSelected ? hexToRgba(palette.primaryMagenta.hex, 0.06) : hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent',
        cursor: 'pointer', transition: 'background 0.1s',
      }}
    >
      {activeColumns.map((col) => renderCell(col, referral))}
    </tr>
  );
}

function RowContextMenu({ x, y, referral, onOpen, onOpenTriage, onToggleUrgent, onDismiss }) {
  const ref = useRef(null);
  const isSN = referral.division === 'Special Needs';
  const urgent = isUrgentCare(referral);
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
            {urgent && <UrgentCareIcon size={11} />} {referral.patientName || referral.patient_id}
          </p>
        </div>
        <div style={{ padding: '4px 0' }}>
          <MenuItem label="Open" onClick={onOpen} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />
          {isSN && <MenuItem label="Open Triage Form" onClick={onOpenTriage} accent={palette.primaryMagenta.hex} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />}
          {/* Urgent care toggle is ALWAYS present in the context menu — the
              user explicitly requested it never be hidden behind a permission
              gate at the UI layer. */}
          <MenuItem
            label={urgent ? 'Clear urgent care / pre-assessment' : 'Mark urgent care / pre-assessment'}
            onClick={onToggleUrgent}
            accent={palette.primaryMagenta.hex}
            icon={<UrgentCareIcon size={14} muted={!urgent} title={urgent ? 'Clear urgent care' : 'Mark urgent care'} />}
          />
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

// ── Duplicate Checker ────────────────────────────────────────────────────────

const DupIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <rect x="8" y="2" width="13" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M16 18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

function buildIdentityKeys(r) {
  const keys = [];
  const name = (r.patientName || '').trim().toLowerCase();
  const dob = r.patient?.dob || '';
  if (name && dob) keys.push(`name:${name}|dob:${dob}`);
  const medicaid = (r.patient?.medicaid_number || '').trim().toLowerCase();
  if (medicaid) keys.push(`medicaid:${medicaid}`);
  return keys;
}

function findDuplicatePatients(referrals) {
  const seen = {};
  for (const r of referrals) {
    for (const key of buildIdentityKeys(r)) {
      (seen[key] ||= []).push(r);
    }
  }
  const matched = new Map();
  for (const group of Object.values(seen)) {
    const uniquePatientIds = [...new Set(group.map((r) => r.patient_id))];
    if (uniquePatientIds.length < 2) continue;
    const groupKey = uniquePatientIds.sort().join('|');
    if (!matched.has(groupKey)) {
      const deduped = [];
      const idsSeen = new Set();
      for (const r of group) {
        if (!idsSeen.has(r.patient_id)) { idsSeen.add(r.patient_id); deduped.push(r); }
      }
      matched.set(groupKey, deduped);
    }
  }
  return [...matched.values()];
}

/** Duplicate groups in the pipeline that include the selected patient's record(s). */
function findDuplicateGroupsForPatient(selectedReferral, allReferrals) {
  if (!selectedReferral?.patient_id) return [];
  const groups = findDuplicatePatients(allReferrals);
  return groups.filter((g) => g.some((r) => r.patient_id === selectedReferral.patient_id));
}

function DuplicateChecker({ selectedReferral, allReferrals }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const disabled = !selectedReferral;
  const groups = useMemo(
    () => (selectedReferral ? findDuplicateGroupsForPatient(selectedReferral, allReferrals) : []),
    [selectedReferral, allReferrals]
  );
  const dupCount = groups.length;

  useEffect(() => {
    if (!open) return;
    function dismiss(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  useEffect(() => {
    if (!selectedReferral) setOpen(false);
  }, [selectedReferral]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={disabled ? 'Select a patient in the list to check for duplicate records' : `Duplicate matches for ${selectedReferral?.patientName || 'patient'}`}
        style={{
          height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
          borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? hexToRgba(palette.backgroundDark.hex, 0.06) : open ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
          color: disabled ? hexToRgba(palette.backgroundDark.hex, 0.28) : open ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
          transition: 'all 0.12s',
        }}
      >
        <DupIcon /> Duplicates
      </button>

      {open && !disabled && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
          width: 380,
          background: palette.backgroundLight.hex,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.18)}, 0 2px 8px ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        }}>
          <div style={{ padding: '10px 12px 6px', borderBottom: `1px solid var(--color-border)` }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Selected patient</p>
            <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginTop: 2 }}>{selectedReferral.patientName || selectedReferral.patient_id}</p>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.42), marginTop: 6, lineHeight: 1.45 }}>
              Matches other pipeline records by name + DOB or Medicaid ID. A pipeline-wide duplicate report will be added separately.
            </p>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '8px 10px 10px' }}>
            {dupCount === 0 ? (
              <div style={{ padding: '12px 8px', textAlign: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 6px', display: 'block', opacity: 0.4 }}>
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke={palette.accentGreen.hex} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: palette.accentGreen.hex }}>No duplicate patient records found</p>
              </div>
            ) : (
              groups.map((group, gi) => (
                <div key={gi} style={{ background: hexToRgba(palette.primaryMagenta.hex, 0.04), borderRadius: 8, padding: '8px 10px', marginBottom: 4 }}>
                  {group.map((r, ri) => (
                    <div key={r._id || ri} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ri === 0 ? palette.primaryMagenta.hex : hexToRgba(palette.primaryMagenta.hex, 0.35), flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: ri === 0 ? 650 : 450, color: palette.backgroundDark.hex, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.patientName || r.patient_id}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.35), flexShrink: 0 }}>
                        {r.current_stage}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
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
