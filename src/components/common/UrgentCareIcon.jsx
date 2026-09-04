import {
  getUrgentCareTypes,
  parseUrgentCareTypes,
  urgentCareTypeColor,
  urgentCareTypeLabel,
} from '../../utils/urgentCare.js';

/**
 * Tiny type-colored glyphs for urgent care (wound / insulin / injection),
 * plus the generic first-aid mark when a case is urgent with no type yet.
 */

function SvgShell({ size, title, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={title}
      fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <title>{title}</title>
      {children}
    </svg>
  );
}

// First-aid kit mark: red field with a square-edged white cross. Butt caps
// (not rounded) keep it reading as a medical cross rather than a "+" button.
function WoundGlyph({ size, title, color, muted }) {
  return (
    <SvgShell size={size} title={title}>
      <rect
        x="0.6" y="0.6" width="14.8" height="14.8" rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill={muted ? 'transparent' : color}
      />
      <path
        d="M8 3.8v8.4M3.8 8h8.4"
        stroke={muted ? color : '#fff'}
        strokeWidth="2.4"
        strokeLinecap="butt"
      />
    </SvgShell>
  );
}

function InsulinGlyph({ size, title, color, muted }) {
  return (
    <SvgShell size={size} title={title}>
      <path
        d="M8 2.1C8 2.1 3.5 7.15 3.5 10.15a4.5 4.5 0 0 0 9 0C12.5 7.15 8 2.1 8 2.1z"
        fill={muted ? 'transparent' : color}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {!muted && (
        <path d="M7.2 8.6c.4-1.1 1.6-1.6 1.8-1.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
      )}
    </SvgShell>
  );
}

// Syringe at 45°: thin needle, filled barrel, plunger flange + rod.
function InjectionGlyph({ size, title, color, muted }) {
  return (
    <SvgShell size={size} title={title}>
      {/* needle */}
      <path d="M2 14l3.2-3.2" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
      {/* barrel */}
      <path
        d="M6.8 11.6 4.4 9.2 9.2 4.4 11.6 6.8Z"
        fill={muted ? 'transparent' : color}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* plunger flange + rod */}
      <path
        d="M9.9 3.9l2.2 2.2M11.4 4.6l2.4-2.4"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* graduation marks */}
      {!muted && (
        <path d="M6.6 8.2l1.2 1.2M8 6.8l1.2 1.2" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
      )}
    </SvgShell>
  );
}

function GenericGlyph({ size, title, color, muted }) {
  return <WoundGlyph size={size} title={title} color={color} muted={muted} />;
}

const GLYPHS = {
  wound: WoundGlyph,
  insulin: InsulinGlyph,
  injection: InjectionGlyph,
};

export function UrgentCareTypeIcon({
  type,
  size = 14,
  muted = false,
  title,
}) {
  const color = muted ? 'currentColor' : urgentCareTypeColor(type);
  const Glyph = (type && GLYPHS[type]) || GenericGlyph;
  const label = title || (type ? `${urgentCareTypeLabel(type)} — urgent` : 'Urgent care required');
  return <Glyph size={size} title={label} color={color} muted={muted} />;
}

/**
 * One tiny icon per selected type. Falls back to the generic first-aid mark
 * when the case is urgent but no type has been chosen yet.
 */
export function UrgentCareIcons({
  types,
  referral,
  size = 12,
  muted = false,
  gap = 3,
  title,
}) {
  const list = types !== undefined
    ? parseUrgentCareTypes(types)
    : getUrgentCareTypes(referral);
  if (!list.length) {
    return <UrgentCareTypeIcon size={size} muted={muted} title={title} />;
  }
  return (
    <span
      title={title || urgentCareTypeLabel(list)}
      style={{ display: 'inline-flex', alignItems: 'center', gap, flexShrink: 0 }}
    >
      {list.map((t) => (
        <UrgentCareTypeIcon key={t} type={t} size={size} muted={muted} />
      ))}
    </span>
  );
}

export default function UrgentCareIcon({
  size = 14,
  title = 'Urgent care required',
  muted = false,
  type,
  types,
  referral,
}) {
  if (types !== undefined || referral) {
    return (
      <UrgentCareIcons
        types={types}
        referral={referral}
        size={size}
        muted={muted}
        title={title}
      />
    );
  }
  return <UrgentCareTypeIcon type={type} size={size} muted={muted} title={title} />;
}
