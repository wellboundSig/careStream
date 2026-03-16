import { useEffect, useLayoutEffect, useRef } from 'react';
import StageRules from '../../data/StageRules.json';
import palette, { hexToRgba } from '../../utils/colors.js';

const STAGE_ORDER = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC',
  'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC',
];

function getValidDestinations(fromStage) {
  const rule = StageRules.stages[fromStage];
  if (!rule || rule.terminal) return [];

  const valid = new Set(rule.canMoveTo);
  if (StageRules.globalRules.anyActiveStageCanMoveToHold && fromStage !== 'Hold') {
    valid.add('Hold');
  }
  valid.delete(fromStage);
  return STAGE_ORDER.filter((s) => valid.has(s));
}

export default function ContextMenu({ x, y, referral, onSelect, onDismiss }) {
  const ref = useRef(null);
  const validDestinations = getValidDestinations(referral.current_stage);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Measure after DOM write but before paint — no visible jump
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prefer right of cursor; flip left if it would overflow
    const left = x + width + pad > vw ? Math.max(pad, x - width) : x;
    // Vertical: prefer below cursor; flip above if it would overflow
    const top  = y + height + pad > vh ? Math.max(pad, y - height) : y;

    el.style.left       = `${left}px`;
    el.style.top        = `${top}px`;
    el.style.visibility = 'visible';
  }, [x, y]);

  const mainDestinations = validDestinations.filter((s) => s !== 'Hold' && s !== 'NTUC');
  const globalDestinations = validDestinations.filter((s) => s === 'Hold' || s === 'NTUC');

  if (validDestinations.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        position:   'fixed',
        top:        y,
        left:       x,
        visibility: 'hidden', // revealed after useLayoutEffect measures and corrects position
        zIndex:     9999,
        background: palette.backgroundLight.hex,
        border: `1px solid var(--color-border)`,
        borderRadius: 10,
        boxShadow: `0 8px 32px ${hexToRgba(palette.backgroundDark.hex, 0.14)}, 0 2px 8px ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        minWidth: 200,
        maxWidth: 240,
        overflow: 'hidden',
        fontSize: 13,
      }}
    >
      <div
        style={{
          padding: '9px 12px 7px',
          borderBottom: `1px solid var(--color-border)`,
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: hexToRgba(palette.backgroundDark.hex, 0.38),
            marginBottom: 1,
          }}
        >
          Send to
        </p>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: palette.backgroundDark.hex,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {referral.patientName || referral.patient_id}
        </p>
        <p
          style={{
            fontSize: 11,
            color: hexToRgba(palette.backgroundDark.hex, 0.4),
            marginTop: 1,
          }}
        >
          Currently in {referral.current_stage}
        </p>
      </div>

      {mainDestinations.length > 0 && (
        <div style={{ padding: '4px 0' }}>
          {mainDestinations.map((stage) => (
            <ContextMenuItem
              key={stage}
              stage={stage}
              fromStage={referral.current_stage}
              onClick={() => onSelect(stage)}
            />
          ))}
        </div>
      )}

      {globalDestinations.length > 0 && (
        <>
          <div
            style={{
              height: 1,
              background: hexToRgba(palette.backgroundDark.hex, 0.07),
              margin: '2px 0',
            }}
          />
          <div style={{ padding: '4px 0' }}>
            {globalDestinations.map((stage) => (
              <ContextMenuItem
                key={stage}
                stage={stage}
                fromStage={referral.current_stage}
                onClick={() => onSelect(stage)}
                isGlobal
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ContextMenuItem({ stage, fromStage, onClick, isGlobal }) {
  const rule = StageRules.stages[stage];
  const requiresNote = rule?.requiresNote || stage === 'Hold' || stage === 'NTUC';
  const isProtected = rule?.protectedExit || rule?.requiresScope;

  const stageColor =
    stage === 'NTUC'
      ? hexToRgba(palette.backgroundDark.hex, 0.4)
      : stage === 'Hold'
      ? palette.highlightYellow.hex
      : palette.primaryMagenta.hex;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        gap: 8,
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05))
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: stageColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12.5,
            color: palette.backgroundDark.hex,
            fontWeight: 480,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {stage}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {requiresNote && (
          <span
            title="Requires a note"
            style={{
              fontSize: 9.5,
              color: hexToRgba(palette.backgroundDark.hex, 0.35),
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              borderRadius: 4,
              padding: '1px 5px',
              fontWeight: 600,
            }}
          >
            Note
          </span>
        )}
        {isProtected && (
          <span
            title={`Requires ${rule?.requiresScope} scope`}
            style={{
              fontSize: 9.5,
              color: palette.accentOrange.hex,
              background: hexToRgba(palette.accentOrange.hex, 0.1),
              borderRadius: 4,
              padding: '1px 5px',
              fontWeight: 600,
            }}
          >
            Protected
          </span>
        )}
      </div>
    </button>
  );
}
