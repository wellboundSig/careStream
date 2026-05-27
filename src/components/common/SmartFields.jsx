/**
 * Smart input primitives used by the v2 triage form (and reusable elsewhere).
 *
 * These wrap the raw HTML inputs with:
 *   - Live formatting (phone → (XXX) XXX-XXXX as you type)
 *   - Real validation (libphonenumber-js, validator/isEmail, zipcodes)
 *   - Inline error messages that surface only after the user has touched the
 *     field (or `forceValidate` is true — used to show ALL errors when the
 *     parent is checking completeness).
 *   - Consistent styling via the existing FormPrimitives palette.
 *
 * All smart inputs surface a clean, normalized value via `onChange`:
 *   - Phone returns digits-only (10-digit string or shorter while typing).
 *   - Email returns the trimmed string.
 *   - NPI returns digits-only.
 *   - Address returns the multi-line string as typed.
 */

import { useMemo, useState } from 'react';
import isEmail from 'validator/lib/isEmail.js';
import zipcodes from 'zipcodes';
import palette, { hexToRgba } from '../../utils/colors.js';
import { normalizePhone } from '../../utils/validation.js';
import { inputBaseStyle } from './FormPrimitives.jsx';

const errorStyle = {
  fontSize: 11,
  color: palette.primaryMagenta.hex,
  marginTop: 4,
  lineHeight: 1.35,
};

const hintStyle = {
  fontSize: 11,
  color: hexToRgba(palette.backgroundDark.hex, 0.45),
  marginTop: 4,
  lineHeight: 1.35,
};

function fieldStyle(hasError, disabled) {
  return {
    ...inputBaseStyle,
    borderColor: hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12),
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'auto',
  };
}

// ── Phone ───────────────────────────────────────────────────────────────────

export function SmartPhoneInput({
  value,
  onChange,
  placeholder = '(555) 555-5555',
  disabled,
  forceValidate,
  autoFocus,
}) {
  const [touched, setTouched] = useState(false);

  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  // Live-format for partial input — formatPhone() only handles complete
  // 10-digit numbers, so we render the in-progress mask ourselves.
  const liveDisplay = (() => {
    if (digits.length === 0) return '';
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  })();

  const result = digits ? normalizePhone(digits) : { valid: false, error: null };
  const showError = (touched || forceValidate) && digits.length > 0 && !result.valid;

  function handleChange(e) {
    const next = e.target.value.replace(/\D/g, '').slice(0, 10);
    onChange(next);
  }

  return (
    <div>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        autoFocus={autoFocus}
        disabled={disabled}
        value={liveDisplay}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        style={fieldStyle(showError, disabled)}
        onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      />
      {showError && <p style={errorStyle}>{result.error || 'Enter a valid US phone number'}</p>}
    </div>
  );
}

// ── Email ───────────────────────────────────────────────────────────────────

export function SmartEmailInput({
  value,
  onChange,
  placeholder = 'name@example.com',
  disabled,
  forceValidate,
}) {
  const [touched, setTouched] = useState(false);
  const trimmed = (value || '').trim();
  const valid = trimmed.length === 0 || isEmail(trimmed);
  const showError = (touched || forceValidate) && trimmed.length > 0 && !valid;

  return (
    <div>
      <input
        type="email"
        autoComplete="email"
        disabled={disabled}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        style={fieldStyle(showError, disabled)}
        onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      />
      {showError && <p style={errorStyle}>Enter a valid email address</p>}
    </div>
  );
}

// ── NPI (10 digits) ─────────────────────────────────────────────────────────

export function SmartNpiInput({
  value,
  onChange,
  placeholder = '1234567890',
  disabled,
  forceValidate,
}) {
  const [touched, setTouched] = useState(false);
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  const valid = digits.length === 0 || digits.length === 10;
  const showError = (touched || forceValidate) && digits.length > 0 && !valid;

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={digits}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        style={fieldStyle(showError, disabled)}
        onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      />
      {showError && <p style={errorStyle}>NPI must be exactly 10 digits</p>}
    </div>
  );
}

// ── Address (multiline + ZIP-driven city/state suggestion) ──────────────────
//
// Real address autocomplete (Google Places, USPS, Census Geocoder) would be
// nicer but requires an external API. We approximate "suggest as you type"
// using the local `zipcodes` package: as soon as the user enters a 5-digit
// ZIP anywhere in the textarea, we surface a one-click chip that appends
// "{City}, {State} {ZIP}" if the chip's city/state isn't already in the
// string. This dramatically reduces typos and matches the spec's intent
// (the patient's mailing address) without a network dependency.

