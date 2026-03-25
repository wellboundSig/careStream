import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useOutletContext, useLocation } from 'react-router-dom';
import { usePatients } from '../hooks/usePatients.js';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { updateReferral } from '../api/referrals.js';
import { recordTransition } from '../utils/recordTransition.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../utils/stageTransitions.js';
import TransitionModal from '../components/pipeline/TransitionModal.jsx';
import QuickNoteModal from '../components/patients/QuickNoteModal.jsx';
import NewReferralForm from '../components/forms/NewReferralForm.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import palette, { hexToRgba } from '../utils/colors.js';

const ALL_STAGE_ORDER = ['Lead Entry','Intake','Eligibility Verification','Disenrollment Required','F2F/MD Orders Pending','Clinical Intake RN Review','Authorization Pending','Conflict','Staffing Feasibility','Admin Confirmation','Pre-SOC','SOC Scheduled','SOC Completed','Hold','NTUC'];

// ── Column definitions ─────────────────────────────────────────────────────────
const COLUMN_DEFS = [
  { key: 'patient',         label: 'Patient',          defaultOn: true,  alwaysOn: true,  sortField: 'last_name',     filterable: false },
  { key: 'division',        label: 'Division',          defaultOn: true,  sortField: 'division',       filterable: true  },
  { key: 'stage',           label: 'Stage',             defaultOn: true,  sortField: 'stage',          filterable: true  },
  { key: 'f2f',  label: 'F2F',  tooltip: 'Face-to-Face authorization — shows days until the F2F order expires (red = expired, orange = ≤14d remaining)',  defaultOn: true, filterable: false },
  { key: 'days', label: 'Days', tooltip: 'Days the patient has been in their current stage. Turns orange at >14 days to flag overdue referrals.', defaultOn: true, filterable: false },
  { key: 'marketer',        label: 'Marketer',          defaultOn: true,  filterable: true  },
  { key: 'insurance',       label: 'Insurance',         defaultOn: true,  sortField: 'insurance_plan', filterable: true  },
  { key: 'referral_date',   label: 'Referral Date',     defaultOn: true,  filterable: true  },
  { key: 'referral_source', label: 'Referral Source',   defaultOn: false, filterable: true  },
  { key: 'facility',        label: 'Facility',          defaultOn: false, filterable: true  },
  { key: 'physician',       label: 'Physician',         defaultOn: false, filterable: true  },
];

