import { useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import SocCompletedShieldIcon from './SocCompletedShieldIcon.jsx';

/**
 * Dashboard KPI card for SOC Completed with a hover popup:
 * top = marketers, bottom = intake owners — each ranked by SOC count,
 * only staff with ≥1 completed SOC. Bars scale to the section max.
 */
export default function SocCompletedStatCard({
  value,
  sub,
  label = 'SOC Completed',
  accentColor,
  marketers = [],
  owners = [],
  compact = false,
}) {
  const accent = accentColor || palette.accentGreen.hex;
  const [open, setOpen] = useState(false);
  const hasBreakdown = marketers.length > 0 || owners.length > 0;

  return (
    <div
      style={{ position: 'relative', zIndex: open ? 20 : 1 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div
        tabIndex={hasBreakdown ? 0 : undefined}
        style={{
          background: palette.backgroundLight.hex,
          borderRadius: 12,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          border: `1px solid var(--color-border)`,
          borderTop: `3px solid ${accent}`,
          position: 'relative',
          cursor: hasBreakdown ? 'default' : 'default',
          outline: 'none',
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          boxShadow: open
            ? `0 8px 28px ${hexToRgba(accent, 0.18)}`
            : 'none',
          transform: open ? 'translateY(-1px)' : 'none',
          padding: compact ? '12px 16px' : '18px 20px',
        }}
      >
        {!compact && (
          <div style={{ position: 'absolute', top: 14, right: 16 }}>
            <SocCompletedShieldIcon size={28} />
          </div>
        )}
        <p style={{
          fontSize: compact ? 10.5 : 11, fontWeight: 650, letterSpacing: '0.05em',
          color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase',
          paddingRight: compact ? 0 : 36,
        }}>
          {label}
        </p>
        <p style={{ fontSize: compact ? 24 : 32, fontWeight: 700, color: palette.backgroundDark.hex, lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: compact ? 11 : 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{sub}</p>
      </div>

      {hasBreakdown && (
        <div
          aria-hidden={!open}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 8px)',
            pointerEvents: open ? 'auto' : 'none',
            opacity: open ? 1 : 0,
            transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.98)',
            transition: 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
            zIndex: 30,
          }}
        >
          <div
            style={{
              background: palette.backgroundLight.hex,
              borderRadius: 14,
              border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
              boxShadow: `0 16px 40px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
              overflow: 'hidden',
              minWidth: 260,
            }}
          >
            <Section title="Marketers" rows={marketers} delayBase={0} open={open} />
            <div style={{ height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.07) }} />
            <Section title="Intake owners" rows={owners} delayBase={marketers.length} open={open} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes socBreakdownRowIn {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes socBreakdownBarIn {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}

function Section({ title, rows, delayBase, open }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div style={{ padding: '12px 14px 14px' }}>
      <p style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 10,
      }}>
        {title}
      </p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', margin: 0 }}>
          None yet
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {rows.map((row, i) => {
            const pct = Math.max(6, Math.round((row.count / max) * 100));
            const delay = open ? `${0.05 + (delayBase + i) * 0.045}s` : '0s';
            return (
              <div
                key={row.id}
                style={{
                  animation: open ? `socBreakdownRowIn 0.28s ease both ${delay}` : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Avatar name={row.name} image={row.image} />
                    <span style={{
                      fontSize: 12.5, fontWeight: 600, color: palette.backgroundDark.hex,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {row.name}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 12.5, fontWeight: 700, color: palette.accentGreen.hex,
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>
                    {row.count}
                  </span>
                </div>
                <div style={{
                  height: 4, borderRadius: 99,
                  background: hexToRgba(palette.backgroundDark.hex, 0.06),
                  overflow: 'hidden',
                }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 99,
                      background: `linear-gradient(90deg, ${hexToRgba(palette.accentGreen.hex, 0.55)}, ${palette.accentGreen.hex})`,
                      transformOrigin: 'left center',
                      animation: open ? `socBreakdownBarIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both ${delay}` : 'none',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, image }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?';

  if (image) {
    return (
      <img
        src={image}
        alt=""
        width={22}
        height={22}
        style={{
          width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
          border: `1.5px solid ${hexToRgba(palette.accentGreen.hex, 0.25)}`,
        }}
      />
    );
  }

  return (
    <span
      style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 700, color: palette.accentGreen.hex,
        background: hexToRgba(palette.accentGreen.hex, 0.12),
      }}
    >
      {initials}
    </span>
  );
}