function pluckZip(text) {
  const m = String(text || '').match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

function buildCityStateSuffix(zip) {
  if (!zip) return null;
  const hit = zipcodes.lookup(zip);
  if (!hit) return null;
  return `${hit.city}, ${hit.state} ${zip}`;
}

export function SmartAddressInput({
  value,
  onChange,
  placeholder = 'Street, City, State ZIP',
  disabled,
  rows = 3,
}) {
  const text = value || '';
  const zip = pluckZip(text);
  const suggestion = useMemo(() => buildCityStateSuffix(zip), [zip]);

  // Show the chip only when the current address doesn't already end with the
  // city/state pair we'd suggest (case-insensitive city match suffices).
  const showSuggestion = (() => {
    if (!suggestion) return false;
    const lower = text.toLowerCase();
    const sug = suggestion.toLowerCase();
    if (lower.includes(sug)) return false;
    // Don't suggest if the text already contains a likely "City, ST" pattern.
    if (/,\s*[A-Z]{2}\s+\d{5}/.test(text)) return false;
    return true;
  })();

  function applySuggestion() {
    if (!suggestion) return;
    // Append the suggestion to the address, stripping a trailing ZIP if it
    // already appears (so we don't end up with two copies). Keep the user's
    // street line intact.
    const street = text.replace(/\b\d{5}\b\s*$/, '').replace(/[\s,]+$/, '').trim();
    const next = street.length > 0 ? `${street}\n${suggestion}` : suggestion;
    onChange(next);
  }

  return (
    <div>
      <textarea
        rows={rows}
        disabled={disabled}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...fieldStyle(false, disabled), resize: 'vertical', fontFamily: 'inherit' }}
        onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
        onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
      />
      {showSuggestion && (
        <button
          type="button"
          onClick={applySuggestion}
          disabled={disabled}
          style={{
            marginTop: 6,
            padding: '5px 10px',
            borderRadius: 6,
            background: hexToRgba(palette.accentBlue.hex, 0.1),
            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
            fontSize: 11.5,
            fontWeight: 600,
            color: palette.accentBlue.hex,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Append the matching city + state for this ZIP"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Use “{suggestion}”
        </button>
      )}
    </div>
  );
}

// ── Date with age-group bounds ──────────────────────────────────────────────

export function SmartDateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  hint,
}) {
  // Accept both ISO-date strings and full ISO datetimes by trimming to the
  // YYYY-MM-DD prefix (HTML date inputs only accept that format).
  const dateOnly = typeof value === 'string' ? value.split('T')[0] : '';

  return (
    <div>
      <input
        type="date"
        disabled={disabled}
        min={min || undefined}
        max={max || undefined}
        value={dateOnly}
        onChange={(e) => onChange(e.target.value)}
        style={fieldStyle(false, disabled)}
        onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
        onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
      />
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

// ── Auto-resizing detached display field (used for read-only auto-populated
//    fields like patient name pulled from demographics). Lets the user see the
//    value without being able to type — they edit it in Demographics if it's
//    wrong, which keeps the source of truth consistent. ──────────────────────

export function ReadOnlyInlineValue({ value, placeholder = '—', muted }) {
  const text = (value || '').toString().trim();
  return (
    <p style={{
      fontSize: 13,
      padding: '8px 11px',
      borderRadius: 8,
      background: hexToRgba(palette.backgroundDark.hex, 0.04),
      border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
      color: text ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.45),
      fontStyle: text ? 'normal' : 'italic',
      whiteSpace: 'pre-wrap',
      opacity: muted ? 0.85 : 1,
    }}>
      {text || placeholder}
    </p>
  );
}

// ── Tri-state radio (Yes / No / Unanswered) ─────────────────────────────────
// Stores the answer as a string ('Yes' or 'No'), or null when cleared.
// Triage v2 stores 3 states distinctly per the spec: null means unanswered,
// 'No' means explicitly answered No, 'Yes' means explicitly answered Yes.

export function TriStateRadio({ name, value, onChange, disabled }) {
  const norm = (() => {
    if (value === true || value === 'true' || value === 'TRUE' || value === 'Yes') return 'Yes';
    if (value === false || value === 'false' || value === 'FALSE' || value === 'No') return 'No';
    return '';
  })();

  function pick(v) {
    if (disabled) return;
    onChange(norm === v ? null : v); // toggle off if clicked twice
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {['Yes', 'No'].map((opt) => {
        const active = norm === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => pick(opt)}
            disabled={disabled}
            style={{
              padding: '7px 18px',
              borderRadius: 8,
              border: `1px solid ${active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.14)}`,
              background: active
                ? hexToRgba(palette.primaryMagenta.hex, 0.1)
                : hexToRgba(palette.backgroundDark.hex, 0.03),
              color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
              fontSize: 13,
              fontWeight: active ? 700 : 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              minWidth: 64,
              transition: 'all 0.12s',
            }}
            aria-pressed={active}
            aria-label={`${name || ''} ${opt}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Segmented enum picker (used for OPWDD status, CCO name) ─────────────────

export function SegmentedPicker({ value, onChange, options, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => !disabled && onChange(opt)}
            disabled={disabled}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: `1px solid ${active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.14)}`,
              background: active
                ? hexToRgba(palette.primaryMagenta.hex, 0.1)
                : hexToRgba(palette.backgroundDark.hex, 0.03),
              color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// Default export grouping for convenience.
export default {
  SmartPhoneInput,
  SmartEmailInput,
  SmartNpiInput,
  SmartAddressInput,
  SmartDateInput,
  ReadOnlyInlineValue,
  TriStateRadio,
  SegmentedPicker,
};
