import { useState, useEffect } from 'react';
import { getConflictsByReferral, updateConflict } from '../../../api/conflicts.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';

const SEVERITY_COLORS = {
  Low: { bg: hexToRgba(palette.accentBlue.hex, 0.1), text: '#005B84' },
  Medium: { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  High: { bg: hexToRgba(palette.accentOrange.hex, 0.12), text: '#8B4A00' },
  Critical: { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), text: palette.primaryMagenta.hex },
};

const STATUS_COLORS = {
  Open: { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
  'In Progress': { bg: hexToRgba(palette.accentOrange.hex, 0.1), text: '#8B4A00' },
  Resolved: { bg: hexToRgba(palette.accentGreen.hex, 0.1), text: '#3A6E00' },
  Waived: { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

export default function ConflictsTab({ referral }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { can } = usePermissions();

  useEffect(() => {
    if (!referral?.id) { setLoading(false); return; }
    setLoading(true);
    getConflictsByReferral(referral.id)
      .then((records) => setConflicts(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id]);

  async function resolve(conflict) {
    if (!can(PERMISSION_KEYS.CONFLICT_RESOLVE)) return;
    try {
      await updateConflict(conflict._id, { status: 'Resolved', resolved_at: new Date().toISOString() });
      setConflicts((prev) => prev.map((c) => c._id === conflict._id ? { ...c, status: 'Resolved' } : c));
    } catch {}
  }

  if (!referral) return <p style={{ padding: 24, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', textAlign: 'center' }}>No referral selected.</p>;
  if (loading) return <LoadingState message="Loading conflicts..." size="small" />;

  const open = conflicts.filter((c) => c.status === 'Open' || c.status === 'In Progress');
  const resolved = conflicts.filter((c) => c.status === 'Resolved' || c.status === 'Waived');

  return (
    <div style={{ padding: '20px' }}>
      {conflicts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: hexToRgba(palette.accentGreen.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22 }}>✓</div>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic' }}>No conflicts on record.</p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 10 }}>
                Active ({open.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {open.map((c) => <ConflictCard key={c._id} conflict={c} onResolve={can(PERMISSION_KEYS.CONFLICT_RESOLVE) ? resolve : undefined} />)}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
                Resolved ({resolved.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {resolved.map((c) => <ConflictCard key={c._id} conflict={c} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConflictCard({ conflict, onResolve }) {
  const sevColors = SEVERITY_COLORS[conflict.severity] || SEVERITY_COLORS.Medium;
  const statColors = STATUS_COLORS[conflict.status] || STATUS_COLORS.Open;
  const isActive = conflict.status === 'Open' || conflict.status === 'In Progress';

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, border: `1px solid ${isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'var(--color-border)'}`, background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.02) : palette.backgroundLight.hex, opacity: isActive ? 1 : 0.7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: statColors.bg, color: statColors.text }}>{conflict.status}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: sevColors.bg, color: sevColors.text }}>{conflict.severity}</span>
        </div>
        {isActive && onResolve && (
          <button
            onClick={() => onResolve(conflict)}
            style={{ padding: '4px 12px', borderRadius: 6, background: hexToRgba(palette.accentGreen.hex, 0.12), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.3)}`, fontSize: 11.5, fontWeight: 650, color: '#3A6E00', cursor: 'pointer', flexShrink: 0 }}
          >
            Resolve
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>{conflict.type}</p>
      <p style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.5 }}>{conflict.description}</p>
      {conflict.resolution_note && (
        <p style={{ marginTop: 8, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), fontStyle: 'italic', lineHeight: 1.5 }}>
          Resolution: {conflict.resolution_note}
        </p>
      )}
    </div>
  );
}
