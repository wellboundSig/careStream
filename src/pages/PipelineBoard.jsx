import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { updateReferral } from '../api/referrals.js';
import { saveTransitionNote } from '../utils/saveTransitionNote.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import StageRules from '../data/StageRules.json';

import PipelineStage from '../components/pipeline/PipelineStage.jsx';
import ContextMenu from '../components/pipeline/ContextMenu.jsx';
import TransitionModal from '../components/pipeline/TransitionModal.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

const STAGE_GRID = [
  ['Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required', 'F2F/MD Orders Pending'],
  ['Clinical Intake RN Review', 'Authorization Pending', 'Conflict', 'Staffing Feasibility', 'Admin Confirmation'],
  ['Pre-SOC', 'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC'],
];

const ALL_STAGES = STAGE_GRID.flat();

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
  const { data: enriched, loading, refetch } = usePipelineData();
  const { appUserId } = useCurrentAppUser();

  const [localReferrals, setLocalReferrals] = useState([]);
  const [draggingId, setDraggingId] = useState(null);
  const [draggingFrom, setDraggingFrom] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (enriched.length) setLocalReferrals(enriched);
  }, [enriched]);

  const filtered = useMemo(
    () =>
      division === 'All'
        ? localReferrals
        : localReferrals.filter((r) => r.division === division),
    [localReferrals, division]
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

  async function executeTransition(referral, toStage, note) {
    const fromStage = referral.current_stage;
    setTransitioning(true);

    setLocalReferrals((prev) =>
      prev.map((r) => (r._id === referral._id ? { ...r, current_stage: toStage } : r))
    );
    setPendingTransition(null);

    const updateFields = { current_stage: toStage };
    if (toStage === 'Hold' && note) updateFields.hold_reason = note;
    if (toStage === 'NTUC' && note) updateFields.ntuc_reason = note;

    try {
      await updateReferral(referral._id, updateFields);
      // Persist the transition note on the patient's profile
      if (note?.trim()) {
        await saveTransitionNote({ referral, fromStage, toStage, note, authorId: appUserId });
        triggerDataRefresh();
      }
      showToast(`${referral.patientName || referral.patient_id} moved to ${toStage}`);
    } catch {
      setLocalReferrals((prev) =>
        prev.map((r) => (r._id === referral._id ? { ...r, current_stage: fromStage } : r))
      );
      showToast(`Failed to move ${referral.patientName || referral.patient_id}`, 'error');
    } finally {
      setTransitioning(false);
    }
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
    const referral = localReferrals.find((r) => r._id === draggingId);
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

  const totalActive = filtered.filter(
    (r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed'
  ).length;

  if (loading) return <LoadingState message="Loading pipeline..." />;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: palette.backgroundLight.hex,
      }}
      onClick={dismissContextMenu}
    >
      <div
        style={{
          padding: '18px 20px 14px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid var(--color-border)`,
        }}
      >
        <div>
          <h1
            style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}
          >
            Pipeline Board
          </h1>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {totalActive} active &nbsp;&middot;&nbsp;{' '}
            {division === 'All' ? 'All divisions' : division} &nbsp;&middot;&nbsp;{' '}
            Drag cards between stages or right-click for options
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={refetch}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 7,
              border: `1px solid var(--color-border)`,
              background: 'none',
              fontSize: 12,
              fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.6),
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.51 15a9 9 0 1 0 .49-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '18px 27px 27px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            gap: 17,
            height: '100%',
            minHeight: 720,
          }}
        >
          {STAGE_GRID.flat().map((stage) => (
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
          loading={transitioning}
          onConfirm={(note) =>
            executeTransition(pendingTransition.referral, pendingTransition.toStage, note)
          }
          onCancel={() => setPendingTransition(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} />
      )}
    </div>
  );
}

function Toast({ message, type }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9997,
        background: type === 'error' ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
        color: palette.backgroundLight.hex,
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 550,
        boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        maxWidth: '80vw',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {message}
    </div>
  );
}
