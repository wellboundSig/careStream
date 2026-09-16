import palette, { hexToRgba } from '../../utils/colors.js';

const CARDS = [
  {
    id: 'visits',
    label: 'Visits completed',
    sub: 'SOC / ROC visit happened',
    color: palette.accentBlue.hex,
  },
  {
    id: 'paperwork',
    label: 'Paperwork still open',
    sub: 'Visit done — referral not closed',
    color: palette.accentOrange.hex,
  },
  {
    id: 'closed',
    label: 'Fully closed',
    sub: 'Visit + paperwork complete',
    color: palette.accentGreen.hex,
  },
];

/**
 * Three-way visit closeout: visits done vs paperwork still open vs fully closed.
 */
export default function VisitCloseoutStrip({
  visitsCompleted = 0,
  paperworkOpen = 0,
  fullyClosed = 0,
  activeView,
  onSelect,
  compact = false,
}) {
  const values = {
    visits: visitsCompleted,
    paperwork: paperworkOpen,
    closed: fullyClosed,
  };

  return (
    <div
      data-testid="visit-closeout-strip"
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(3, minmax(0, 1fr))' : 'repeat(3, 1fr)',
        gap: compact ? 8 : 12,
      }}
    >
      {CARDS.map((card) => {
        const active = activeView === card.id;
        const clickable = typeof onSelect === 'function';
        return (
          <button
            key={card.id}
            type="button"
            data-testid={`visit-closeout-${card.id}`}
            onClick={clickable ? () => onSelect(card.id) : undefined}
            aria-pressed={clickable ? active : undefined}
            style={{
              textAlign: 'left',
              fontFamily: 'inherit',
              background: palette.backgroundLight.hex,
              borderRadius: compact ? 10 : 12,
              padding: compact ? '10px 10px 9px' : '14px 16px 12px',
              border: `1px solid ${active ? card.color : 'var(--color-border)'}`,
              borderTop: `3px solid ${card.color}`,
              cursor: clickable ? 'pointer' : 'default',
              boxShadow: active ? `0 0 0 1px ${hexToRgba(card.color, 0.35)}` : 'none',
            }}
          >
            <p style={{
              fontSize: compact ? 10 : 11, fontWeight: 650, letterSpacing: '0.04em',
              color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase',
              margin: 0,
            }}>
              {card.label}
            </p>
            <p style={{
              fontSize: compact ? 22 : 28, fontWeight: 700, color: palette.backgroundDark.hex,
              lineHeight: 1, margin: compact ? '6px 0 4px' : '8px 0 5px',
            }}>
              {values[card.id]}
            </p>
            <p style={{
              fontSize: compact ? 10.5 : 12, color: hexToRgba(palette.backgroundDark.hex, 0.42),
              margin: 0, lineHeight: 1.35,
            }}>
              {card.sub}
            </p>
          </button>
        );
      })}
    </div>
  );
}
