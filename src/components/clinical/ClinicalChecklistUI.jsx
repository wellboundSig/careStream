import { CLINICAL_CHECKLIST, REQUIRED_ITEMS, isChecklistComplete, CLINICAL_DECISIONS } from '../../data/clinicalChecklist.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const DECISION_COLORS = {
  accept: palette.accentGreen.hex,
  conditional: palette.highlightYellow.hex,
  decline: palette.primaryMagenta.hex,
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
 *  - authRequired: boolean
 *  - onAuthRequiredChange: (bool) => void
 *  - compact: boolean — smaller rendering for drawer tab
 */
export default function ClinicalChecklistUI({ checked, onToggle, decision, onDecisionChange, authRequired, onAuthRequiredChange, compact }) {
  const completedRequired = REQUIRED_ITEMS.filter((i) => checked[i.key]).length;
  const totalRequired = REQUIRED_ITEMS.length;
  const pct = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;
  const complete = isChecklistComplete(checked);

  const sectionPad = compact ? '8px 0' : '10px 0';

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

      {/* Checklist sections */}
      {CLINICAL_CHECKLIST.map((group) => (
        <div key={group.section} style={{ marginBottom: compact ? 10 : 14 }}>
          <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 6 }}>
            {group.section}
          </p>
          {group.items.map((item) => {
            const done = !!checked[item.key];
            return (
              <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${compact ? 4 : 5}px 0`, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => onToggle(item.key)}
                  style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }}
                />
                <span style={{ fontSize: compact ? 12 : 12.5, color: done ? hexToRgba(palette.backgroundDark.hex, 0.45) : palette.backgroundDark.hex, textDecoration: done ? 'line-through' : 'none', fontWeight: item.required ? 550 : 400 }}>
                  {item.label}
                  {item.required && !done && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3, fontSize: 10 }}>*</span>}
                </span>
              </label>
            );
          })}
        </div>
      ))}

      {/* Clinical Decision */}
      <div style={{ marginBottom: compact ? 10 : 14 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 6 }}>
          Clinical Decision
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          {CLINICAL_DECISIONS.map((d) => {
            const sel = decision === d.key;
            const c = DECISION_COLORS[d.key] || palette.backgroundDark.hex;
            return (
              <button key={d.key} type="button" data-testid={`decision-${d.key}`} onClick={() => onDecisionChange(d.key)} style={{
                flex: 1, padding: compact ? '7px 6px' : '9px 8px', borderRadius: 7, cursor: 'pointer',
                background: sel ? c : hexToRgba(palette.backgroundDark.hex, 0.04),
                border: `1.5px solid ${sel ? c : hexToRgba(palette.backgroundDark.hex, 0.1)}`,
                color: sel ? (d.key === 'conditional' ? palette.backgroundDark.hex : palette.backgroundLight.hex) : hexToRgba(palette.backgroundDark.hex, 0.6),
                fontSize: compact ? 11 : 12, fontWeight: 650, transition: 'all 0.12s', textAlign: 'center',
              }}>
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Authorization required toggle */}
      {(decision === 'accept' || decision === 'conditional') && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 7, background: authRequired ? hexToRgba(palette.accentOrange.hex, 0.08) : hexToRgba(palette.backgroundDark.hex, 0.03), cursor: 'pointer', marginBottom: compact ? 8 : 12 }}>
          <input type="checkbox" checked={authRequired} onChange={(e) => onAuthRequiredChange(e.target.checked)} style={{ accentColor: palette.accentOrange.hex, width: 14, height: 14 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>
            Managed care authorization required
          </span>
        </label>
      )}
    </div>
  );
}
