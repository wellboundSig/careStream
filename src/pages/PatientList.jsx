import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePatients } from '../hooks/usePatients.js';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useLookups } from '../hooks/useLookups.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { updateReferral } from '../api/referrals.js';
import { saveTransitionNote } from '../utils/saveTransitionNote.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import StageRules from '../data/StageRules.json';
import TransitionModal from '../components/pipeline/TransitionModal.jsx';
import QuickNoteModal from '../components/patients/QuickNoteModal.jsx';
import NewReferralForm from '../components/forms/NewReferralForm.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const ALL_STAGE_ORDER = ['Lead Entry','Intake','Eligibility Verification','Disenrollment Required','F2F/MD Orders Pending','Clinical Intake RN Review','Authorization Pending','Conflict','Staffing Feasibility','Admin Confirmation','Pre-SOC','SOC Scheduled','SOC Completed','Hold','NTUC'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function calcAge(dob) {
  if (!dob) return '—';
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}
function daysInStage(updatedAt) {
  if (!updatedAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
}
function canMoveFromTo(from, to) {
  if (from === to) return false;
  const r = StageRules.stages[from];
  if (!r || r.terminal) return false;
  if (to === 'Hold' && StageRules.globalRules.anyActiveStageCanMoveToHold) return true;
  return r.canMoveTo?.includes(to) ?? false;
}
function needsModal(from, to) {
  const r = StageRules.stages[from];
  const t = StageRules.stages[to];
  return !!(r?.requiresNote || r?.protectedExit || to === 'Hold' || to === 'NTUC' || t?.destinationPrompt);
}

// ── F2F Countdown cell ────────────────────────────────────────────────────────
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

// ── Context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, row, onOpen, onTriage, onNote, onStageChange, onDismiss }) {
  const isSN = row.division === 'Special Needs';
  const currentStage = row.current_stage;
  const validStages = currentStage
    ? ALL_STAGE_ORDER.filter((s) => canMoveFromTo(currentStage, s))
    : [];

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
      <div style={{ position: 'fixed', top: y, left: x, zIndex: 9991, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 10, overflow: 'hidden', minWidth: 220, boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.13)}` }}>
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

// ── Tiny SVG icons ─────────────────────────────────────────────────────────────
const PersonIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.7"/></svg>;
const ClipboardIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
const NoteIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PatientList() {
  const { division } = useOutletContext();
  const { data: patients, loading: pLoading } = usePatients();
  const { data: enriched, loading: eLoading } = usePipelineData();
  const { resolveMarketer } = useLookups();
  const { open: openDrawer } = usePatientDrawer();
  const { appUserId } = useCurrentAppUser();

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showActive, setShowActive] = useState(true);
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [noteTarget, setNoteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNewReferral, setShowNewReferral] = useState(false);

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
      if (stageFilter) {
        const ref = refByPatientId[p.id];
        if (!ref || ref.current_stage !== stageFilter) return false;
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
  }, [patients, enriched, refByPatientId, division, search, stageFilter, showActive, sortField, sortDir]);

  function toggleSort(f) {
    if (sortField === f) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  }

  function buildPatient(row) {
    return { id: row.id, _id: row._id, first_name: row.first_name, last_name: row.last_name, dob: row.dob, division: row.division, medicaid_number: row.medicaid_number };
  }

  // Transition machinery
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
    setTransitioning(true);
    setPendingTransition(null);
    const updateFields = { current_stage: toStage };
    if (toStage === 'Hold' && note) updateFields.hold_reason = note;
    if (toStage === 'NTUC' && note) updateFields.ntuc_reason = note;
    try {
      await updateReferral(referral._id, updateFields);
      if (note?.trim()) await saveTransitionNote({ referral, fromStage: referral.current_stage, toStage, note, authorId: appUserId });
      triggerDataRefresh();
      showToast(`Moved to ${toStage}`);
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

  const colHdr = (label, field) => (
    <th onClick={field ? () => toggleSort(field) : undefined} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default', userSelect: 'none' }}>
      {label} {field && sortField === field && (sortDir === 'asc' ? '▲' : '▼')}
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
          <button onClick={() => setShowNewReferral(true)} style={{ padding: '7px 16px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>+ New Referral</button>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, flex: 1, maxWidth: 300 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Medicaid #, Medicare #…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 8, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}>
            <option value="">All Stages</option>
            {ALL_STAGE_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
            <input type="checkbox" checked={showActive} onChange={(e) => setShowActive(e.target.checked)} style={{ accentColor: palette.primaryMagenta.hex }} />
            Active only
          </label>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', background: palette.backgroundLight.hex, borderRadius: 12, border: `1px solid var(--color-border)`, boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          {filtered.length === 0 ? (
            <EmptyState title="No patients found" subtitle={search ? `No results for "${search}"` : 'No patients match the current filters.'} />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                  {colHdr('Patient', 'last_name')}
                  {colHdr('Division', 'division')}
                  {colHdr('Stage', 'stage')}
                  {colHdr('F2F', null)}
                  {colHdr('Days', null)}
                  {colHdr('Marketer', null)}
                  {colHdr('Insurance', 'insurance_plan')}
                  {colHdr('Referral Date', null)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => {
                  const ref = refByPatientId[patient.id];
                  const days = ref ? daysInStage(ref.updated_at) : null;
                  return (
                    <PatientRow
                      key={patient._id}
                      patient={patient}
                      referral={ref}
                      days={days}
                      resolveMarketer={resolveMarketer}
                      onDoubleClick={() => openDrawer(buildPatient(patient), ref || null)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        // Clamp so menu never goes off-screen
                        const x = Math.min(e.clientX, window.innerWidth - 250);
                        const y = Math.min(e.clientY, window.innerHeight - 300);
                        setContextMenu({
                          x, y,
                          patientId: patient.id,        // store separately to avoid id collision with referral
                          currentStage: ref?.current_stage,
                          division: patient.division,
                          patientName: `${patient.first_name} ${patient.last_name}`.trim(),
                        });
                      }}
                    />
                  );
                })}
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

// ── Patient row ───────────────────────────────────────────────────────────────
function PatientRow({ patient, referral, days, resolveMarketer, onDoubleClick, onContextMenu }) {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Double-click to open · Right-click for options"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent', cursor: 'default', transition: 'background 0.1s' }}
    >
      <td style={{ padding: '11px 14px' }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 1 }}>{patient.first_name} {patient.last_name}</p>
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>
          {patient.medicaid_number ? `Medicaid: ${patient.medicaid_number}` : patient.medicare_number ? `Medicare: ${patient.medicare_number}` : patient.dob ? `Age ${Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400000))}` : ''}
        </p>
      </td>
      <td style={{ padding: '11px 14px' }}><DivisionBadge division={patient.division} size="small" /></td>
      <td style={{ padding: '11px 14px' }}>
        {referral?.current_stage ? <StageBadge stage={referral.current_stage} size="small" /> : <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>—</span>}
      </td>
      <td style={{ padding: '11px 14px' }}><F2FCell referral={referral} /></td>
      <td style={{ padding: '11px 14px' }}>
        {days !== null ? (
          <span style={{ fontSize: 12.5, fontWeight: days > 14 ? 650 : 400, color: days > 14 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}>
            {days === 0 ? 'Today' : `${days}d`}
          </span>
        ) : <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
        {referral?.marketer_id ? resolveMarketer(referral.marketer_id) : '—'}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
        {patient.insurance_plan || '—'}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
        {referral?.referral_date ? new Date(referral.referral_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
      </td>
    </tr>
  );
}
