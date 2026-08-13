import palette from '../../utils/colors.js';
import { URGENT_CARE_TYPE_OPTIONS, parseUrgentCareTypes } from '../../utils/urgentCare.js';

/**
 * Multi-select checkboxes for urgent-care types (wound / insulin / injection).
 */
export default function UrgentCareTypePicker({ types, onChange, disabled = false }) {
  const selected = parseUrgentCareTypes(types);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {URGENT_CARE_TYPE_OPTIONS.map((o) => {
        const checked = selected.includes(o.value);
        return (
          <label
            key={o.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 8px',
              borderRadius: 7,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              color: '#3A3545',
              opacity: disabled ? 0.55 : 1,
            }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#F8E8EF'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
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
                accentColor: palette.primaryMagenta.hex,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
