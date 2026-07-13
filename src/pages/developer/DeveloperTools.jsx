import { useEffect, useMemo, useRef, useState } from 'react';
import airtable from '../../api/airtable.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import IssueReportsPanel from '../../components/developer/IssueReportsPanel.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';
import registry from '../../../db/registry.json';

// Developer Tools — raw database grid (the Airtable-UI replacement, migration
// plan Phase 8). Works against EITHER backend (Airtable legacy, wellbound-api/
// Aurora) because it goes through the same wrapper as the rest of the app.
// Excel-style interactions: cell selection, arrow-key navigation, double-click
// or Enter to edit, drag the fill handle to copy a value down/up, row-header
// selection + typed confirmation to delete. Every write is server-access-
// logged (api_access_log) on the new backend.

const TABLE_NAMES = Object.keys(registry).sort();
// Continuous scroll: rows render in chunks as you scroll (no pagination), so
// big tables (3k+ physicians) don't dump 100k+ DOM cells at once.
const SCROLL_CHUNK = 250;

// Frontend speed-bump, NOT a security boundary (the real controls are the
// permission gate, server-side Clerk auth, and the api_access_log audit
// trail). This exists purely to stop an accidental wander into raw-table
// editing. Unlock lasts for the browser session.
const DEV_TOOLS_PASSWORD = 'qYH7tLX91H!';
const UNLOCK_KEY = 'wb_devtools_unlocked';

// ── Excel-ish visual constants ────────────────────────────────────────────────
const GRID_LINE = '#d4d4d8';
const HEADER_BG = '#f4f4f5';           // fully opaque — never mixes with rows
const SELECT_BLUE = '#1a73e8';
const FILL_BG = 'rgba(26, 115, 232, 0.08)';
const ROW_NUM_W = 46;
const COL_W = 168;

function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Parse a draft string back into a typed value for the given field. */
function parseDraft(draft, fieldDef) {
  if (draft === '') return null;
  if (fieldDef.wire === 'checkbox') return ['true', '1', 'yes'].includes(draft.trim().toLowerCase());
  if (fieldDef.wire === 'int' || fieldDef.wire === 'float') return Number(draft);
  if (fieldDef.wire === 'textArray' || fieldDef.wire === 'linkArray') {
    try { return JSON.parse(draft); } catch { return draft.split(',').map((s) => s.trim()).filter(Boolean); }
  }
  return draft;
}