const DEFAULT_COL_FILTERS = Object.fromEntries(
  COLUMN_DEFS.filter((c) => c.filterable).map((c) => [c.key, ''])
);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysInStage(updatedAt) {
  if (!updatedAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
}

// ── F2F Countdown cell ─────────────────────────────────────────────────────────
function F2FCell({ referral }) {
  if (!referral?.f2f_expiration) return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>;
  const days = Math.ceil((new Date(referral.f2f_expiration) - Date.now()) / 86400000);
  const color = days < 0 ? palette.primaryMagenta.hex : days <= 7 ? palette.primaryMagenta.hex : days <= 14 ? palette.accentOrange.hex : days <= 30 ? '#7A5F00' : palette.accentGreen.hex;
  const label = days < 0 ? `${Math.abs(days)}d ago` : `${days}d`;
  return (
    <span title={`Expires ${fmtDate(referral.f2f_expiration)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: days <= 14 ? 650 : 500, color }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      {days < 0 ? 'Expired' : label}
    </span>
  );
}

// ── Context menu ───────────────────────────────────────────────────────────────
function ContextMenu({ x, y, row, onOpen, onTriage, onNote, onStageChange, onDismiss }) {
  const menuRef = useRef(null);
  const isSN = row.division === 'Special Needs';
  const currentStage = row.current_stage;
  const validStages = currentStage
    ? ALL_STAGE_ORDER.filter((s) => canMoveFromTo(currentStage, s))
    : [];

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = x + width + pad > vw ? Math.max(pad, x - width) : x;
    const top  = y + height + pad > vh ? Math.max(pad, y - height) : y;

    el.style.left       = `${left}px`;
    el.style.top        = `${top}px`;
    el.style.visibility = 'visible';
  }, [x, y]);

  const item = (label, icon, onClick, accent) => (
    <button onClick={onClick} style={{ width: '100%', padding: '8px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 480, color: accent || palette.backgroundDark.hex, display: 'flex', alignItems: 'center', gap: 9, transition: 'background 0.1s' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05))}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      {icon} {label}
    </button>
  );

  const stageItem = (stage) => (
    <button key={stage} onClick={() => onStageChange(stage)} style={{ width: '100%', padding: '6px 14px 6px 30px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 12.5, color: stage === 'NTUC' ? hexToRgba(palette.backgroundDark.hex, 0.5) : stage === 'Hold' ? '#7A5F00' : palette.backgroundDark.hex, transition: 'background 0.1s' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.04))}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      → {stage}
    </button>
  );

  return (
    <>
      <div onClick={onDismiss} style={{ position: 'fixed', inset: 0, zIndex: 9990 }} />
      <div ref={menuRef} style={{ position: 'fixed', top: y, left: x, visibility: 'hidden', zIndex: 9991, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 10, overflow: 'hidden', minWidth: 220, maxWidth: 260, boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.13)}` }}>
        <div style={{ padding: '8px 14px 6px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{row.patientName || row.patient_id}</p>
          {currentStage && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 1 }}>{currentStage}</p>}
        </div>
        <div style={{ padding: '4px 0' }}>
          {item('Open', <PersonIcon />, onOpen)}
          {isSN && item('Triage Form', <ClipboardIcon />, onTriage, palette.primaryMagenta.hex)}
          {item('Add Note', <NoteIcon />, onNote, palette.accentBlue.hex)}
        </div>
        {validStages.length > 0 && (
          <>
            <div style={{ height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />
            <div style={{ padding: '4px 0' }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '4px 14px 2px' }}>Move to</p>
              {validStages.map(stageItem)}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Column Picker ──────────────────────────────────────────────────────────────
function ColumnPicker({ visibleCols, onChange, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 200, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 8, padding: '8px 0', minWidth: 200, boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), padding: '2px 14px 8px' }}>Columns</p>
      {COLUMN_DEFS.map((col) => (
        <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 14px', cursor: col.alwaysOn ? 'default' : 'pointer', opacity: col.alwaysOn ? 0.45 : 1 }}>
          <input
            type="checkbox"
            checked={visibleCols.has(col.key)}
            disabled={col.alwaysOn}
            onChange={() => {
              if (col.alwaysOn) return;
              const next = new Set(visibleCols);
              if (next.has(col.key)) next.delete(col.key);
              else next.add(col.key);
              onChange(next);
            }}
            style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13 }}
          />
          <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>{col.label}</span>
        </label>
      ))}
    </div>
  );
}

