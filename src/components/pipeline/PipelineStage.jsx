import { useState } from 'react';
import PipelineCard from './PipelineCard.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STAGE_ACCENT = {
  'Lead Entry': palette.accentBlue.hex,
  'Intake': palette.accentBlue.hex,
  'Eligibility Verification': palette.accentOrange.hex,
  'Disenrollment Required': palette.highlightYellow.hex,
  'F2F/MD Orders Pending': palette.accentOrange.hex,
  'Clinical Intake RN Review': palette.primaryMagenta.hex,
  'Authorization Pending': palette.accentOrange.hex,
  'Conflict': palette.primaryMagenta.hex,
  'Staffing Feasibility': palette.accentBlue.hex,
  'Admin Confirmation': palette.primaryDeepPlum.hex,
  'Pre-SOC': palette.accentGreen.hex,
  'SOC Scheduled': palette.accentGreen.hex,
  'SOC Completed': palette.accentGreen.hex,
  'Hold': palette.highlightYellow.hex,
  'NTUC': hexToRgba(palette.backgroundDark.hex, 0.35),
};

export default function PipelineStage({
  stage,
  cards,
  canAcceptDrop,
  isBeingDragged,
  activeDragFromStage,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onDrop,
  onInitiateTransition,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const isGlobal = stage === 'Hold' || stage === 'NTUC';
  const isTerminal = stage === 'SOC Completed' || stage === 'NTUC';
  const accentColor = STAGE_ACCENT[stage] || palette.accentBlue.hex;

  const dropAllowed = isDragOver && canAcceptDrop;
  const dropBlocked = isDragOver && !canAcceptDrop;

  let borderColor = hexToRgba(palette.backgroundDark.hex, 0.1);
  if (dropAllowed) borderColor = palette.primaryMagenta.hex;
  if (dropBlocked) borderColor = hexToRgba(palette.primaryMagenta.hex, 0.3);

  let bgColor = isGlobal
    ? hexToRgba(palette.backgroundDark.hex, 0.02)
    : palette.backgroundLight.hex;
  if (dropAllowed) bgColor = hexToRgba(palette.primaryMagenta.hex, 0.04);
  if (dropBlocked) bgColor = hexToRgba(palette.backgroundDark.hex, 0.02);
  if (isTerminal && !isDragOver) bgColor = hexToRgba(palette.backgroundDark.hex, 0.025);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = canAcceptDrop ? 'move' : 'none';
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (canAcceptDrop) onDrop(stage);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderTop: `3px solid ${isTerminal ? hexToRgba(palette.backgroundDark.hex, 0.15) : accentColor}`,
        borderRadius: 10,
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: dropAllowed
          ? `0 0 0 2px ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`
          : `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <StageHeader
        stage={stage}
        count={cards.length}
        isGlobal={isGlobal}
        isTerminal={isTerminal}
        accentColor={accentColor}
        dropAllowed={dropAllowed}
        dropBlocked={dropBlocked}
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          minHeight: 60,
        }}
      >
        {cards.map((ref) => (
          <PipelineCard
            key={ref._id}
            referral={ref}
            isDragging={isBeingDragged?.(ref._id)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onContextMenu={onContextMenu}
          />
        ))}

        {cards.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 8px',
              borderRadius: 6,
              border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
              fontSize: 11,
              color: hexToRgba(palette.backgroundDark.hex, 0.25),
              textAlign: 'center',
              minHeight: 48,
            }}
          >
            {dropAllowed ? 'Drop here' : isTerminal ? 'Terminal' : 'Empty'}
          </div>
        )}
      </div>
    </div>
  );
}

function StageHeader({ stage, count, isGlobal, isTerminal, accentColor, dropAllowed, dropBlocked }) {
  return (
    <div
      style={{
        padding: '8px 10px 7px',
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        {isGlobal && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: hexToRgba(palette.backgroundDark.hex, 0.35),
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              borderRadius: 4,
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            Global
          </span>
        )}
        {isTerminal && !isGlobal && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: hexToRgba(palette.accentGreen.hex, 0.8),
              background: hexToRgba(palette.accentGreen.hex, 0.1),
              borderRadius: 4,
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            Final
          </span>
        )}
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 650,
            color: isTerminal
              ? hexToRgba(palette.backgroundDark.hex, 0.45)
              : palette.backgroundDark.hex,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={stage}
        >
          {stage}
        </span>
      </div>

      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          minWidth: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          flexShrink: 0,
          background: dropAllowed
            ? hexToRgba(palette.primaryMagenta.hex, 0.15)
            : count > 0
            ? hexToRgba(accentColor, 0.12)
            : hexToRgba(palette.backgroundDark.hex, 0.05),
          color: dropAllowed
            ? palette.primaryMagenta.hex
            : count > 0
            ? accentColor
            : hexToRgba(palette.backgroundDark.hex, 0.3),
          transition: 'all 0.15s',
          padding: '0 6px',
        }}
      >
        {count}
      </span>
    </div>
  );
}
