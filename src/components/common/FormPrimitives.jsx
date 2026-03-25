import palette, { hexToRgba } from '../../utils/colors.js';

export const inputBaseStyle = {
  width: '100%', padding: '9px 11px', borderRadius: 8,
  border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

export function FormLabel({ children, required }) {
  return (
    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5, letterSpacing: '0.02em' }}>
      {children}
      {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
    </label>
  );
}

export function FormInput({ value, onChange, placeholder, type = 'text', hasError, autoFocus, disabled }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      style={{ ...inputBaseStyle, borderColor: hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12), opacity: disabled ? 0.6 : 1 }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12))}
    />
  );
}

export function FormSelect({ value, onChange, options, placeholder, hasError, disabled }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...inputBaseStyle, borderColor: hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12), cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12))}
    >
      <option value="" disabled>{placeholder || 'Select…'}</option>
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
  );
}

export function FormFieldGroup({ label, required, children, style }) {
  return (
    <div style={{ marginBottom: 8, ...style }}>
      {label && (
        <p style={{ fontSize: 10.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4, letterSpacing: '0.02em' }}>
          {label}
          {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
        </p>
      )}
      {children}
    </div>
  );
}
