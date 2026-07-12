import palette, { hexToRgba } from '../../utils/colors.js';

const LABELS = {
  patient_name: 'Patient name',
  patient_first: 'First name',
  patient_last: 'Last name',
  dob: 'DOB',
  phone: 'Phone',
  mrn: 'MRN',
  insurance: 'Insurance',
  facility: 'Facility',
  referrer_name: 'Referrer name',
  referrer_email: 'Referrer email',
};

const CONF_STYLE = {
  high: { bg: hexToRgba(palette.accentGreen.hex, 0.12), text: palette.accentGreen.hex, label: 'high' },
  medium: { bg: hexToRgba(palette.accentBlue.hex, 0.12), text: palette.accentBlue.hex, label: 'medium' },
  low: { bg: hexToRgba(palette.highlightYellow.hex, 0.25), text: '#7A5F00', label: 'possible' },
};

/**
 * @param {{ parsed: object|null, onApply?: (field: string, value: string) => void }} props
 */
export default function ParseSuggestionChips({ parsed, onApply }) {
  if (!parsed) {
    return (
      <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
        No fields detected yet. Use Re-parse after the body is available.
      </p>
    );
  }

  const conf = parsed.confidence || {};
  const fields = Object.keys(LABELS).filter((k) => parsed[k]);

  if (!fields.length) {
    return (
      <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
        No patient fields detected. Sender is shown separately as the referrer.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {fields.map((field) => {
        const c = CONF_STYLE[conf[field]] || CONF_STYLE.low;
        const value = String(parsed[field]);
        const clickable = typeof onApply === 'function' && !field.startsWith('referrer');
        return (
          <button
            key={field}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onApply(field, value)}
            title={clickable ? 'Click to apply to form' : undefined}
            style={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              padding: '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)',
              background: c.bg, cursor: clickable ? 'pointer' : 'default', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: c.text }}>
              {LABELS[field]} · {c.label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{value}</span>
          </button>
        );
      })}
    </div>
  );
}
