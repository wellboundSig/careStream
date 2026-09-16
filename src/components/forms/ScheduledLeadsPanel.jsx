import { useCallback, useEffect, useState } from 'react';
import {
  getPendingScheduledLeads,
  updateScheduledLead,
  deleteScheduledLead,
} from '../../api/scheduledLeads.js';
import { promoteScheduledLead } from '../../utils/promoteScheduledLeads.js';
import { useLookups } from '../../hooks/useLookups.js';
import { fmtDateTime } from '../../utils/dateFormat.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local) {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function parseFormData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

/**
 * Popover list of leads scheduled to go live later.
 */
export default function ScheduledLeadsPanel({ open, onClose, onChanged, anchorRight = true }) {
  const { resolveUser } = useLookups();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const recs = await getPendingScheduledLeads();
      setRows(recs || []);
    } catch (err) {
      setError(err.message || 'Failed to load scheduled leads');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleDelete(rec) {
    if (!rec?.id) return;
    if (!window.confirm('Cancel this scheduled lead? It will not go live.')) return;
    setBusyId(rec.id);
    try {
      await deleteScheduledLead(rec.id);
      setRows((prev) => prev.filter((r) => r.id !== rec.id));
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveGoLive(rec) {
    const iso = fromLocalInput(editValue);
    if (!iso) {
      setError('Pick a valid date and time');
      return;
    }
    setBusyId(rec.id);
    setError(null);
    try {
      if (new Date(iso).getTime() <= Date.now()) {
        await updateScheduledLead(rec.id, { go_live_at: iso });
        await promoteScheduledLead({
          ...rec,
          fields: { ...(rec.fields || {}), go_live_at: iso },
        });
        setRows((prev) => prev.filter((r) => r.id !== rec.id));
      } else {
        await updateScheduledLead(rec.id, { go_live_at: iso });
        setRows((prev) => prev.map((r) => (
          r.id === rec.id
            ? { ...r, fields: { ...(r.fields || {}), go_live_at: iso } }
            : r
        )));
      }
      setEditingId(null);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not update go-live time');
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
        aria-label="Scheduled leads"
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          ...(anchorRight ? { right: 0 } : { left: 0 }),
          zIndex: 41,
          width: 380,
          maxHeight: 420,
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
          <p style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>Scheduled</p>
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
            <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, padding: '8px 10px' }}>{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: 12 }}>
              No scheduled leads.
            </p>
          )}
          {!loading && rows.map((rec) => {
            const fields = rec.fields || {};
            const form = parseFormData(fields.form_data);
            const name = fields.display_name
              || [form.last_name, form.first_name].filter(Boolean).join(', ')
              || 'Untitled lead';
            const owner = resolveUser(fields.owner_user_id);
            const isEditing = editingId === rec.id;
            return (
              <div
                key={rec.id}
                style={{
                  padding: '10px 10px 8px',
                  borderRadius: 8,
                  marginBottom: 6,
                  background: hexToRgba(palette.backgroundDark.hex, 0.03),
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                  {name}
                </p>
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                  Goes live {fmtDateTime(fields.go_live_at) || '—'}
                  {owner ? ` · ${owner}` : ''}
                </p>
                {isEditing && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                    <input
                      type="datetime-local"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)',
                        fontSize: 12, fontFamily: 'inherit',
                      }}
                    />
                    <button
                      type="button"
                      disabled={busyId === rec.id}
                      onClick={() => handleSaveGoLive(rec)}
                      style={{
                        padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: palette.accentGreen.hex, color: palette.backgroundLight.hex,
                        fontSize: 11.5, fontWeight: 650,
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={busyId === rec.id}
                    onClick={() => {
                      if (isEditing) {
                        setEditingId(null);
                        return;
                      }
                      setEditingId(rec.id);
                      setEditValue(toLocalInput(fields.go_live_at));
                    }}
                    style={{
                      border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                      fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex,
                    }}
                  >
                    {isEditing ? 'Cancel edit' : 'Change date'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === rec.id}
                    onClick={() => handleDelete(rec)}
                    style={{
                      border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                      fontSize: 11.5, fontWeight: 650, color: palette.primaryMagenta.hex,
                    }}
                  >
                    {busyId === rec.id ? '…' : 'Cancel / delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export async function countPendingScheduledLeads() {
  const rows = await getPendingScheduledLeads({ maxRecords: 200 });
  return (rows || []).length;
}
