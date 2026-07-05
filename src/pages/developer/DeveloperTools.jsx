import { useEffect, useMemo, useState } from 'react';
import airtable from '../../api/airtable.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import registry from '../../../db/registry.json';

// Developer Tools — raw database grid (the Airtable-UI replacement, migration
// plan Phase 8). Works against EITHER backend (Airtable legacy, wellbound-api/
// Aurora) because it goes through the same wrapper as the rest of the app.
// Gated by the Developer Tools permission (engineering, not office admin):
// browse, search, sort, inline-edit, delete. Every write is server-access-
// logged (api_access_log) on the new backend.

const TABLE_NAMES = Object.keys(registry).sort();
const PAGE_SIZE = 50;

const cellStyle = {
  padding: '6px 10px',
  borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
  fontSize: 12.5,
  whiteSpace: 'nowrap',
  maxWidth: 260,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'top',
};

function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function EditableCell({ row, field, fieldDef, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const raw = row[field];
  const shown = displayValue(raw);

  async function save() {
    setSaving(true);
    try {
      let value = draft;
      if (draft === '') value = null;
      else if (fieldDef.wire === 'checkbox') value = ['true', '1', 'yes'].includes(draft.trim().toLowerCase());
      else if (fieldDef.wire === 'int' || fieldDef.wire === 'float') value = Number(draft);
      else if (fieldDef.wire === 'textArray' || fieldDef.wire === 'linkArray') {
        try { value = JSON.parse(draft); } catch { value = draft.split(',').map((s) => s.trim()).filter(Boolean); }
      }
      await onSaved(field, value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <td
        style={{ ...cellStyle, cursor: 'text' }}
        title={`${shown}\n(double-click to edit)`}
        onDoubleClick={() => { setDraft(shown); setEditing(true); }}
      >
        {shown}
      </td>
    );
  }
  return (
    <td style={{ ...cellStyle, padding: 2 }}>
      <input
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        style={{
          width: '100%', fontSize: 12.5, padding: '4px 8px',
          border: `1.5px solid ${palette.accentBlue.hex}`, borderRadius: 4, outline: 'none',
        }}
      />
    </td>
  );
}

export default function DeveloperTools() {
  const { can } = usePermissions();
  const [tableName, setTableName] = useState('Users');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState(null);

  const tableDef = registry[tableName];
  const fieldNames = useMemo(() => Object.keys(tableDef?.fields || {}), [tableDef]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(0);
    setSortCol(null);
    airtable.fetchAll(tableName)
      .then((records) => {
        if (cancelled) return;
        setRows(records.map((r) => ({ _id: r.id, ...r.fields })));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Load failed');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tableName]);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => Object.values(r).some((v) => displayValue(v).toLowerCase().includes(q)));
    }
    if (sortCol) {
      out = [...out].sort((a, b) => {
        const av = displayValue(a[sortCol]);
        const bv = displayValue(b[sortCol]);
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, sortCol, sortDir]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Legacy admin.data_tools also grants access so existing admin permission
  // records (snapshotted before developer.tools existed) keep working.
  if (!can(PERMISSION_KEYS.DEVELOPER_TOOLS) && !can(PERMISSION_KEYS.ADMIN_DATA_TOOLS)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 340, textAlign: 'center' }}>
          You need the “Developer Tools” permission to access the raw database grid.
        </p>
      </div>
    );
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  async function saveCell(rowId, field, value) {
    try {
      await airtable.update(tableName, rowId, { [field]: value });
      setRows((prev) => prev.map((r) => (r._id === rowId ? { ...r, [field]: value } : r)));
      showToast('Saved');
    } catch (err) {
      console.error('[DataGrid] save failed:', err);
      showToast(err.message || 'Save failed', 'error');
      throw err;
    }
  }

  async function deleteRow(rowId) {
    if (!window.confirm('Delete this record permanently? This cannot be undone.')) return;
    try {
      await airtable.remove(tableName, rowId);
      setRows((prev) => prev.filter((r) => r._id !== rowId));
      showToast('Deleted');
    } catch (err) {
      console.error('[DataGrid] delete failed:', err);
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  return (
    <div style={{ padding: '28px 32px', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Developer Tools</h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '4px 0 0' }}>
          Raw database grid for engineering use. Double-click a cell to edit. All changes are audit-logged.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}` }}
        >
          {TABLE_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search all fields…"
          style={{ fontSize: 13, padding: '7px 12px', borderRadius: 8, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}`, minWidth: 240 }}
        />
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          {loading ? 'Loading…' : `${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}`, background: '#fff', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>‹ Prev</button>
          <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{page + 1} / {pageCount}</span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}`, background: '#fff', cursor: page >= pageCount - 1 ? 'default' : 'pointer', opacity: page >= pageCount - 1 ? 0.4 : 1 }}>Next ›</button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>{error}</div>
      )}

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`, borderRadius: 10, background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...cellStyle, position: 'sticky', top: 0, background: hexToRgba(palette.backgroundDark.hex, 0.04), fontWeight: 650, zIndex: 1 }} />
              {fieldNames.map((f) => (
                <th
                  key={f}
                  onClick={() => {
                    if (sortCol === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                    else { setSortCol(f); setSortDir('asc'); }
                  }}
                  style={{ ...cellStyle, position: 'sticky', top: 0, background: hexToRgba(palette.backgroundDark.hex, 0.04), fontWeight: 650, cursor: 'pointer', textAlign: 'left', zIndex: 1 }}
                >
                  {f}{sortCol === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row._id}>
                <td style={{ ...cellStyle, width: 34 }}>
                  <button
                    onClick={() => deleteRow(row._id)}
                    title="Delete record"
                    style={{ border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >
                    ✕
                  </button>
                </td>
                {fieldNames.map((f) => (
                  <EditableCell
                    key={f}
                    row={row}
                    field={f}
                    fieldDef={tableDef.fields[f]}
                    onSaved={(field, value) => saveCell(row._id, field, value)}
                  />
                ))}
              </tr>
            ))}
            {!loading && pageRows.length === 0 && (
              <tr><td colSpan={fieldNames.length + 1} style={{ ...cellStyle, textAlign: 'center', padding: 28, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>No records</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '10px 16px', borderRadius: 10,
          background: toast.type === 'error' ? '#b91c1c' : palette.backgroundDark.hex,
          color: '#fff', fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