// ── Tiny SVG icons ─────────────────────────────────────────────────────────────
const PersonIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.7"/></svg>;
const ClipboardIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
const NoteIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
const FilterIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ColsIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>;

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PatientList() {
  const { division } = useOutletContext();
  const { data: patients, loading: pLoading } = usePatients();
  const { data: enriched, loading: eLoading } = usePipelineData();
  const { resolveMarketer, resolveSource, resolveFacility, resolvePhysician } = useLookups();
  const { open: openDrawer } = usePatientDrawer();
  const { appUserId } = useCurrentAppUser();
  const location = useLocation();
  const { can } = usePermissions();

  const [search, setSearch] = useState('');
  // Pre-populate stage filter when navigated here from the dashboard chart
  const [stageFilter, setStageFilter] = useState(location.state?.stageFilter || '');
  const [showActive, setShowActive] = useState(true);
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [noteTarget, setNoteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNewReferral, setShowNewReferral] = useState(false);

  // Column picker + filter row
  const [visibleCols, setVisibleCols] = useState(() => new Set(COLUMN_DEFS.filter((c) => c.defaultOn).map((c) => c.key)));
  const [showColPicker, setShowColPicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState({ ...DEFAULT_COL_FILTERS });

  const colPickerRef = useRef(null);

  const resolvers = useMemo(() => ({ resolveMarketer, resolveSource, resolveFacility, resolvePhysician }), [resolveMarketer, resolveSource, resolveFacility, resolvePhysician]);

  const activeColumns = useMemo(() => COLUMN_DEFS.filter((c) => visibleCols.has(c.key)), [visibleCols]);

  const hasAnyFilter = search.trim() || stageFilter || Object.values(colFilters).some((v) => v.trim());

  function clearAll() {
    setSearch('');
    setStageFilter('');
    setColFilters({ ...DEFAULT_COL_FILTERS });
  }

  function setColFilter(key, val) {
    setColFilters((prev) => ({ ...prev, [key]: val }));
  }

  // Latest enriched referral per patient
  const refByPatientId = useMemo(() => {
    const map = {};
    enriched.forEach((r) => {
      const pid = r.patient_id;
      if (!pid) return;
      if (!map[pid] || new Date(r.referral_date || 0) > new Date(map[pid].referral_date || 0)) map[pid] = r;
    });
    return map;
  }, [enriched]);

  // Unique values per filterable column — drives datalist suggestions
  const colOptions = useMemo(() => {
    const opts = {};
    COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      patients.forEach((p) => {
        const ref = refByPatientId[p.id];
        switch (col.key) {
          case 'division':
            if (p.division) vals.add(p.division);
            break;
          case 'stage':
            if (ref?.current_stage) vals.add(ref.current_stage);
            break;
          case 'marketer': {
            const v = resolveMarketer(ref?.marketer_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'insurance':
            if (p.insurance_plan) vals.add(p.insurance_plan);
            break;
          case 'referral_date':
            if (ref?.referral_date) vals.add(fmtDate(ref.referral_date));
            break;
          case 'referral_source': {
            const v = resolveSource(ref?.referral_source_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'facility': {
            const v = resolveFacility(ref?.facility_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
          case 'physician': {
            const v = resolvePhysician(ref?.physician_id);
            if (v && v !== '—') vals.add(v);
            break;
          }
        }
      });
      opts[col.key] = [...vals].sort((a, b) => a.localeCompare(b));
    });
    return opts;
  }, [patients, refByPatientId, resolveMarketer, resolveSource, resolveFacility, resolvePhysician]);

  const filtered = useMemo(() => {
    let list = patients.filter((p) => {
      if (division !== 'All' && p.division !== division) return false;
      if (showActive && p.is_active === 'FALSE') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${p.first_name} ${p.last_name}`.toLowerCase().includes(q) &&
            !(p.medicaid_number || '').toLowerCase().includes(q) &&
            !(p.medicare_number || '').toLowerCase().includes(q)) return false;
      }
      const ref = refByPatientId[p.id];
      if (stageFilter) {
        if (!ref || ref.current_stage !== stageFilter) return false;
      }
      // Per-column filters
      for (const [key, val] of Object.entries(colFilters)) {
        if (!val.trim()) continue;
        const q = val.toLowerCase();
        let cellVal = '';
        switch (key) {
          case 'division':       cellVal = (p.division || '').toLowerCase(); break;
          case 'stage':          cellVal = (ref?.current_stage || '').toLowerCase(); break;
          case 'marketer':       cellVal = resolveMarketer(ref?.marketer_id).toLowerCase(); break;
          case 'insurance':      cellVal = (p.insurance_plan || '').toLowerCase(); break;
          case 'referral_date':  cellVal = ref?.referral_date ? fmtDate(ref.referral_date).toLowerCase() : ''; break;
          case 'referral_source':cellVal = resolveSource(ref?.referral_source_id).toLowerCase(); break;
          case 'facility':       cellVal = resolveFacility(ref?.facility_id).toLowerCase(); break;
          case 'physician':      cellVal = resolvePhysician(ref?.physician_id).toLowerCase(); break;
        }
        if (!cellVal.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      let va = (a[sortField] || '').toString().toLowerCase();
      let vb = (b[sortField] || '').toString().toLowerCase();
      if (sortField === 'stage') {
        va = refByPatientId[a.id]?.current_stage || '';
        vb = refByPatientId[b.id]?.current_stage || '';
      }
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [patients, enriched, refByPatientId, division, search, stageFilter, showActive, sortField, sortDir, colFilters, resolveMarketer, resolveSource, resolveFacility, resolvePhysician]);

  function toggleSort(f) {
    if (sortField === f) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  }

  function buildPatient(row) {
    // Pass the full patient record — all fields are already on the object from useAirtable
    return { ...row };
  }

  function initiateTransition(row, toStage) {
    const ref = refByPatientId[row.id];
    if (!ref) return;
    setContextMenu(null);
    if (needsModal(ref.current_stage, toStage)) {
      setPendingTransition({ referral: ref, patient: row, toStage });
    } else {
      executeTransition(ref, row, toStage, '');
    }
  }

  async function executeTransition(referral, patient, toStage, note) {
    if (!can(PERMISSION_KEYS.REFERRAL_TRANSITION)) return;
    const fromStage = referral.current_stage;
    const enteredAt = new Date().toISOString();
    setTransitioning(true);
    setPendingTransition(null);

    const { effectiveStage, ntucMetadata, wasIntercepted } = resolveNtucDestination({
      requestedStage: toStage,
      fromStage,
      canDirect: () => can(PERMISSION_KEYS.REFERRAL_NTUC_DIRECT),
      userId: appUserId,
    });

    const updateFields = { current_stage: effectiveStage, ...ntucMetadata };
    if (effectiveStage === 'Hold' && note) updateFields.hold_reason = note;
    if (effectiveStage === 'NTUC' && note) updateFields.ntuc_reason = note;
    if (wasIntercepted && note) updateFields.ntuc_reason = note;
    try {
      await updateReferral(referral._id, updateFields);
      updateReferral(referral._id, { stage_entered_at: enteredAt }).catch(() => {});
      recordTransition({ referral, fromStage, toStage: effectiveStage, note, authorId: appUserId });
      triggerDataRefresh();
      showToast(wasIntercepted ? 'Sent to Admin Confirmation for NTUC review' : `Moved to ${effectiveStage}`);
    } catch {
      showToast('Stage change failed', 'error');
    } finally {
      setTransitioning(false);
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const colHdr = (col) => (
    <th
      key={col.key}
      onClick={col.sortField ? () => toggleSort(col.sortField) : undefined}
      title={col.tooltip || undefined}
      style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: col.sortField ? 'pointer' : col.tooltip ? 'help' : 'default', userSelect: 'none' }}
    >
      {col.label}
      {col.tooltip && <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 9 }}>ⓘ</span>}
      {col.sortField && sortField === col.sortField && (sortDir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  );

  if (pLoading || eLoading) return <LoadingState message="Loading patients…" />;

  return (
    <>
      <div style={{ padding: '22px 28px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={() => contextMenu && setContextMenu(null)}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}>Patients</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} of {patients.length} records</p>
          </div>
          {can(PERMISSION_KEYS.REFERRAL_CREATE) && (
            <button onClick={() => setShowNewReferral(true)} style={{ padding: '7px 16px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>+ New Referral</button>
          )}
        </div>

        {/* Filter / toolbar bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0, alignItems: 'center' }}>
          {/* Search — fixed width so typing never shifts neighbours */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 264, flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patients…"
              title="Search by name, Medicaid #, or Medicare #"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%', minWidth: 0 }}
            />
          </div>
          {/* Stage dropdown — fixed width so changing selection never resizes it */}
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ height: 34, width: 186, flexShrink: 0, padding: '0 10px', borderRadius: 8, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, fontFamily: 'inherit', color: palette.backgroundDark.hex, cursor: 'pointer' }}>
            <option value="">All Stages</option>
            {ALL_STAGE_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Active only */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.55), flexShrink: 0 }}>
            <input type="checkbox" checked={showActive} onChange={(e) => setShowActive(e.target.checked)} style={{ accentColor: palette.primaryMagenta.hex }} />
            Active only
          </label>

          <div style={{ flex: 1 }} />

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            title={showFilters ? 'Hide column filters' : 'Show column filters'}
            style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 550, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer', flexShrink: 0 }}
          >
            <FilterIcon /> Filters
          </button>

          {/* Column picker */}
          <div ref={colPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowColPicker((v) => !v)}
              title="Customize columns"
              style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, border: `1px solid ${showColPicker ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: showColPicker ? hexToRgba(palette.primaryMagenta.hex, 0.07) : palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 550, color: showColPicker ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}
            >
              <ColsIcon /> Columns
            </button>
            {showColPicker && (
              <ColumnPicker
                visibleCols={visibleCols}
                onChange={setVisibleCols}
                onClose={() => setShowColPicker(false)}
              />
            )}
          </div>

          {/* Clear all — always rendered so its presence/absence never shifts the row */}
          <button
            onClick={clearAll}
            style={{ height: 34, padding: '0 12px', borderRadius: 8, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 550, color: palette.primaryMagenta.hex, cursor: 'pointer', flexShrink: 0, visibility: hasAnyFilter ? 'visible' : 'hidden' }}
          >
            Clear all
          </button>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          {patients.length === 0 ? (
            <EmptyState title="No patients found" subtitle="No patient records exist yet." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                  {activeColumns.map(colHdr)}
                </tr>
                {showFilters && (
                  <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                    {activeColumns.map((col) => (
                      <th key={col.key} style={{ padding: '4px 8px' }}>
                        {col.filterable ? (
                          <>
                            <input
                              list={`col-opts-${col.key}`}
                              value={colFilters[col.key] || ''}
                              onChange={(e) => setColFilter(col.key, e.target.value)}
                              placeholder="Filter…"
                              style={{ width: '100%', padding: '4px 8px', borderRadius: 5, border: `1px solid ${colFilters[col.key]?.trim() ? palette.accentBlue.hex : 'var(--color-border)'}`, background: palette.backgroundLight.hex, fontSize: 11.5, color: palette.backgroundDark.hex, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                            />
                            <datalist id={`col-opts-${col.key}`}>
                              {(colOptions[col.key] || []).map((opt) => (
                                <option key={opt} value={opt} />
                              ))}
                            </datalist>
                          </>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length} style={{ padding: '40px 20px', textAlign: 'center' }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 4 }}>No results</p>
                      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                        {search ? `No patients match "${search}"` : 'No patients match the current filters.'}
                        {' '}
                        <button onClick={clearAll} style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: palette.accentBlue.hex, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button>
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((patient) => {
                    const ref = refByPatientId[patient.id];
                    const days = ref ? daysInStage(ref.updated_at) : null;
                    return (
                      <PatientRow
                        key={patient._id}
                        patient={patient}
                        referral={ref}
                        days={days}
                        resolvers={resolvers}
                        activeColumns={activeColumns}
                        onDoubleClick={() => openDrawer(buildPatient(patient), ref || null)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            patientId: patient.id,
                            currentStage: ref?.current_stage,
                            division: patient.division,
                            patientName: `${patient.first_name} ${patient.last_name}`.trim(),
                          });
                        }}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const pid = contextMenu.patientId;
        const p   = patients.find((pt) => pt.id === pid);
        const r   = refByPatientId[pid];
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            row={{ patientName: contextMenu.patientName, current_stage: contextMenu.currentStage, division: contextMenu.division }}
            onOpen={() => { if (p) openDrawer(buildPatient(p), r || null); setContextMenu(null); }}
            onTriage={() => { if (p) openDrawer(buildPatient(p), r || null, 'triage'); setContextMenu(null); }}
            onNote={() => { if (p) setNoteTarget({ patient: p, referral: r }); setContextMenu(null); }}
            onStageChange={(toStage) => { if (p) initiateTransition(p, toStage); setContextMenu(null); }}
            onDismiss={() => setContextMenu(null)}
          />
        );
      })()}

      {/* Transition modal */}
      {pendingTransition && (
        <TransitionModal
          referral={pendingTransition.referral}
          toStage={pendingTransition.toStage}
          loading={transitioning}
          onConfirm={(note) => executeTransition(pendingTransition.referral, pendingTransition.patient, pendingTransition.toStage, note)}
          onCancel={() => setPendingTransition(null)}
        />
      )}

      {/* New referral */}
      {showNewReferral && (
        <NewReferralForm
          onClose={() => setShowNewReferral(false)}
          onSuccess={({ patient, referral }) => {
            triggerDataRefresh();
            openDrawer(buildPatient(patient), referral);
          }}
        />
      )}

      {/* Quick note modal */}
      {noteTarget && (
        <QuickNoteModal
          patient={noteTarget.patient}
          referral={noteTarget.referral}
          onClose={() => setNoteTarget(null)}
          onSaved={() => triggerDataRefresh()}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: toast.type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}

// ── Patient row ────────────────────────────────────────────────────────────────
function PatientRow({ patient, referral, days, resolvers, activeColumns, onDoubleClick, onContextMenu }) {
  const [hovered, setHovered] = useState(false);
  const { resolveMarketer, resolveSource, resolveFacility, resolvePhysician } = resolvers;

  const renderCell = (col) => {
    switch (col.key) {
      case 'patient':
        return (
          <td key="patient" style={{ padding: '11px 14px' }}>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 1 }}>{patient.first_name} {patient.last_name}</p>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>
              {patient.medicaid_number ? `Medicaid: ${patient.medicaid_number}` : patient.medicare_number ? `Medicare: ${patient.medicare_number}` : patient.dob ? `Age ${Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400000))}` : ''}
            </p>
          </td>
        );
      case 'division':
        return <td key="division" style={{ padding: '11px 14px' }}><DivisionBadge division={patient.division} size="small" /></td>;
      case 'stage':
        return (
          <td key="stage" style={{ padding: '11px 14px' }}>
            {referral?.current_stage ? <StageBadge stage={referral.current_stage} size="small" /> : <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>}
          </td>
        );
      case 'f2f':
        return <td key="f2f" style={{ padding: '11px 14px' }}><F2FCell referral={referral} /></td>;
      case 'days':
        return (
          <td key="days" style={{ padding: '11px 14px' }}>
            {days !== null ? (
              <span style={{ fontSize: 12.5, fontWeight: days > 14 ? 650 : 400, color: days > 14 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}>
                {days === 0 ? 'Today' : `${days}d`}
              </span>
            ) : <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>}
          </td>
        );
      case 'marketer':
        return (
          <td key="marketer" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {referral?.marketer_id ? resolveMarketer(referral.marketer_id) : '—'}
          </td>
        );
      case 'insurance':
        return (
          <td key="insurance" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {patient.insurance_plan || '—'}
          </td>
        );
      case 'referral_date':
        return (
          <td key="referral_date" style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {referral?.referral_date ? fmtDate(referral.referral_date) : '—'}
          </td>
        );
      case 'referral_source':
        return (
          <td key="referral_source" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {referral?.referral_source_id ? resolveSource(referral.referral_source_id) : '—'}
          </td>
        );
      case 'facility':
        return (
          <td key="facility" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {referral?.facility_id ? resolveFacility(referral.facility_id) : '—'}
          </td>
        );
      case 'physician':
        return (
          <td key="physician" style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
            {referral?.physician_id ? resolvePhysician(referral.physician_id) : '—'}
          </td>
        );
      default:
        return <td key={col.key} />;
    }
  };

  return (
    <tr
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Double-click to open · Right-click for options"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent', cursor: 'default', transition: 'background 0.1s' }}
    >
      {activeColumns.map(renderCell)}
    </tr>
  );
}
