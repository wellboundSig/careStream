import {
  CLINICAL_CHECKLIST,
  REQUIRED_ITEMS,
  isChecklistComplete,
  CLINICAL_DECISIONS,
  RISK_KEYS,
  RISK_OPTIONS,
  getRiskLevel,
} from '../../data/clinicalChecklist.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const DECISION_COLORS = {
  accept: palette.accentGreen.hex,
  conditional: palette.highlightYellow.hex,
  decline: palette.primaryMagenta.hex,
};

// Selected-state labels make the commitment unambiguous — "Accept" vs "✓
// Accepted" is the difference between "I'm picking" and "I've decided".
const DECISION_SELECTED_LABELS = {
  accept: '✓ Accepted',
  conditional: '✓ Conditional',
  decline: '✓ Declined',
};

/**
 * Renders the full RN clinical checklist grouped by section.
 * State is managed externally via `checked` (object) and `onToggle` (key => void).
 *
 * Props:
 *  - checked: { [key]: boolean }
 *  - onToggle: (key) => void
 *  - decision: string | null — 'accept' | 'conditional' | 'decline'
 *  - onDecisionChange: (decision) => void
 *  - compact: boolean — smaller rendering for module panel
 *  - locked: boolean — true once a decision is set; locks the checklist and
 *    the risk dropdown so the review can't be silently edited after Accept.
 */
export default function ClinicalChecklistUI({
  checked,
  onToggle,
  decision,
  onDecisionChange,
  compact,
  locked = false,
  /** Override the default "deselect to edit" banner (e.g. after Confirm finalize). */
  lockedMessage = null,
}) {
  const completedRequired = REQUIRED_ITEMS.filter((i) => checked[i.key]).length;
  const totalRequired = REQUIRED_ITEMS.length;
  const pct = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;
  const complete = isChecklistComplete(checked);

  // Risk Stratification renders as a single dropdown — the three checkbox
  // columns in the DB stay, but the UI presents them as one mutually-exclusive
  // choice. Changing the dropdown emits the necessary toggles to flip the
  // chosen key on and clear the others.
  const currentRisk = getRiskLevel(checked);
  function handleRiskChange(nextKey) {
    if (locked) return;
    for (const k of RISK_KEYS) {
      const shouldBe = (k === nextKey);
      if (!!checked[k] !== shouldBe) onToggle(k);
    }
  }

  return (
    <div data-testid="clinical-checklist">
      {/* Progress bar */}
      <div style={{ marginBottom: compact ? 10 : 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Review Progress
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: complete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {completedRequired}/{totalRequired} required
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: complete ? palette.accentGreen.hex : pct > 50 ? palette.highlightYellow.hex : palette.accentOrange.hex, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Locked banner — surfaces above the checklist so the user knows why
          checkboxes won't respond once a decision is set. */}
      {locked && (
        <div style={{ marginBottom: compact ? 10 : 12, padding: '7px 10px', borderRadius: 7, background: hexToRgba(palette.accentGreen.hex, 0.07), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.22)}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: palette.accentGreen.hex }}>
            {lockedMessage
              || `Locked — deselect ${decision === 'conditional' ? 'Conditional' : 'Accepted'} to edit`}
          </span>
        </div>
      )}

      {/* Checklist sections */}
      {CLINICAL_CHECKLIST.map((group) => {
        const isRiskGroup = group.items.every((i) => i.exclusive === 'risk');
        if (isRiskGroup) {
          return (
            <div key={group.section} style={{ marginBottom: compact ? 10 : 14 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 6 }}>
                {group.section}
              </p>
              <select
                data-testid="risk-stratification"
                value={currentRisk}
                disabled={locked}
                onChange={(e) => handleRiskChange(e.target.value)}
                style={{
                  width: '100%', padding: compact ? '6px 8px' : '7px 10px', borderRadius: 7,
                  border: `1px solid var(--color-border)`,
                  background: locked ? hexToRgba(palette.backgroundDark.hex, 0.04) : palette.backgroundLight.hex,
                  color: locked ? hexToRgba(palette.backgroundDark.hex, 0.5) : palette.backgroundDark.hex,
                  fontSize: compact ? 12 : 12.5, fontFamily: 'inherit',
                  cursor: locked ? 'not-allowed' : 'pointer', outline: 'none',
                }}
              >
                <option value="">Select risk level…</option>
                {RISK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div key={group.section} style={{ marginBottom: compact ? 10 : 14 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 6 }}>
              {group.section}
            </p>
            {group.items.map((item) => {
              const done = !!checked[item.key];
              return (
                <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${compact ? 4 : 5}px 0`, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.6 : 1 }}>
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={locked}
                    onChange={() => onToggle(item.key)}
                    style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0, cursor: locked ? 'not-allowed' : 'pointer' }}
                  />
                  <span style={{ fontSize: compact ? 12 : 12.5, color: done ? hexToRgba(palette.backgroundDark.hex, 0.45) : palette.backgroundDark.hex, textDecoration: done ? 'line-through' : 'none', fontWeight: item.required ? 550 : 400 }}>
                    {item.label}
                    {item.required && !done && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3, fontSize: 10 }}>*</span>}
                  </span>
                </label>
              );
            })}
          </div>
        );
      })}

      {/* Clinical Validation — decision buttons stay interactive when locked so
          the reviewer can switch Accept↔Conditional or deselect to unlock. */}
      <div style={{ marginBottom: compact ? 4 : 6 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 8 }}>
          Clinical Validation
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {CLINICAL_DECISIONS.map((d) => {
            const sel = decision === d.key;
            const c = DECISION_COLORS[d.key] || palette.backgroundDark.hex;
            const isConditional = d.key === 'conditional';
            // Solid fills only — no rgba washes (those read as disabled).
            const idleBg = isConditional ? palette.highlightYellow.hex : '#E8F6EE';
            const idleFg = isConditional ? palette.backgroundDark.hex : palette.accentGreen.hex;
            // Clicking the SELECTED decision again deselects it — that's how
            // the reviewer "unlocks" the checklist to make a correction.
            const onClick = () => onDecisionChange(sel ? null : d.key);
            return (
              <button
                key={d.key}
                type="button"
                data-testid={`decision-${d.key}`}
                onClick={onClick}
                style={{
                  flex: 1,
                  padding: compact ? '10px 8px' : '12px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: sel ? c : idleBg,
                  border: `2px solid ${c}`,
                  color: sel
                    ? (isConditional ? palette.backgroundDark.hex : palette.backgroundLight.hex)
                    : idleFg,
                  fontSize: compact ? 12 : 13,
                  fontWeight: 700,
                  transition: 'filter 0.12s, transform 0.12s',
                  textAlign: 'center',
                  letterSpacing: '-0.01em',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.filter = 'brightness(0.97)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'none';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                {sel ? (DECISION_SELECTED_LABELS[d.key] || d.label) : d.label}
              </button>
            );
          })}
        </div>
        {!decision && (
          <p style={{ marginTop: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.4 }}>
            Choose Accept or Conditional to continue.
          </p>
        )}
      </div>
    </div>
  );
}
