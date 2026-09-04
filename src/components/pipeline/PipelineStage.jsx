import { useState, useRef } from 'react';
import PipelineCard from './PipelineCard.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import { STAGE_META } from '../../data/stageConfig.js';
import { useProgressiveReveal } from '../../hooks/useProgressiveReveal.js';

/** Visible cards per column before the inner scrollbar takes over. */
const VISIBLE_CARDS = 3;
const CARD_SLOT = 88;
const CARD_GAP = 5;
const LIST_PAD_Y = 12;
const LIST_HEIGHT = VISIBLE_CARDS * CARD_SLOT + (VISIBLE_CARDS - 1) * CARD_GAP + LIST_PAD_Y;

const STAGE_ACCENT = {
  'Clinical Lead Pre-Check':   palette.primaryDeepPlum.hex,
  'Lead Entry':                palette.accentBlue.hex,
  'Intake':                    palette.accentBlue.hex,
  'Eligibility Verification':  palette.accentOrange.hex,
  'Disenrollment Required':    palette.accentOrange.hex,
  'F2F/MD Orders Pending':     palette.accentOrange.hex,
  'Clinical Intake RN Review': palette.primaryMagenta.hex,
  'Authorization Pending':     palette.accentOrange.hex,
  'Conflict':                  palette.primaryMagenta.hex,
  'Staffing Feasibility':      palette.accentBlue.hex,
  'Admin Confirmation':        palette.primaryDeepPlum.hex,
  'Pre-SOC':                   palette.accentGreen.hex,
  'SOC Scheduled':             palette.accentGreen.hex,
  'SOC Completed':             palette.accentGreen.hex,
  'Post Visit Intake':         palette.accentBlue.hex,
  'Post Visit Clinical Review': palette.primaryMagenta.hex,
  'Completed':                 palette.accentGreen.hex,
  'Hold':                      palette.highlightYellow.hex,
  'NTUC':                      hexToRgba(palette.backgroundDark.hex, 0.35),
};

// Contextual empty-state messages per stage
const EMPTY_HINTS = {
  'Clinical Lead Pre-Check':   'Awaiting clinical glance',
  'Lead Entry':                'New referrals land here',
  'Intake':                    'Drag from Lead Entry',
  'Eligibility Verification':  'Awaiting eligibility check',
  'Disenrollment Required':    'No disenrollments pending',
  'F2F/MD Orders Pending':     'Awaiting F2F or MD orders',
  'Clinical Intake RN Review': 'No RN reviews queued',
  'Authorization Pending':     'No authorizations pending',
  'Conflict':                  'No conflicts — all clear',
  'Staffing Feasibility':      'No staffing reviews',
  'Admin Confirmation':        'Nothing to confirm',
  'Pre-SOC':                   'Awaiting pre-SOC prep',
  'SOC Scheduled':             'No SOCs scheduled',
  'SOC Completed':             'No completed visits',
  'Post Visit Intake':         'No post-visit paperwork',
  'Post Visit Clinical Review': 'No post-visit reviews',
  'Completed':                 'No completed cases',
  'Hold':                      'No referrals on hold',
  'NTUC':                      'No closed referrals',
};

