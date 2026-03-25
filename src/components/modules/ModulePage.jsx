import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePipelineData } from '../../hooks/usePipelineData.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { useCareStore } from '../../store/careStore.js';
import { updateReferralOptimistic } from '../../store/mutations.js';
import { STAGE_META } from '../../data/stageConfig.js';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../../utils/stageTransitions.js';
import { recordTransition } from '../../utils/recordTransition.js';
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
import LoadingState from '../common/LoadingState.jsx';
import EmptyState from '../common/EmptyState.jsx';
import StagePanel from './StagePanel.jsx';
import NewReferralForm from '../forms/NewReferralForm.jsx';
import TransitionModal from '../pipeline/TransitionModal.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysInStage(updatedAt) {
  if (!updatedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
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
  const { resolveUser, resolveMarketer, resolveSource, resolveFacility } = useLookups();
  const { open: openPatient } = usePatientDrawer();
  const { appUserId } = useCurrentAppUser();
  const { can: canPerm } = usePermissions();

  const [selectedReferral, setSelectedReferral] = useState(null);
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

  useEffect(() => {
    setSelectedReferral(null);
    setSearch('');
    clearFilters();
  }, [stage]);

  // ── Stage referrals with column filters ───────────────────────────────────

  const stageReferrals = useMemo(() => {
    const matchStages = meta.consolidatedStages || [stage];
    let list = allReferrals.filter((r) => matchStages.includes(r.current_stage));
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
      list = list.filter((r) => {
        let cellVal = '';
        switch (key) {
          case 'division': cellVal = r.division || ''; break;
          case 'source': cellVal = resolveSource(r.referral_source_id) || ''; break;
          case 'owner': cellVal = resolveUser(r.intake_owner_id) || ''; break;
          case 'insurance': cellVal = r.patient?.insurance_plan || ''; break;
          case 'facility': cellVal = resolveFacility(r.facility_id) || ''; break;
          default: return true;
        }
        return cellVal.toLowerCase().includes(q);
      });
    }

    return [...list].sort((a, b) => {
      if (sortField === 'days') {
        const va = daysInStage(a.updated_at);
        const vb = daysInStage(b.updated_at);
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
  }, [allReferrals, stage, division, search, sortField, sortDir, colFilters, resolveSource, resolveUser, resolveFacility]);

  // Distinct values per filterable column for datalist suggestions
  const colOptions = useMemo(() => {
    const cStages = meta.consolidatedStages || [stage];
    const base = allReferrals.filter((r) => cStages.includes(r.current_stage));
    const opts = {};
    MODULE_COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      base.forEach((r) => {
        switch (col.key) {
          case 'division': if (r.division) vals.add(r.division); break;
          case 'source': { const v = resolveSource(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'owner': { const v = resolveUser(r.intake_owner_id); if (v && v !== r.intake_owner_id && v !== '—') vals.add(v); break; }
          case 'insurance': { const v = r.patient?.insurance_plan; if (v) vals.add(v); break; }
          case 'facility': { const v = resolveFacility(r.facility_id); if (v && v !== '—') vals.add(v); break; }
        }
      });
      opts[col.key] = [...vals].sort((a, b) => a.localeCompare(b));
    });
    return opts;
  }, [allReferrals, stage, resolveSource, resolveUser, resolveFacility]);

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

  function handleRowSelect(referral) { setSelectedReferral(referral); }
  function handleRowOpen(referral) { setSelectedReferral(referral); openPatient(buildPatient(referral), referral); }
  function handleRowContextMenu(e, referral) { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, referral }); }

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const initiateTransition = useCallback((referral, toStage) => {
    setContextMenu(null);
    if (!referral || !canMoveFromTo(referral.current_stage, toStage)) {
      showToast(`Cannot move from ${referral?.current_stage} to ${toStage}`, 'error');
      return;
    }
    if (needsModal(referral.current_stage, toStage)) {
      setPendingTransition({ referral, toStage });
    } else {
      executeTransition(referral, toStage, '');
    }
  }, []);

  function executeTransition(referral, toStage, note) {
    const fromStage = referral.current_stage;
    setPendingTransition(null);

    const { effectiveStage, ntucMetadata, wasIntercepted } = resolveNtucDestination({
      requestedStage: toStage,
      fromStage,
      canDirect: () => canPerm(PERMISSION_KEYS.REFERRAL_NTUC_DIRECT),
      userId: appUserId,
    });

    const updateFields = { current_stage: effectiveStage, ...ntucMetadata };
    if (effectiveStage === 'Hold') { if (note) updateFields.hold_reason = note; updateFields.hold_return_stage = fromStage; }
    if (effectiveStage === 'NTUC' && note) updateFields.ntuc_reason = note;
    if (wasIntercepted && note) updateFields.ntuc_reason = note;

    updateReferralOptimistic(referral._id, updateFields).catch(() => {
      showToast('Failed to move patient — change reverted', 'error');
    });
    recordTransition({ referral, fromStage, toStage: effectiveStage, note, authorId: appUserId });
    setSelectedReferral(null);
    const label = wasIntercepted ? 'Sent to Admin Confirmation for NTUC review' : `moved to ${effectiveStage}`;
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
    const days = daysInStage(referral.updated_at);
    const isSN = referral.division === 'Special Needs';
    switch (col.key) {
      case 'patient':
        return (
          <td key="patient" style={{ padding: '11px 14px' }}>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 1 }}>
              {referral.patientName || referral.patient_id || '—'}
            </p>
            {referral.patient?.medicaid_number && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Medicaid: {referral.patient.medicaid_number}</p>
            )}
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
      case 'source':
        return (
          <td key="source" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {resolveSource(referral.referral_source_id) || '—'}
          </td>
        );
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
      case 'days':
        return (
          <td key="days" style={{ padding: '11px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: days > 7 ? 650 : 400, color: days > 14 ? palette.primaryMagenta.hex : days > 7 ? palette.accentOrange.hex : palette.backgroundDark.hex }}>
              {days === 0 ? 'Today' : `${days}d`}
            </span>
          </td>
        );
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
          onDismiss={() => setContextMenu(null)}
        />
      )}
      {showNewReferral && (
        <NewReferralForm onClose={() => setShowNewReferral(false)} onSuccess={({ patient, referral }) => { refetch?.(); openPatient(patient, referral); }} />
      )}
      {pendingTransition && (
        <TransitionModal referral={pendingTransition.referral} toStage={pendingTransition.toStage} loading={false}
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
            <StageActions stage={stage} onNewReferral={() => setShowNewReferral(true)} />
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
            onInitiateTransition={(ref, toStage) => initiateTransition(ref, toStage)}
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

function RowContextMenu({ x, y, referral, onOpen, onOpenTriage, onDismiss }) {
  const ref = useRef(null);
  const isSN = referral.division === 'Special Needs';
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
      <div ref={ref} style={{ position: 'fixed', top: y, left: x, zIndex: 9991, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 10, overflow: 'hidden', minWidth: 200, boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.13)}` }}>
        <div style={{ padding: '8px 14px 6px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{referral.patientName || referral.patient_id}</p>
        </div>
        <div style={{ padding: '4px 0' }}>
          <MenuItem label="Open" onClick={onOpen} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />
          {isSN && <MenuItem label="Open Triage Form" onClick={onOpenTriage} accent={palette.primaryMagenta.hex} icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>} />}
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

function StageActions({ stage, onNewReferral }) {
  if (stage === 'Lead Entry') {
    return (
      <button onClick={onNewReferral} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: palette.accentGreen.hex, color: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
        + New Referral
      </button>
    );
  }
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
