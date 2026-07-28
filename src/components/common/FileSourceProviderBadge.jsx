import palette, { hexToRgba } from '../../utils/colors.js';
import { useLookups } from '../../hooks/useLookups.js';

/**
 * Shows which provider a file came from (optional file.physician_id).
 * Independent of the patient's PCP / referral physician.
 */
export default function FileSourceProviderBadge({
  file,
  physicianId = null,
  resolvePhysician: resolvePhysicianProp = null,
  size = 'md',
  showEmpty = false,
}) {
  const { resolvePhysician: resolveFromLookups } = useLookups();
  const resolvePhysician = resolvePhysicianProp || resolveFromLookups;
  const id = physicianId || file?.physician_id || null;
  const name = id ? resolvePhysician?.(id) : null;
  const has = !!(name && name !== '—' && name !== id);

  if (!has && !showEmpty) return null;

  const compact = size === 'sm';
  return (
    <span
      title={has ? `Provider this file came from: ${name}` : 'No source provider set'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 650,
        padding: compact ? '2px 8px' : '3px 10px',
        borderRadius: 999,
        background: has
          ? hexToRgba(palette.accentBlue.hex, 0.1)
          : hexToRgba(palette.backgroundDark.hex, 0.05),
        color: has
          ? palette.accentBlue.hex
          : hexToRgba(palette.backgroundDark.hex, 0.4),
        border: `1px solid ${
          has
            ? hexToRgba(palette.accentBlue.hex, 0.22)
            : hexToRgba(palette.backgroundDark.hex, 0.08)
        }`,
        maxWidth: '100%',
      }}
    >
      <svg width={compact ? 10 : 12} height={compact ? 10 : 12} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 20c1.5-3.5 4.2-5 8-5s6.5 1.5 8 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {has ? `From ${name}` : 'No source provider'}
      </span>
    </span>
  );
}