export default function DeveloperTools() {
  const { can } = usePermissions();
  const { appUser } = useCurrentAppUser();
  const isSupportStaff = !!(
    appUser?.is_support_staff === true
    || appUser?.is_support_staff === 'true'
    || appUser?.is_support_staff === 'TRUE'
    || appUser?.is_support_staff === 1
  );
  const canUseGrid = can(PERMISSION_KEYS.DEVELOPER_TOOLS) || can(PERMISSION_KEYS.ADMIN_DATA_TOOLS);

  const [view, setView] = useState(() => (isSupportStaff ? 'reports' : 'grid'));

  useEffect(() => {
    if (isSupportStaff && !canUseGrid) setView('reports');
  }, [isSupportStaff, canUseGrid]);

  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
  });
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const [tableName, setTableName] = useState('Users');
  const [tableQuery, setTableQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCount, setVisibleCount] = useState(SCROLL_CHUNK);
  const [toast, setToast] = useState(null);

  // Excel-style interaction state.
  const [sel, setSel] = useState(null);            // { r, c } — page-row index + column index
  const [editing, setEditing] = useState(null);    // { r, c }
  const [draft, setDraft] = useState('');
  const [fillEnd, setFillEnd] = useState(null);    // row index the fill drag currently covers
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [colWidths, setColWidths] = useState({});  // field -> px (drag header edge)
  const [expandedRows, setExpandedRows] = useState(() => new Set()); // row ids with wrapped cells

  const fillDragRef = useRef(null);                // { anchorR, c } during drag
  const colResizeRef = useRef(null);               // { field, startX, startW } during drag
  const gridRef = useRef(null);

  const tableDef = registry[tableName];
  const fieldNames = useMemo(() => Object.keys(tableDef?.fields || {}), [tableDef]);

  useEffect(() => {
    if (!unlocked) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisibleCount(SCROLL_CHUNK);
    setSortCol(null);
    setSel(null);
    setEditing(null);
    setSelectedRowId(null);
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
  }, [tableName, unlocked]);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => Object.values(r).some((v) => displayValue(v).toLowerCase().includes(q)));
    }
    if (sortCol) {
      out = [...out].sort((a, b) => {
        const cmp = displayValue(a[sortCol]).localeCompare(displayValue(b[sortCol]), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, sortCol, sortDir]);

  const pageRows = filtered.slice(0, visibleCount);

  function onGridScroll(e) {
    const el = e.currentTarget;
    if (visibleCount < filtered.length && el.scrollTop + el.clientHeight > el.scrollHeight - 800) {
      setVisibleCount((c) => Math.min(c + SCROLL_CHUNK, filtered.length));
    }
  }

  // ── Gates ──────────────────────────────────────────────────────────────────
  // Support staff can open this page for Issue Reports even without the
  // developer-tools permission. The raw database grid still requires both
  // permission and the session password.
  if (!canUseGrid && !isSupportStaff) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, padding: 48 }}>
        <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex }}>Access Restricted</p>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 340, textAlign: 'center' }}>
          You need the “Developer Tools” permission or support-staff access to open this page.
        </p>
      </div>
    );
  }

  function tryUnlock() {
    if (passwordDraft === DEV_TOOLS_PASSWORD) {
      try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch { /* private mode */ }
      setUnlocked(true);
      setPasswordDraft('');
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  }

  const showReports = isSupportStaff && (view === 'reports' || !canUseGrid);
  const showGridGate = canUseGrid && view === 'grid' && !unlocked;
  const showGrid = canUseGrid && view === 'grid' && unlocked;

  // Tab chrome when the user can see both surfaces
  const tabBar = (isSupportStaff && canUseGrid) ? (
    <div style={{
      display: 'flex', gap: 4, padding: '10px 14px 0',
      borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
      background: palette.backgroundLight.hex, flexShrink: 0,
    }}>
      {[
        { id: 'reports', label: 'Issue Reports' },
        { id: 'grid', label: 'Database Grid' },
      ].map((t) => {
        const active = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            style={{
              padding: '9px 14px', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${active ? palette.primaryMagenta.hex : 'transparent'}`,
              background: 'none',
              fontSize: 12.5, fontWeight: active ? 650 : 450,
              color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  ) : null;

  if (showReports) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: palette.backgroundLight.hex }}>
        {tabBar}
        <div style={{ flex: 1, minHeight: 0 }}>
          <IssueReportsPanel />
        </div>
      </div>
    );
  }

  if (showGridGate) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {tabBar}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 48 }}>
          <div style={{
            background: '#fff', border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
            borderRadius: 14, padding: '32px 36px', maxWidth: 380, width: '100%',
            boxShadow: '0 10px 30px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Developer Tools</p>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '6px 0 0', lineHeight: 1.5 }}>
                This is direct, unguarded access to the live database.
              </p>
            </div>
            <input
              type="password"
              autoFocus
              value={passwordDraft}
              placeholder="Developer password"
              onChange={(e) => { setPasswordDraft(e.target.value); setPasswordError(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') tryUnlock(); }}
              style={{
                fontSize: 13.5, padding: '10px 12px', borderRadius: 8,
                border: `1.5px solid ${passwordError ? '#dc2626' : hexToRgba(palette.backgroundDark.hex, 0.2)}`,
                outline: 'none',
              }}
            />
            {passwordError && (
              <p style={{ fontSize: 12, color: '#dc2626', margin: '-6px 0 0' }}>Incorrect password.</p>
            )}
            <button
              onClick={tryUnlock}
              style={{
                fontSize: 13.5, fontWeight: 650, padding: '10px 12px', borderRadius: 8,
                border: 'none', background: palette.backgroundDark.hex, color: '#fff', cursor: 'pointer',
              }}
            >
              Unlock
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showGrid) {
    return null;
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  async function saveCell(rowId, field, value) {
    await airtable.update(tableName, rowId, { [field]: value });
    setRows((prev) => prev.map((r) => (r._id === rowId ? { ...r, [field]: value } : r)));
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  function startEdit(r, c) {
    const row = pageRows[r];
    const field = fieldNames[c];
    if (!row || !field) return;
    setEditing({ r, c });
    setDraft(displayValue(row[field]));
  }

  async function commitEdit({ moveDown = false } = {}) {
    if (!editing) return;
    const { r, c } = editing;
    const row = pageRows[r];
    const field = fieldNames[c];
    setEditing(null);
    if (!row || !field) return;
    const value = parseDraft(draft, tableDef.fields[field]);
    if (displayValue(row[field]) !== displayValue(value)) {
      try {
        await saveCell(row._id, field, value);
        showToast('Saved');
      } catch (err) {
        console.error('[DeveloperTools] save failed:', err);
        showToast(err.message || 'Save failed', 'error');
      }
    }
    if (moveDown) setSel({ r: Math.min(r + 1, pageRows.length - 1), c });
    gridRef.current?.focus();
  }

  // ── Fill handle (drag to copy down/up, same column) ───────────────────────
  function startFillDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!sel) return;
    fillDragRef.current = { anchorR: sel.r, c: sel.c };
    setFillEnd(sel.r);
    const onUp = () => {
      window.removeEventListener('mouseup', onUp);
      applyFill();
    };
    window.addEventListener('mouseup', onUp);
  }

  async function applyFill() {
    const drag = fillDragRef.current;
    fillDragRef.current = null;
    setFillEnd((endR) => {
      if (drag && endR !== null && endR !== drag.anchorR) {
        const field = fieldNames[drag.c];
        const source = pageRows[drag.anchorR];
        const value = source?.[field] ?? null;
        const [lo, hi] = endR > drag.anchorR ? [drag.anchorR + 1, endR] : [endR, drag.anchorR - 1];
        const targets = pageRows.slice(lo, hi + 1).filter(Boolean);
        (async () => {
          let ok = 0;
          for (const row of targets) {
            try { await saveCell(row._id, field, value); ok++; }
            catch (err) { console.error('[DeveloperTools] fill failed:', err); }
          }
          showToast(ok === targets.length ? `Filled ${ok} cell${ok === 1 ? '' : 's'}` : `Filled ${ok}/${targets.length} (some failed)`, ok === targets.length ? 'success' : 'error');
        })();
      }
      return null;
    });
  }

  // ── Row deletion (row-header selection + typed confirmation) ──────────────
  async function deleteSelectedRow() {
    if (deleteText !== 'DELETE' || !selectedRowId) return;
    try {
      await airtable.remove(tableName, selectedRowId);
      setRows((prev) => prev.filter((r) => r._id !== selectedRowId));
      showToast('Row deleted');
    } catch (err) {
      console.error('[DeveloperTools] delete failed:', err);
      showToast(err.message || 'Delete failed', 'error');
    }
    setSelectedRowId(null);
    setConfirmingDelete(false);
    setDeleteText('');
  }

  // ── Column resize (drag the right edge of a header, Excel-style) ──────────
  function startColResize(e, field) {
    e.preventDefault();
    e.stopPropagation();
    colResizeRef.current = { field, startX: e.clientX, startW: colWidths[field] || COL_W };
    const onMove = (ev) => {
      const drag = colResizeRef.current;
      if (!drag) return;
      const w = Math.max(64, drag.startW + (ev.clientX - drag.startX));
      setColWidths((prev) => ({ ...prev, [drag.field]: w }));
    };
    const onUp = () => {
      colResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Keyboard navigation (arrows, Enter, Escape, F2) ───────────────────────
  function onGridKeyDown(e) {
    if (editing) return; // the input handles its own keys
    if (!sel) return;
    const move = (dr, dc) => {
      e.preventDefault();
      setSel(({ r, c }) => ({
        r: Math.max(0, Math.min(pageRows.length - 1, r + dr)),
        c: Math.max(0, Math.min(fieldNames.length - 1, c + dc)),
      }));
    };
    if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === 'Tab') move(0, e.shiftKey ? -1 : 1);
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(sel.r, sel.c); }
    else if (e.key === 'Escape') setSel(null);
  }

  const inFillRange = (r) => {
    const drag = fillDragRef.current;
    if (!drag || fillEnd === null) return false;
    const [lo, hi] = fillEnd > drag.anchorR ? [drag.anchorR, fillEnd] : [fillEnd, drag.anchorR];
    return r >= lo && r <= hi;
  };

  const tableMatches = tableQuery.trim()
    ? TABLE_NAMES.filter((t) => t.toLowerCase().includes(tableQuery.trim().toLowerCase()))
    : [];

  const btn = {
    fontSize: 12.5, padding: '6px 12px', border: `1px solid ${GRID_LINE}`,
    background: '#fff', cursor: 'pointer', borderRadius: 6,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {tabBar}
      <div style={{ padding: '24px 28px', flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>Developer Tools</h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), margin: '4px 0 0' }}>
          Raw database grid. Click a cell, Enter or double-click to edit, drag the corner handle to copy down.
          Drag a column edge to resize. Click a row number to select; double-click it to expand the row. All changes are audit-logged.
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={tableQuery}
            onChange={(e) => setTableQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tableMatches.length) { setTableName(tableMatches[0]); setTableQuery(''); }
              if (e.key === 'Escape') setTableQuery('');
            }}
            placeholder="Find a table…"
            style={{ fontSize: 13, padding: '7px 12px', border: `1px solid ${GRID_LINE}`, borderRadius: 6, width: 180 }}
          />
          {tableMatches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4, width: 240,
              background: '#fff', border: `1px solid ${GRID_LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              maxHeight: 260, overflow: 'auto', borderRadius: 6,
            }}>
              {tableMatches.slice(0, 12).map((t) => (
                <div
                  key={t}
                  onMouseDown={() => { setTableName(t); setTableQuery(''); }}
                  style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = HEADER_BG; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                >
                  {t}
                </div>
              ))}
            </div>
          )}
        </div>
        <select
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          style={{ fontSize: 13, padding: '7px 10px', border: `1px solid ${GRID_LINE}`, borderRadius: 6 }}
        >
          {TABLE_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(SCROLL_CHUNK); }}
          placeholder="Search records…"
          style={{ fontSize: 13, padding: '7px 12px', border: `1px solid ${GRID_LINE}`, borderRadius: 6, minWidth: 200 }}
        />
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          {loading
            ? 'Loading…'
            : `${filtered.length} record${filtered.length === 1 ? '' : 's'}${pageRows.length < filtered.length ? ` · showing ${pageRows.length} — scroll for more` : ''}`}
        </span>

        {selectedRowId && (
          <button
            onClick={() => { setConfirmingDelete(true); setDeleteText(''); }}
            style={{ ...btn, color: '#b91c1c', borderColor: '#fca5a5', fontWeight: 600 }}
          >
            Delete selected row…
          </button>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', padding: '10px 14px', border: '1px solid #fecaca' }}>{error}</div>
      )}

      {/* Grid */}
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onScroll={onGridScroll}
        style={{ flex: 1, overflow: 'auto', border: `1px solid ${GRID_LINE}`, background: '#fff', outline: 'none' }}
      >
        <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky', top: 0, left: 0, zIndex: 3, width: ROW_NUM_W, minWidth: ROW_NUM_W,
                background: HEADER_BG, border: `1px solid ${GRID_LINE}`, fontSize: 11.5,
                color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: '7px 4px',
              }}>#</th>
              {fieldNames.map((f) => {
                const w = colWidths[f] || COL_W;
                return (
                  <th
                    key={f}
                    onClick={() => {
                      if (colResizeRef.current) return; // don't sort mid-resize
                      if (sortCol === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      else { setSortCol(f); setSortDir('asc'); }
                    }}
                    style={{
                      position: 'sticky', top: 0, zIndex: 2, width: w, minWidth: w, maxWidth: w,
                      background: HEADER_BG, border: `1px solid ${GRID_LINE}`,
                      fontSize: 12, fontWeight: 650, textAlign: 'left', padding: '7px 10px',
                      cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      color: palette.backgroundDark.hex, userSelect: 'none',
                    }}
                    title={f}
                  >
                    {f}{sortCol === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    <div
                      onMouseDown={(e) => startColResize(e, f)}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to resize column"
                      style={{
                        position: 'absolute', top: 0, right: -3, width: 7, height: '100%',
                        cursor: 'col-resize', zIndex: 3,
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, r) => {
              const rowSelected = selectedRowId === row._id;
              const rowExpanded = expandedRows.has(row._id);
              return (
                <tr key={row._id}>
                  <td
                    onClick={() => { setSelectedRowId(rowSelected ? null : row._id); setSel(null); setEditing(null); }}
                    onDoubleClick={() => {
                      setExpandedRows((prev) => {
                        const next = new Set(prev);
                        if (next.has(row._id)) next.delete(row._id); else next.add(row._id);
                        return next;
                      });
                    }}
                    title="Click to select · double-click to expand/collapse the row"
                    style={{
                      position: 'sticky', left: 0, zIndex: 1, width: ROW_NUM_W, minWidth: ROW_NUM_W,
                      background: rowSelected ? SELECT_BLUE : HEADER_BG,
                      color: rowSelected ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.55),
                      border: `1px solid ${GRID_LINE}`, fontSize: 11.5, textAlign: 'center',
                      padding: '5px 4px', cursor: 'pointer', userSelect: 'none', verticalAlign: 'top',
                    }}
                  >
                    {r + 1}{rowExpanded ? ' ▾' : ''}
                  </td>
                  {fieldNames.map((f, c) => {
                    const w = colWidths[f] || COL_W;
                    const isSel = sel && sel.r === r && sel.c === c;
                    const isEditing = editing && editing.r === r && editing.c === c;
                    const fillHighlight = fillDragRef.current?.c === c && inFillRange(r);
                    const shown = displayValue(row[f]);
                    // Layout-stable base: border stays 1px and padding stays
                    // constant in EVERY state; selection/editing draw an inset
                    // box-shadow which never shifts the grid (Excel-tight).
                    const baseCell = {
                      position: 'relative', width: w, minWidth: w, maxWidth: w,
                      border: `1px solid ${GRID_LINE}`,
                      fontSize: 12.5, verticalAlign: 'top',
                      ...(rowExpanded
                        ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
                        : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                    };
                    if (isEditing) {
                      return (
                        <td key={f} style={{ ...baseCell, padding: 0, background: '#fff', boxShadow: `inset 0 0 0 2px ${SELECT_BLUE}` }}>
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit({ moveDown: true }); }
                              if (e.key === 'Escape') { setEditing(null); gridRef.current?.focus(); }
                              if (e.key === 'Tab') { e.preventDefault(); commitEdit(); setSel({ r, c: Math.min(c + 1, fieldNames.length - 1) }); }
                            }}
                            onBlur={() => commitEdit()}
                            style={{
                              width: '100%', fontSize: 12.5, padding: '5px 9px', border: 'none',
                              outline: 'none', fontFamily: 'inherit', background: 'transparent', display: 'block',
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={f}
                        onClick={() => { setSel({ r, c }); setSelectedRowId(null); gridRef.current?.focus(); }}
                        onDoubleClick={() => { setSel({ r, c }); startEdit(r, c); }}
                        onMouseEnter={() => { if (fillDragRef.current) setFillEnd(r); }}
                        title={shown}
                        style={{
                          ...baseCell,
                          padding: '5px 9px',
                          boxShadow: isSel ? `inset 0 0 0 2px ${SELECT_BLUE}` : 'none',
                          background: fillHighlight ? FILL_BG : rowSelected ? 'rgba(26,115,232,0.05)' : '#fff',
                          cursor: 'cell', userSelect: 'none',
                        }}
                      >
                        {shown}
                        {isSel && !fillDragRef.current && (
                          <div
                            onMouseDown={startFillDrag}
                            title="Drag to copy this value to the rows below"
                            style={{
                              position: 'absolute', right: 0, bottom: 0, width: 9, height: 9,
                              background: SELECT_BLUE, border: '1.5px solid #fff', cursor: 'crosshair', zIndex: 2,
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={fieldNames.length + 1} style={{ border: `1px solid ${GRID_LINE}`, textAlign: 'center', padding: 28, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      {confirmingDelete && selectedRowId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '26px 30px', maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#b91c1c', margin: 0 }}>Permanently delete this record?</p>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), margin: 0, lineHeight: 1.5 }}>
              Row <code style={{ fontSize: 11.5 }}>{selectedRowId}</code> in <strong>{tableName}</strong> will be deleted
              from the live database. This cannot be undone. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              autoFocus
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') deleteSelectedRow(); if (e.key === 'Escape') { setConfirmingDelete(false); setDeleteText(''); } }}
              placeholder="Type DELETE"
              style={{ fontSize: 13.5, padding: '9px 12px', border: `1.5px solid ${GRID_LINE}`, borderRadius: 8, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setConfirmingDelete(false); setDeleteText(''); }} style={{ ...btn, padding: '8px 14px' }}>Cancel</button>
              <button
                onClick={deleteSelectedRow}
                disabled={deleteText !== 'DELETE'}
                style={{
                  ...btn, padding: '8px 14px', fontWeight: 650, border: 'none',
                  background: deleteText === 'DELETE' ? '#b91c1c' : '#fca5a5', color: '#fff',
                  cursor: deleteText === 'DELETE' ? 'pointer' : 'default',
                }}
              >
                Delete record
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '10px 16px', borderRadius: 10,
          background: toast.type === 'error' ? '#b91c1c' : palette.backgroundDark.hex,
          color: '#fff', fontSize: 13, fontWeight: 600, zIndex: 4000, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {toast.msg}
        </div>
      )}
      </div>
    </div>
  );
}
