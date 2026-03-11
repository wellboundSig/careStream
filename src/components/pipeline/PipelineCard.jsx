import DivisionBadge from '../common/DivisionBadge.jsx';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const F2F_URGENCY = {
  Green: palette.accentGreen.hex,
  Yellow: palette.highlightYellow.hex,
  Orange: palette.accentOrange.hex,
  Red: palette.primaryMagenta.hex,
  Expired: hexToRgba(palette.backgroundDark.hex, 0.35),
};

function daysInStage(updatedAt) {
  if (!updatedAt) return 0;
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
}

export default function PipelineCard({
  referral,
  isDragging,
  onDragStart,
  onDragEnd,
  onContextMenu,
}) {
  const { open } = usePatientDrawer();
  const days = daysInStage(referral.updated_at);
  const f2fColor = F2F_URGENCY[referral.f2f_urgency] || null;

  function handleClick(e) {
    if (!isDragging) {
      e.stopPropagation();
      open(referral.patient || { id: referral.patient_id, _id: referral.patient_id, first_name: referral.patientName?.split(' ')[0] || '', last_name: referral.patientName?.split(' ').slice(1).join(' ') || '', division: referral.division }, referral);
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
      style={{
        background: palette.backgroundLight.hex,
        border: `1px solid var(--color-border)`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        opacity: isDragging ? 0.45 : 1,
        boxShadow: isDragging
          ? 'none'
          : `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
        transition: 'box-shadow 0.12s, opacity 0.12s',
        borderLeft: f2fColor ? `3px solid ${f2fColor}` : `3px solid transparent`,
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.boxShadow = `0 3px 10px ${hexToRgba(palette.backgroundDark.hex, 0.1)}`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.06)}`;
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 6,
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            color: palette.backgroundDark.hex,
            lineHeight: 1.3,
            wordBreak: 'break-word',
          }}
        >
          {referral.patientName || referral.patient_id || 'Unknown'}
        </span>
        <DivisionBadge division={referral.division} size="small" />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: hexToRgba(palette.backgroundDark.hex, 0.4),
          }}
        >
          {days === 0 ? 'Today' : `${days}d here`}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {referral.priority && referral.priority !== 'Normal' && (
            <PriorityPip priority={referral.priority} />
          )}
          {f2fColor && (
            <span
              title={`F2F: ${referral.f2f_urgency}`}
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

      {referral.services_requested?.length > 0 && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            gap: 3,
            flexWrap: 'wrap',
          }}
        >
          {referral.services_requested.map((s) => (
            <span
              key={s}
              style={{
                fontSize: 9.5,
                fontWeight: 650,
                padding: '1px 5px',
                borderRadius: 4,
                background: hexToRgba(palette.accentBlue.hex, 0.14),
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

function PriorityPip({ priority }) {
  const colors = {
    High: palette.accentOrange.hex,
    Critical: palette.primaryMagenta.hex,
    Low: hexToRgba(palette.backgroundDark.hex, 0.25),
  };
  return (
    <span
      title={`Priority: ${priority}`}
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: colors[priority] || palette.accentBlue.hex,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}
