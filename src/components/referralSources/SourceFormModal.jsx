import { useState, useEffect, useRef } from 'react';
import { SOURCE_TYPES, TYPE_COLORS, NO_ENTITY_TYPES } from './sourceConstants.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function Section({ step, title, sub, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: hexToRgba(palette.primaryDeepPlum.hex, 0.1),
          color: palette.primaryDeepPlum.hex,
          fontSize: 11, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{step}</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundDark.hex }}>{title}</p>
          {sub && <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 1 }}>{sub}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function FieldLabel({ children, required, optional }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
      {children}
      {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 4 }}>*</span>}
      {optional && <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 6, fontSize: 10.5, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>optional</span>}
    </label>
  );
}

function inputStyle(focused, hasError, disabled) {
  return {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid ${hasError ? palette.primaryMagenta.hex : focused ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.1)}`,
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    background: disabled ? hexToRgba(palette.backgroundDark.hex, 0.04) : '#fff',
    color: disabled ? hexToRgba(palette.backgroundDark.hex, 0.45) : palette.backgroundDark.hex,
    boxSizing: 'border-box',
    transition: 'border-color 0.12s, box-shadow 0.12s',
    boxShadow: focused && !hasError ? `0 0 0 3px ${hexToRgba(palette.primaryDeepPlum.hex, 0.08)}` : 'none',
    cursor: disabled ? 'not-allowed' : 'text',
  };
}

function TypeChip({ type, active, onClick }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.Other;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 11px',
        borderRadius: 8,
        border: `1px solid ${active ? c.text : hexToRgba(palette.backgroundDark.hex, 0.1)}`,
        background: active ? c.bg : '#fff',
        color: active ? c.text : hexToRgba(palette.backgroundDark.hex, 0.6),
        fontSize: 12,
        fontWeight: active ? 700 : 550,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.12s',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.text, opacity: active ? 1 : 0.55, flexShrink: 0 }} />
      {type}
    </button>
  );
}

export default function SourceFormModal({ initial, marketers, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || '');
  const [sourceEntity, setSourceEntity] = useState(initial?.source_entity || '');
  const [marketerId, setMarketerId] = useState(initial?.marketer_id || '');
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [focus, setFocus] = useState({});
  const nameRef = useRef(null);

  const entityIsNA = NO_ENTITY_TYPES.has(type);
  const entityRequired = !!type && !entityIsNA;
  const nameErr   = !name.trim();
  const typeErr   = !type;
  const entityErr = entityRequired && !sourceEntity.trim();
  const canSubmit = !nameErr && !typeErr && !entityErr && !saving;

  useEffect(() => {
    const t = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Autofocus the name field once the modal animates in.
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  // Esc closes.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function handleSubmit() {
    setShowErrors(true);
    if (!canSubmit) return;
    setSaving(true);
    try {
      const fields = {
        name: name.trim(),
        type,
        ...(entityIsNA
          ? { source_entity: '' }
          : sourceEntity.trim()
            ? { source_entity: sourceEntity.trim() }
            : {}),
        ...(marketerId ? { marketer_id: marketerId } : {}),
        ...(!initial && { id: `src_${Date.now().toString(36)}` }),
      };
      await onSave(fields);
    } catch {
      setSaving(false);
    }
  }

  const c = TYPE_COLORS[type] || TYPE_COLORS.Other;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: hexToRgba(palette.backgroundDark.hex, animated ? 0.45 : 0),
        backdropFilter: animated ? 'blur(3px)' : 'none',
        transition: 'background 0.2s, backdrop-filter 0.2s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        style={{
          background: palette.backgroundLight.hex,
          width: '100%',
          maxWidth: 560,
          maxHeight: 'calc(100vh - 40px)',
          borderRadius: 14,
          boxShadow: `0 20px 50px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: animated ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.97)',
          opacity: animated ? 1 : 0,
          transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid var(--color-border)`, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.primaryDeepPlum.hex, marginBottom: 4 }}>
              {initial ? 'Edit source' : 'New referral source'}
            </p>
            <h2 id="source-modal-title" style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundDark.hex, lineHeight: 1.25 }}>
              {initial ? (initial.name || 'Unnamed source') : 'Add the person who refers'}
            </h2>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 4, lineHeight: 1.5 }}>
              {initial
                ? 'Update this person\u2019s details. Changes flow into the New Referral picker immediately.'
                : 'Capture the individual contact, their category, and the company they work for. Marketers will pick this person on the Lead Source field of New Referral.'}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          <Section
            step={1}
            title="Identity"
            sub="Who is referring, and what category do they belong to?"
          >
            <div style={{ marginBottom: 14 }}>
              <FieldLabel required>Person&rsquo;s name</FieldLabel>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setFocus((f) => ({ ...f, name: true }))}
                onBlur={() => setFocus((f) => ({ ...f, name: false }))}
                placeholder="e.g. Judith Campos"
                style={inputStyle(focus.name, showErrors && nameErr, false)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              />
              {showErrors && nameErr ? (
                <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 5 }}>Required. Enter the individual&rsquo;s name.</p>
              ) : (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 5, lineHeight: 1.4 }}>
                  The individual who refers patients. For self-referral or campaign sources, use a short label (e.g. &ldquo;Self&rdquo; or the campaign name).
                </p>
              )}
            </div>

            <div>
              <FieldLabel required>Category</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {SOURCE_TYPES.map((t) => (
                  <TypeChip key={t} type={t} active={type === t} onClick={() => setType(t)} />
                ))}
              </div>
              {showErrors && typeErr && (
                <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 7 }}>Required. Pick the category that fits best.</p>
              )}
            </div>
          </Section>

          <Section
            step={2}
            title="Affiliation"
            sub={entityIsNA
              ? 'Not applicable for this category.'
              : type === 'LHCSA' || type === 'CHHA'
                ? 'Required — enter the LHCSA / CHHA agency company name.'
                : 'The CCO, hospital, practice, agency, or facility this person works for.'}
          >
            <FieldLabel required={entityRequired} optional={!entityRequired && !entityIsNA}>
              Company / entity
              {entityIsNA && (
                <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.35), marginLeft: 8, fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 10.5 }}>
                  not applicable
                </span>
              )}
            </FieldLabel>
            <input
              value={entityIsNA ? '' : sourceEntity}
              onChange={(e) => setSourceEntity(e.target.value)}
              onFocus={() => setFocus((f) => ({ ...f, ent: true }))}
              onBlur={() => setFocus((f) => ({ ...f, ent: false }))}
              placeholder={
                entityIsNA
                  ? 'Not applicable'
                  : type === 'LHCSA'
                    ? 'e.g. ABC Home Care LLC'
                    : type === 'CHHA'
                      ? 'e.g. Visiting Nurse Service'
                      : 'e.g. Tri-County Care'
              }
              disabled={entityIsNA}
              style={inputStyle(focus.ent, showErrors && entityErr, entityIsNA)}
            />
            {showErrors && entityErr && (
              <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 5 }}>
                {type === 'LHCSA' || type === 'CHHA'
                  ? 'Required — enter the company / agency name for this LHCSA or CHHA.'
                  : 'Required for this category.'}
              </p>
            )}
          </Section>

          <Section
            step={3}
            title="Assignment"
            sub="Who on your team owns this relationship?"
          >
            <FieldLabel optional>Assigned marketer</FieldLabel>
            <select
              value={marketerId}
              onChange={(e) => setMarketerId(e.target.value)}
              onFocus={() => setFocus((f) => ({ ...f, m: true }))}
              onBlur={() => setFocus((f) => ({ ...f, m: false }))}
              style={{ ...inputStyle(focus.m, false, false), cursor: 'pointer', appearance: 'auto' }}
            >
              <option value="">Unassigned</option>
              {marketers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 5, lineHeight: 1.4 }}>
              Leave unassigned if no marketer owns this relationship yet.
            </p>
          </Section>

          {/* Live preview */}
          {(name.trim() || type) && (
            <section style={{ padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.accentBlue.hex, 0.05), border: `1px dashed ${hexToRgba(palette.accentBlue.hex, 0.28)}` }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 7 }}>
                Preview · how marketers will see it
              </p>
              <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                {name.trim() || <em style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Person&rsquo;s name</em>}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {type && (
                  <span style={{ fontSize: 11, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: c.bg, color: c.text }}>
                    {type}
                  </span>
                )}
                {!entityIsNA && sourceEntity.trim() && (
                  <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
                    {sourceEntity.trim()}
                  </span>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: `1px solid var(--color-border)`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: hexToRgba(palette.backgroundDark.hex, 0.015) }}>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            <kbd style={{ fontSize: 10.5, padding: '1px 5px', borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.06), fontFamily: 'inherit' }}>Esc</kbd> to close
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCancel}
              style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`, fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.65), cursor: 'pointer', transition: 'background 0.12s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit && !showErrors}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
                border: 'none',
                fontSize: 12.5,
                fontWeight: 650,
                color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.35),
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s, transform 0.08s',
              }}
              onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = palette.primaryMagenta.hex; }}
              onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = palette.primaryDeepPlum.hex; }}
            >
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Create source'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
