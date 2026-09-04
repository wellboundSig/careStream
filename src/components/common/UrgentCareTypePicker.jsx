import {
  URGENT_CARE_TYPE_OPTIONS,
  parseUrgentCareTypes,
} from '../../utils/urgentCare.js';
import { UrgentCareTypeIcon } from './UrgentCareIcon.jsx';

const NEUTRAL_INK = '#3A3545';
const NEUTRAL_TINT = 'rgba(58, 53, 69, 0.05)';

/**
 * Multi-select for urgent-care types (wound / insulin / injection).
 * Corporate-quiet: dark labels, neutral checkboxes and hover states — the
 * small type icon is the only color in each row.
 */
export default function UrgentCareTypePicker({
  types,
  onChange,
  disabled = false,
  layout = 'column',
}) {
  const selected = parseUrgentCareTypes(types);
  const row = layout === 'row';

  return (
    <div style={{
      display: 'flex',
      flexDirection: row ? 'row' : 'column',
      flexWrap: row ? 'wrap' : 'nowrap',
      gap: row ? 6 : 1,
    }}>
      {URGENT_CARE_TYPE_OPTIONS.map((o) => {
        const checked = selected.includes(o.value);
        return (
          <label
            key={o.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: row ? '6px 9px' : '6px 8px',
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: checked ? 650 : 500,
              color: NEUTRAL_INK,
              background: checked ? NEUTRAL_TINT : 'transparent',
              border: row ? `1px solid ${checked ? '#C9C5D0' : '#E4E1E8'}` : 'none',
              opacity: disabled ? 0.55 : 1,
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              if (!disabled && !checked) e.currentTarget.style.background = NEUTRAL_TINT;
            }}
            onMouseLeave={(e) => {
              if (!checked) e.currentTarget.style.background = 'transparent';
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => {
                if (disabled) return;
                const next = checked
                  ? selected.filter((t) => t !== o.value)
                  : [...selected, o.value];
                onChange(next);
              }}
              style={{
                width: 14,
                height: 14,
                flexShrink: 0,
                accentColor: NEUTRAL_INK,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            />
            <UrgentCareTypeIcon type={o.value} size={13} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
