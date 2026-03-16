import { useState } from 'react';
import DivisionBadge from '../common/DivisionBadge.jsx';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const F2F_URGENCY = {
  Green:   palette.accentGreen.hex,
  Yellow:  palette.highlightYellow.hex,
  Orange:  palette.accentOrange.hex,
  Red:     palette.primaryMagenta.hex,
  Expired: hexToRgba(palette.backgroundDark.hex, 0.35),
};

const F2F_LABELS = {
  Green:   'F2F authorization is current (>30d remaining)',
  Yellow:  'F2F authorization expires within 30 days',
  Orange:  'F2F authorization expires within 14 days — action needed',
  Red:     'F2F authorization expires within 7 days — urgent',
  Expired: 'F2F authorization has expired',
};

const PRIORITY_COLORS = {
  High:     palette.accentOrange.hex,
  Critical: palette.primaryMagenta.hex,
  Low:      hexToRgba(palette.backgroundDark.hex, 0.25),
};

function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

function fmtDays(n) {
  if (n === null || n === undefined) return '—';
  return `${Math.max(1, n)}d`;
}

export default function PipelineCard({ referral, isDragging, onDragStart, onDragEnd, onContextMenu }) {
  const { open } = usePatientDrawer();
  const [hovered, setHovered] = useState(false);

  // Days since the referral was first submitted (Lead Entry clock — never resets)
  const daysEntry = daysSince(referral.referral_date);

  // Days in the CURRENT stage — resets on every stage change.
  // stage_entered_at is set by all transition code paths.
  // Falls back to updated_at for records that predate this field.
  const daysStage = daysSince(referral.stage_entered_at || referral.updated_at);

  const f2fColor  = F2F_URGENCY[referral.f2f_urgency] || null;
  const stageOverdue = daysStage !== null && daysStage > 14;

  function handleClick(e) {
    if (!isDragging) {
      e.stopPropagation();
      open(
        referral.patient || {
          id: referral.patient_id,
          _id: referral.patient_id,
          first_name: referral.patientName?.split(' ')[0] || '',
          last_name:  referral.patientName?.split(' ').slice(1).join(' ') || '',
          division:   referral.division,
        },
        referral,
      );
    }
  }

  return (
    <div
      draggable
      onClick={handleClick}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('referralId', referral._id);
        e.dataTransfer.setData('fromStage', referral.current_stage);
        onDragStart(referral);
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => onContextMenu(e, referral)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered && !isDragging
          ? hexToRgba(palette.primaryDeepPlum.hex, 0.025)
          : palette.backgroundLight.hex,
        // Use individual border props (not the shorthand) so borderLeft is never
        // stomped on re-render — the shorthand resets all four sides simultaneously.
        borderTop:    `1px solid ${hovered && !isDragging ? hexToRgba(palette.primaryDeepPlum.hex, 0.22) : 'var(--color-border)'}`,
        borderRight:  `1px solid ${hovered && !isDragging ? hexToRgba(palette.primaryDeepPlum.hex, 0.22) : 'var(--color-border)'}`,
        borderBottom: `1px solid ${hovered && !isDragging ? hexToRgba(palette.primaryDeepPlum.hex, 0.22) : 'var(--color-border)'}`,
        // F2F urgency overrides the bar; fall back to a neutral border so every card
        // has a visible left edge regardless of whether F2F data is present.
        borderLeft:   f2fColor ? `3px solid ${f2fColor}` : `3px solid var(--color-border)`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        opacity: isDragging ? 0.45 : 1,
        transition: 'background 0.1s, border-color 0.1s, box-shadow 0.12s, opacity 0.12s',
        boxShadow: hovered && !isDragging
          ? `0 2px 8px ${hexToRgba(palette.backgroundDark.hex, 0.07)}`
          : 'none',
      }}
    >
      {/* Name + division */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, lineHeight: 1.3, wordBreak: 'break-word' }}>
          {referral.patientName || referral.patient_id || 'Unknown'}
        </span>
        <DivisionBadge division={referral.division} size="small" />
      </div>

      {/* Time clocks + indicators */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {/* Clock 1: days since lead entry (never resets) */}
          <span
            title={`${fmtDays(daysEntry)} since lead entry`}
            style={{
              fontSize: 10.5,
              color: hexToRgba(palette.backgroundDark.hex, 0.38),
              fontWeight: 400,
            }}
          >
            {fmtDays(daysEntry)} since entry
          </span>
          <span style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.2) }}>·</span>
          {/* Clock 2: days in current stage (resets on transition) */}
          <span
            title={stageOverdue
              ? `${fmtDays(daysStage)} in "${referral.current_stage}" — overdue (>14d)`
              : `${fmtDays(daysStage)} in current stage`}
            style={{
              fontSize: 10.5,
              fontWeight: stageOverdue ? 650 : 400,
              color: stageOverdue
                ? palette.accentOrange.hex
                : hexToRgba(palette.backgroundDark.hex, 0.38),
            }}
          >
            {fmtDays(daysStage)} in stage
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {referral.priority && referral.priority !== 'Normal' && (
            <span
              title={`Priority: ${referral.priority}`}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: PRIORITY_COLORS[referral.priority] || palette.accentBlue.hex,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
          {f2fColor && (
            <span
              title={F2F_LABELS[referral.f2f_urgency] || `F2F: ${referral.f2f_urgency}`}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: f2fColor,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
        </div>
      </div>

      {/* Service tags */}
      {referral.services_requested?.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {referral.services_requested.map((s) => (
            <span
              key={s}
              style={{
                fontSize: 9.5,
                fontWeight: 650,
                padding: '1px 5px',
                borderRadius: 4,
                background: hexToRgba(palette.accentBlue.hex, 0.1),
                color: palette.accentBlue.hex,
                letterSpacing: '0.02em',
              }}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
