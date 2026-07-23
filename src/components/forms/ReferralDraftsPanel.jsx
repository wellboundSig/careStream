import { useCallback, useEffect, useState } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import {
  getReferralDraftsByOwner,
  deleteReferralDraft,
} from '../../api/referralDrafts.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/**
 * Popover list of the current user's New Lead drafts.
 */
export default function ReferralDraftsPanel({ open, onClose, onOpenDraft, anchorRight = true }) {
  const { appUserId } = useCurrentAppUser();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!appUserId) return;
    setLoading(true);
    setError(null);
    try {
      const recs = await getReferralDraftsByOwner(appUserId);
      setRows(recs || []);
    } catch (err) {
      setError(err.message || 'Failed to load drafts');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [appUserId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleDelete(rec) {
    if (!rec?.id) return;
    if (!window.confirm('Discard this draft? This cannot be undone.')) return;
    setBusyId(rec.id);
    try {
      await deleteReferralDraft(rec.id);
      setRows((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }}
      />
      <div
        role="dialog"
        aria-label="Referral drafts"
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          ...(anchorRight ? { right: 0 } : { left: 0 }),
          zIndex: 41,
          width: 320,
          maxHeight: 380,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: palette.backgroundLight.hex,
          border: `1px solid var(--color-border)`,
          borderRadius: 10,
          boxShadow: `0 10px 32px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`,
        }}
      >
        <div style={{
          padding: '12px 14px',
          borderBottom: `1px solid var(--color-border)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>Drafts</p>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45),
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
          {loading && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: 12 }}>
              Loading…
            </p>
          )}
          {!loading && error && (
            <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex, padding: 12 }}>{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: 12 }}>
              No drafts yet. Start a new lead and your progress will save here.
            </p>
          )}
          {!loading && rows.map((rec) => {
            const f = rec.fields || {};
            const name = f.display_name || 'Untitled draft';
            return (
              <div
                key={rec.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 10px',
                  borderRadius: 8,
                  marginBottom: 4,
                  background: hexToRgba(palette.backgroundDark.hex, 0.03),
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenDraft?.(rec)}
                  style={{
                    flex: 1, textAlign: 'left', border: 'none', background: 'none',
                    cursor: 'pointer', padding: 0, minWidth: 0,
                  }}
                >
                  <p style={{
                    fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {name}
                  </p>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 2 }}>
                    {relativeTime(f.updated_at)}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={busyId === rec.id}
                  onClick={() => handleDelete(rec)}
                  title="Discard draft"
                  style={{
                    border: 'none',
                    background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                    color: palette.primaryMagenta.hex,
                    borderRadius: 6,
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 650,
                    cursor: busyId === rec.id ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Lightweight count fetch for a badge. */
export async function countReferralDrafts(ownerUserId) {
  if (!ownerUserId) return 0;
  const rows = await getReferralDraftsByOwner(ownerUserId, { maxRecords: 100 });
  return (rows || []).length;
}