export default function PipelineStage({
  stage,
  cards,
  canAcceptDrop,
  draggingId,
  activeDragFromStage,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onDrop,
  onInitiateTransition,
  onAddReferral,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const listRef = useRef(null);
  const reveal = useProgressiveReveal(cards, {
    resetKey: stage,
    rootRef: listRef,
  });

  const isStatus   = stage === 'Hold' || stage === 'NTUC';
  const isTerminal = stage === 'Completed' || stage === 'NTUC';
  const accentColor = STAGE_ACCENT[stage] || palette.accentBlue.hex;

  const dropAllowed = isDragOver && canAcceptDrop;
  const dropBlocked = isDragOver && !canAcceptDrop;

  let borderColor = hexToRgba(palette.backgroundDark.hex, 0.1);
  if (dropAllowed) borderColor = palette.primaryMagenta.hex;
  if (dropBlocked) borderColor = hexToRgba(palette.primaryMagenta.hex, 0.3);

  let bgColor = isStatus
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
        if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (canAcceptDrop) onDrop(stage);
      }}
      style={{
        display:        'flex',
        flexDirection:  'column',
        background:     bgColor,
        borderTop:      `3px solid ${isTerminal ? hexToRgba(palette.backgroundDark.hex, 0.15) : accentColor}`,
        borderRight:    `1px solid ${borderColor}`,
        borderBottom:   `1px solid ${borderColor}`,
        borderLeft:     `1px solid ${borderColor}`,
        borderRadius:   10,
        transition:     'border-color 0.15s, background 0.15s',
        boxShadow:      dropAllowed ? `0 0 0 2px ${hexToRgba(palette.primaryMagenta.hex, 0.25)}` : 'none',
        overflow:       'hidden',
        minHeight:      0,
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${LIST_HEIGHT + 40}px`,
      }}
    >
      <StageHeader
        stage={stage}
        count={cards.length}
        isStatus={isStatus}
        isTerminal={isTerminal}
        accentColor={accentColor}
        dropAllowed={dropAllowed}
        dropBlocked={dropBlocked}
      />

      <div
        ref={listRef}
        style={{
          flex:                 '0 0 auto',
          height:               LIST_HEIGHT,
          overflowY:            'auto',
          overflowX:            'hidden',
          overscrollBehavior:   'contain',
          scrollbarWidth:       'thin',
          scrollbarColor:       `${hexToRgba(palette.backgroundDark.hex, 0.28)} transparent`,
          padding:              '6px 8px',
          display:              'flex',
          flexDirection:        'column',
          gap:                  CARD_GAP,
          minHeight:            0,
        }}
      >
        {reveal.visible.map((ref) => (
          <PipelineCard
            key={ref._id}
            referral={ref}
            isDragging={draggingId === ref._id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onContextMenu={onContextMenu}
          />
        ))}
        {reveal.hasMore && (
          <div ref={reveal.sentinelRef} aria-hidden="true" style={{ height: 1, flexShrink: 0 }} />
        )}

        {cards.length === 0 && (
          <div
            style={{
              flex:            1,
              display:         'flex',
              flexDirection:   'column',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             8,
              padding:         '12px 8px',
              borderRadius:    6,
              border:          `1px dashed ${hexToRgba(palette.backgroundDark.hex, dropAllowed ? 0.25 : 0.1)}`,
              fontSize:        11,
              color:           hexToRgba(palette.backgroundDark.hex, dropAllowed ? 0.5 : 0.22),
              textAlign:       'center',
              minHeight:       48,
            }}
          >
            <span>{dropAllowed ? 'Drop here' : EMPTY_HINTS[stage] || 'Empty'}</span>
            {onAddReferral && !dropAllowed && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddReferral(); }}
                title="Add new referral"
                style={{
                  width:           26,
                  height:          26,
                  borderRadius:    6,
                  border:          `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
                  background:      hexToRgba(palette.backgroundDark.hex, 0.04),
                  color:           hexToRgba(palette.backgroundDark.hex, 0.4),
                  fontSize:        16,
                  lineHeight:      1,
                  cursor:          'pointer',
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                  transition:      'background 0.12s, border-color 0.12s',
                  flexShrink:      0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.09);
                  e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.3);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04);
                  e.currentTarget.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.18);
                }}
              >
                +
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StageHeader({ stage, count, isStatus, isTerminal, accentColor, dropAllowed, dropBlocked }) {
  // Tag labels + explanatory tooltips
  const tag = isStatus && stage === 'Hold'
    ? { label: 'Status', title: 'Any active referral can be placed on hold at any time' }
    : isStatus && stage === 'NTUC'
    ? { label: 'Status', title: 'Not Taken Under Care — closed with no admission' }
    : isTerminal && !isStatus
    ? { label: 'Final',  title: 'Terminal stage — referral is fully admitted' }
    : null;

  return (
    <div
      style={{
        padding:       '8px 10px 7px',
        borderBottom:  `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        gap:           6,
        flexShrink:    0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        {tag && (
          <span
            title={tag.title}
            style={{
              fontSize:       9,
              fontWeight:     700,
              letterSpacing:  '0.07em',
              textTransform:  'uppercase',
              color:          isStatus ? hexToRgba(palette.backgroundDark.hex, 0.35) : hexToRgba(palette.accentGreen.hex, 0.8),
              background:     isStatus ? hexToRgba(palette.backgroundDark.hex, 0.06) : hexToRgba(palette.accentGreen.hex, 0.1),
              borderRadius:   4,
              padding:        '1px 5px',
              flexShrink:     0,
              cursor:         'help',
            }}
          >
            {tag.label}
          </span>
        )}
        <span
          title={STAGE_META[stage]?.displayName || stage}
          style={{
            fontSize:      11.5,
            fontWeight:    650,
            color:         isTerminal
              ? hexToRgba(palette.backgroundDark.hex, 0.45)
              : palette.backgroundDark.hex,
            whiteSpace:    'nowrap',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
          }}
        >
          {STAGE_META[stage]?.displayName || stage}
        </span>
      </div>

      <span
        style={{
          fontSize:        11,
          fontWeight:      700,
          minWidth:        20,
          height:          20,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          borderRadius:    10,
          flexShrink:      0,
          background:      dropAllowed
            ? hexToRgba(palette.primaryMagenta.hex, 0.15)
            : count > 0
            ? hexToRgba(accentColor, 0.12)
            : hexToRgba(palette.backgroundDark.hex, 0.05),
          color:           dropAllowed
            ? palette.primaryMagenta.hex
            : count > 0
            ? accentColor
            : hexToRgba(palette.backgroundDark.hex, 0.3),
          transition:      'all 0.15s',
          padding:         '0 6px',
        }}
      >
        {count}
      </span>
    </div>
  );
}
