import { useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import { updateReferralOptimistic } from '../store/mutations.js';
import { recordTransition } from '../utils/recordTransition.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import StageRules from '../data/StageRules.json';

import PipelineStage from '../components/pipeline/PipelineStage.jsx';
import ContextMenu from '../components/pipeline/ContextMenu.jsx';
import TransitionModal from '../components/pipeline/TransitionModal.jsx';
import NewReferralForm from '../components/forms/NewReferralForm.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

// ── Stage layout ───────────────────────────────────────────────────────────────
// Primary workflow is broken into three labeled row groups. Hold and NTUC live
// in a separate Status section so they don't compete visually with active stages.
const ROW_GROUPS = [
  {
    label: 'Intake & Eligibility',
    color: palette.accentBlue.hex,
    stages: ['Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required', 'F2F/MD Orders Pending'],
  },
  {
    label: 'Clinical Review',
    color: palette.primaryMagenta.hex,
    stages: ['Clinical Intake RN Review', 'Authorization Pending', 'Conflict', 'Staffing Feasibility', 'Admin Confirmation'],
  },
  {
    label: 'Admission',
    color: palette.accentGreen.hex,
    stages: ['Pre-SOC', 'SOC Scheduled', 'SOC Completed'],
  },
];

const STATUS_GROUP = {
  label: 'Status',
  color: hexToRgba(palette.backgroundDark.hex, 0.3),
  stages: ['Hold', 'NTUC'],
};

function canMoveFromTo(fromStage, toStage) {
  if (fromStage === toStage) return false;
  const fromRule = StageRules.stages[fromStage];
  if (!fromRule || fromRule.terminal) return false;
  if (toStage === 'Hold' && StageRules.globalRules.anyActiveStageCanMoveToHold) return true;
  return fromRule.canMoveTo?.includes(toStage) ?? false;
}

function needsModal(fromStage, toStage) {
  const fromRule = StageRules.stages[fromStage];
  const toRule   = StageRules.stages[toStage];
  return !!(
    fromRule?.requiresNote ||
    fromRule?.protectedExit ||
    toStage === 'Hold' ||
    toStage === 'NTUC' ||
    toRule?.destinationPrompt
  );
}

export default function PipelineBoard() {
  const { division } = useOutletContext();
  const { data: enriched, loading } = usePipelineData();
  const { appUserId } = useCurrentAppUser();
  const { open: openPatient } = usePatientDrawer();

  const [draggingId, setDraggingId] = useState(null);
  const [draggingFrom, setDraggingFrom] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // No local copy needed — the zustand store IS the local state.
  // enriched already reads from memory (sub-ms), and optimistic
  // mutations update the store directly.
  const filtered = useMemo(
    () =>
      division === 'All'
        ? enriched
        : enriched.filter((r) => r.division === division),
    [enriched, division],
  );

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const initiateTransition = useCallback((referral, toStage) => {
    setContextMenu(null);
    if (!canMoveFromTo(referral.current_stage, toStage)) return;
    if (needsModal(referral.current_stage, toStage)) {
      setPendingTransition({ referral, toStage });
    } else {
      executeTransition(referral, toStage, '');
    }
  }, []);

  function executeTransition(referral, toStage, note) {
    const fromStage = referral.current_stage;
    setPendingTransition(null);

    const updateFields = { current_stage: toStage };
    if (toStage === 'Hold' && note) updateFields.hold_reason = note;
    if (toStage === 'NTUC' && note) updateFields.ntuc_reason = note;

    // Optimistic: store updates in 1ms, card moves instantly.
    // Background Airtable write rolls back on failure.
    updateReferralOptimistic(referral._id, updateFields).catch(() => {
      showToast(`Failed to move ${referral.patientName || referral.patient_id} — reverted`, 'error');
    });

    recordTransition({ referral, fromStage, toStage, note, authorId: appUserId });
    showToast(`${referral.patientName || referral.patient_id} moved to ${toStage}`);
  }

  function handleDragStart(referral) {
    setDraggingId(referral._id);
    setDraggingFrom(referral.current_stage);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDraggingFrom(null);
  }

  function handleDrop(toStage) {
    const referral = enriched.find((r) => r._id === draggingId);
    if (!referral || !canMoveFromTo(draggingFrom, toStage)) return;
    initiateTransition(referral, toStage);
    handleDragEnd();
  }

  function handleContextMenu(e, referral) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, referral });
  }

  function dismissContextMenu() {
    setContextMenu(null);
  }

  function handleRefetch() {
    triggerDataRefresh();
  }

  const totalActive = filtered.filter(
    (r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed',
  ).length;

  if (loading) return <LoadingState message="Loading pipeline..." />;

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: palette.backgroundLight.hex }}
      onClick={dismissContextMenu}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          padding:        '14px 20px 12px',
          flexShrink:     0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          borderBottom:   `1px solid var(--color-border)`,
          gap:            12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}>
            Pipeline Board
          </h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {totalActive} active&nbsp;&middot;&nbsp;
            {division === 'All' ? 'All divisions' : division}&nbsp;&middot;&nbsp;
            Drag cards or right-click for options
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
            Live sync active
          </span>

          <ToolbarBtn
            onClick={() => setShowLegend((v) => !v)}
            active={showLegend}
            title="Toggle indicator legend"
          >
            <InfoIcon /> Legend
          </ToolbarBtn>

          <ToolbarBtn onClick={handleRefetch} title="Refresh data">
            <RefreshIcon /> Refresh
          </ToolbarBtn>

          <button
            onClick={() => setShowNewReferral(true)}
            style={{
              height:       32,
              padding:      '0 14px',
              borderRadius: 7,
              background:   palette.primaryMagenta.hex,
              border:       'none',
              fontSize:     12,
              fontWeight:   650,
              color:        palette.backgroundLight.hex,
              cursor:       'pointer',
            }}
          >
            + New Referral
          </button>
        </div>
      </div>

      {/* ── Legend strip ── */}
      {showLegend && (
        <div
          style={{
            padding:      '10px 20px',
            borderBottom: `1px solid var(--color-border)`,
            background:   hexToRgba(palette.backgroundDark.hex, 0.018),
            display:      'flex',
            gap:          28,
            flexWrap:     'wrap',
            flexShrink:   0,
            alignItems:   'flex-start',
          }}
        >
          <LegendGroup label="Priority">
            <LegendDot color={palette.primaryMagenta.hex} label="Critical" />
            <LegendDot color={palette.accentOrange.hex}   label="High" />
          </LegendGroup>

          <LegendGroup label="F2F Authorization">
            <LegendDot color={palette.accentGreen.hex}    label="Current (>30d)" />
            <LegendDot color={palette.accentOrange.hex}   label="Expiring ≤14d" />
            <LegendDot color={palette.primaryMagenta.hex} label="Expired" />
          </LegendGroup>

          <LegendGroup label="Days in Stage">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
              <span style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentOrange.hex }}>14d+</span>
              overdue — needs attention
            </span>
          </LegendGroup>

          <LegendGroup label="Column Tags">
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Status</strong>
              &nbsp;= can receive from any active stage &nbsp;·&nbsp;
              <strong style={{ color: hexToRgba(palette.accentGreen.hex, 0.8) }}>Final</strong>
              &nbsp;= terminal — referral admitted
            </span>
          </LegendGroup>
        </div>
      )}

      {/* ── Board ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 30, minWidth: 900 }}>

          {/* Primary row groups */}
          {ROW_GROUPS.map(({ label, color, stages }) => (
            <section key={label}>
              <RowGroupLabel label={label} color={color} />
              <div
                style={{
                  display:             'grid',
                  gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
                  gap:                 14,
                  minHeight:           200,
                }}
              >
                {stages.map((stage) => (
                  <PipelineStage
                    key={stage}
                    stage={stage}
                    cards={filtered.filter((r) => r.current_stage === stage)}
                    canAcceptDrop={draggingId ? canMoveFromTo(draggingFrom, stage) : false}
                    isBeingDragged={(id) => id === draggingId}
                    activeDragFromStage={draggingFrom}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onContextMenu={handleContextMenu}
                    onDrop={handleDrop}
                    onInitiateTransition={initiateTransition}
                    onAddReferral={stage === 'Lead Entry' ? () => setShowNewReferral(true) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Status section */}
          <section>
            <RowGroupLabel label={STATUS_GROUP.label} color={STATUS_GROUP.color} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, minHeight: 100 }}>
              {STATUS_GROUP.stages.map((stage) => (
                <PipelineStage
                  key={stage}
                  stage={stage}
                  cards={filtered.filter((r) => r.current_stage === stage)}
                  canAcceptDrop={draggingId ? canMoveFromTo(draggingFrom, stage) : false}
                  isBeingDragged={(id) => id === draggingId}
                  activeDragFromStage={draggingFrom}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onContextMenu={handleContextMenu}
                  onDrop={handleDrop}
                  onInitiateTransition={initiateTransition}
                />
              ))}
            </div>
          </section>

        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          referral={contextMenu.referral}
          onSelect={(toStage) => initiateTransition(contextMenu.referral, toStage)}
          onDismiss={dismissContextMenu}
        />
      )}

      {pendingTransition && (
        <TransitionModal
          referral={pendingTransition.referral}
          toStage={pendingTransition.toStage}
          loading={false}
          onConfirm={(note) => executeTransition(pendingTransition.referral, pendingTransition.toStage, note)}
          onCancel={() => setPendingTransition(null)}
        />
      )}

      {showNewReferral && (
        <NewReferralForm
          onClose={() => setShowNewReferral(false)}
          onSuccess={({ patient, referral }) => {
            triggerDataRefresh();
            openPatient(patient, referral);
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RowGroupLabel({ label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span
        style={{
          width:        3,
          height:       14,
          borderRadius: 2,
          background:   color,
          flexShrink:   0,
          display:      'inline-block',
        }}
      />
      <span
        style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color:         hexToRgba(palette.backgroundDark.hex, 0.38),
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />
    </div>
  );
}

function LegendGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 2 }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height:      32,
        padding:     '0 14px',
        borderRadius: 7,
        border:      `1px solid ${active ? palette.accentBlue.hex : 'var(--color-border)'}`,
        background:  active ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none',
        fontSize:    12,
        fontWeight:  600,
        color:       active ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
        cursor:      'pointer',
        display:     'flex',
        alignItems:  'center',
        gap:         6,
      }}
    >
      {children}
    </button>
  );
}

function Toast({ message, type }) {
  return (
    <div
      style={{
        position:      'fixed',
        bottom:        24,
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        9997,
        background:    type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
        color:         palette.backgroundLight.hex,
        padding:       '10px 20px',
        borderRadius:  8,
        fontSize:      13,
        fontWeight:    550,
        boxShadow:     `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        pointerEvents: 'none',
        whiteSpace:    'nowrap',
        maxWidth:      '80vw',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
      }}
    >
      {message}
    </div>
  );
}

// ── Tiny icons ─────────────────────────────────────────────────────────────────
const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.51 15a9 9 0 1 0 .49-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const InfoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
