import { useState, useMemo, useEffect, useRef } from 'react';
import { useEsperClinicians } from '../../hooks/useEsperClinicians.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { canViewDirectory } from '../../data/directoryPermissions.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import LoadingState from '../../components/common/LoadingState.jsx';
import ClinicianDrawer from '../../components/clinicians/ClinicianDrawer.jsx';
import TabletIcon from '../../components/clinicians/TabletIcon.jsx';
import {
  useColumnVisibility,
  useColumnFilters,
  FilterInput,
  ColumnPicker,
  FilterIcon,
  ColsIcon,
} from '../../utils/columnModel.jsx';
import {
  titleCase,
  timeAgo,
  modelLabel,
  osLabel,
} from '../../utils/clinicianInfo.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const DISC_COLORS = {
  RN: palette.primaryMagenta.hex, LPN: palette.primaryMagenta.hex,
  PT: palette.accentBlue.hex, OT: palette.accentOrange.hex,
  SLP: palette.accentGreen.hex, ST: palette.accentGreen.hex,
  HHA: palette.highlightYellow.hex, ABA: palette.primaryDeepPlum.hex,
  PTA: hexToRgba(palette.accentBlue.hex, 0.7), OTA: hexToRgba(palette.accentOrange.hex, 0.7),
  NP: palette.primaryMagenta.hex, PA: hexToRgba(palette.primaryMagenta.hex, 0.7),
};

// Column catalog. `alwaysOn` columns can't be hidden in the picker. `filterable`
// columns surface their input in the filter row that toggles via the Filters
// button. The order here is the order they appear in the table.
const COLUMN_DEFS = [
  { key: 'tablet',     label: 'Hardware', defaultOn: true,  alwaysOn: true,  filterable: false },
  { key: 'name',       label: 'Name',      defaultOn: true,  alwaysOn: true,  sortField: 'name', filterable: false },
  { key: 'workerId',   label: 'Worker ID', defaultOn: true,  filterable: true, sortField: 'workerId' },
  { key: 'discipline', label: 'Discipline', defaultOn: true, filterable: true, sortField: 'discipline' },
  { key: 'zip',        label: 'ZIP',       defaultOn: true,  filterable: true, sortField: 'zip' },
  { key: 'model',      label: 'Model',     defaultOn: false, filterable: true },
  { key: 'os',         label: 'OS',        defaultOn: false, filterable: true },
  { key: 'battery',    label: 'Battery',   defaultOn: true,  filterable: false, sortField: 'battery' },
  { key: 'lastSeen',   label: 'Last seen', defaultOn: true,  filterable: false, sortField: 'lastSeen' },
  { key: 'gps',        label: 'GPS',       defaultOn: true,  filterable: false },
  { key: 'status',     label: 'Status',    defaultOn: true,  filterable: false, sortField: 'online' },
];

const ONLINE_TABS = [
  { id: 'all',     label: 'All' },
  { id: 'online',  label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'lowbat',  label: 'Low battery' },
  { id: 'nogps',   label: 'No GPS' },
];

export default function Clinicians() {
  const { clinicians: rawClinicians, loading, error, refresh, cachedAt } = useEsperClinicians();
  const [selected, setSelected]     = useState(null);
  const [search, setSearch]         = useState('');
  const [statusTab, setStatusTab]   = useState('all');
  const [discFilter, setDiscFilter] = useState('');
  const [sortField, setSortField]   = useState('name');
  const [sortDir, setSortDir]       = useState('asc');
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef(null);

  const { visibleCols, setVisibleCols, activeColumns } = useColumnVisibility(COLUMN_DEFS);
  const { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters: colsHaveFilters } = useColumnFilters(COLUMN_DEFS);

  useEffect(() => {
    function onClick(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setShowColPicker(false);
    }
    if (showColPicker) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [showColPicker]);

  const { can } = usePermissions();
  if (!canViewDirectory(can, 'clinicians')) return <AccessDenied message="You do not have permission to view the Clinicians directory." />;

  // Deduplicate by name; prefer the online record when duplicates exist.
  const clinicians = useMemo(() => {
    const complete = rawClinicians.filter((c) => c.name && c.workerId && c.discipline);

    const byName = {};
    complete.forEach((c) => {
      const key = c.name.toLowerCase().trim();
      if (!byName[key]) {
        byName[key] = c;
      } else {
        const existing = byName[key];
        if (c.online && !existing.online) byName[key] = c;
      }
    });

    return Object.values(byName).map((c) => ({
      ...c,
      displayName: titleCase(c.name),
      discipline:  c.discipline.toUpperCase(),
    }));
  }, [rawClinicians]);

  const disciplines = useMemo(() => {
    const set = new Set();
    clinicians.forEach((c) => { if (c.discipline) set.add(c.discipline); });
    return [...set].sort();
  }, [clinicians]);

  // Distinct values for each filterable column — feeds the datalist autocomplete.
  const colOptions = useMemo(() => {
    const opts = {};
    COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      clinicians.forEach((c) => {
        switch (col.key) {
          case 'workerId':   if (c.workerId)   vals.add(c.workerId); break;
          case 'discipline': if (c.discipline) vals.add(c.discipline); break;
          case 'zip':        if (c.zip)        vals.add(c.zip); break;
          case 'model':      { const m = modelLabel(c.device?.hardware); if (m) vals.add(m); break; }
          case 'os':         { const o = osLabel(c.device?.software);   if (o) vals.add(o); break; }
        }
      });
      opts[col.key] = [...vals].sort();
    });
    return opts;
  }, [clinicians]);

  const filtered = useMemo(() => {
    let list = clinicians;

    if (statusTab === 'online')  list = list.filter((c) => c.online);
    if (statusTab === 'offline') list = list.filter((c) => !c.online);
    if (statusTab === 'lowbat')  list = list.filter((c) => (c.device?.power?.batteryLevel ?? 100) <= 25);
    if (statusTab === 'nogps')   list = list.filter((c) => !c.location?.lat);

    if (discFilter) list = list.filter((c) => c.discipline === discFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.workerId || '').toLowerCase().includes(q) ||
        c.discipline.toLowerCase().includes(q) ||
        (c.zip || '').includes(q) ||
        (modelLabel(c.device?.hardware) || '').toLowerCase().includes(q),
      );
    }

    for (const [key, val] of Object.entries(colFilters)) {
      if (!val?.trim()) continue;
      const q = val.toLowerCase();
      list = list.filter((c) => {
        switch (key) {
          case 'workerId':   return (c.workerId || '').toLowerCase().includes(q);
          case 'discipline': return c.discipline.toLowerCase().includes(q);
          case 'zip':        return (c.zip || '').toLowerCase().includes(q);
          case 'model':      return (modelLabel(c.device?.hardware) || '').toLowerCase().includes(q);
          case 'os':         return (osLabel(c.device?.software)   || '').toLowerCase().includes(q);
          default: return true;
        }
      });
    }

    return [...list].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'name':       return a.displayName.localeCompare(b.displayName) * mul;
        case 'workerId':   return (a.workerId || '').localeCompare(b.workerId || '') * mul;
        case 'discipline': return a.discipline.localeCompare(b.discipline) * mul;
        case 'zip':        return (a.zip || '').localeCompare(b.zip || '') * mul;
        case 'battery':    return (((a.device?.power?.batteryLevel ?? -1)) - ((b.device?.power?.batteryLevel ?? -1))) * mul;
        case 'lastSeen': {
          const ta = new Date(a.device?.lastSeen || a.location?.lastSeen || 0).getTime();
          const tb = new Date(b.device?.lastSeen || b.location?.lastSeen || 0).getTime();
          return (ta - tb) * mul;
        }
        case 'online':     return (Number(a.online) - Number(b.online)) * mul;
        default: return 0;
      }
    });
  }, [clinicians, search, discFilter, statusTab, sortField, sortDir, colFilters]);

  function toggleSort(field) {
    if (!field) return;
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir(field === 'lastSeen' || field === 'battery' ? 'desc' : 'asc'); }
  }

  const anyFilters = colsHaveFilters || statusTab !== 'all' || !!discFilter || !!search.trim();
  function clearAll() { clearFilters(); setStatusTab('all'); setDiscFilter(''); setSearch(''); }

  if (loading && !rawClinicians.length) return <LoadingState message="Loading clinicians from Esper..." />;

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Clinicians</h1>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
              {filtered.length} of {clinicians.length} clinicians
              {cachedAt && (
                <span style={{ marginLeft: 8, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
                  · updated {timeAgo(cachedAt)}
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 34, width: 240 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID, model…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
            </div>
            <select value={discFilter} onChange={(e) => setDiscFilter(e.target.value)} style={{ height: 34, padding: '0 10px', borderRadius: 8, border: `1px solid ${discFilter ? palette.accentBlue.hex : 'var(--color-border)'}`, background: discFilter ? hexToRgba(palette.accentBlue.hex, 0.07) : palette.backgroundLight.hex, fontSize: 12.5, color: discFilter ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer', fontFamily: 'inherit', fontWeight: discFilter ? 600 : 400 }}>
              <option value="">All disciplines</option>
              {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={() => setShowFilters((v) => !v)}
              title={showFilters ? 'Hide column filters' : 'Show column filters'}
              style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 550, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}
            >
              <FilterIcon /> Filters
              {colsHaveFilters && <span style={{ width: 5, height: 5, borderRadius: '50%', background: palette.accentBlue.hex }} />}
            </button>
            <div ref={colPickerRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowColPicker((v) => !v)}
                title="Customize columns"
                style={{ height: 34, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, border: `1px solid ${showColPicker ? palette.primaryMagenta.hex : 'var(--color-border)'}`, background: showColPicker ? hexToRgba(palette.primaryMagenta.hex, 0.07) : palette.backgroundLight.hex, fontSize: 12.5, fontWeight: 550, color: showColPicker ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}
              >
                <ColsIcon /> Columns
              </button>
              {showColPicker && (
                <ColumnPicker
                  columnDefs={COLUMN_DEFS}
                  visibleCols={visibleCols}
                  onChange={setVisibleCols}
                  onClose={() => setShowColPicker(false)}
                />
              )}
            </div>
            <button
              onClick={refresh}
              title="Force refresh from Esper"
              style={{ height: 34, padding: '0 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`, fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115.32-6.36L21 8M21 3v5h-5M21 12a9 9 0 01-15.32 6.36L3 16M3 21v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Status quick-filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {ONLINE_TABS.map((t) => {
            const count = t.id === 'all' ? clinicians.length
              : t.id === 'online'  ? clinicians.filter((c) => c.online).length
              : t.id === 'offline' ? clinicians.filter((c) => !c.online).length
              : t.id === 'lowbat'  ? clinicians.filter((c) => (c.device?.power?.batteryLevel ?? 100) <= 25).length
              : t.id === 'nogps'   ? clinicians.filter((c) => !c.location?.lat).length
              : 0;
            const active = statusTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setStatusTab(t.id)}
                style={{
                  padding: '5px 11px',
                  borderRadius: 16,
                  border: active ? `1px solid ${palette.primaryDeepPlum.hex}` : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
                  background: active ? palette.primaryDeepPlum.hex : 'transparent',
                  color: active ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.55),
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.12s',
                }}
              >
                {t.label}
                <span style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '0 6px',
                  borderRadius: 8,
                  background: active ? 'rgba(255,255,255,0.18)' : hexToRgba(palette.backgroundDark.hex, 0.06),
                  color: active ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.45),
                }}>{count}</span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          {anyFilters && (
            <button onClick={clearAll} style={{ height: 28, padding: '0 11px', borderRadius: 7, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`, background: palette.backgroundLight.hex, fontSize: 11.5, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer' }}>
              Clear all
            </button>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 12 }}>Esper error: {error}</p>}

        <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
                  {activeColumns.map((col) => {
                    const isSort = !!col.sortField;
                    const active = sortField === col.sortField;
                    return (
                      <th
                        key={col.key}
                        onClick={isSort ? () => toggleSort(col.sortField) : undefined}
                        style={{
                          padding: '9px 14px',
                          textAlign: col.key === 'tablet' ? 'center' : col.key === 'battery' || col.key === 'status' || col.key === 'gps' ? 'center' : 'left',
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          color: hexToRgba(palette.backgroundDark.hex, active ? 0.7 : 0.4),
                          cursor: isSort ? 'pointer' : 'default',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                          width: col.key === 'tablet' ? 50 : undefined,
                        }}
                      >
                        {col.label}{isSort && active && <span style={{ fontSize: 8 }}> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                      </th>
                    );
                  })}
                </tr>
                {showFilters && (
                  <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: '1px solid var(--color-border)' }}>
                    {activeColumns.map((col) => (
                      <th key={col.key} style={{ padding: '4px 8px' }}>
                        {col.filterable ? (
                          <FilterInput
                            value={colFilters[col.key] || ''}
                            onChange={(v) => setColFilter(col.key, v)}
                            placeholder={col.label}
                            options={colOptions[col.key] || []}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={activeColumns.length} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                    {anyFilters ? 'No clinicians match the current filters.' : 'No clinicians found.'}
                  </td></tr>
                ) : filtered.map((c) => (
                  <ClinicianRow
                    key={c.id}
                    clinician={c}
                    activeColumns={activeColumns}
                    onOpen={() => setSelected(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ClinicianDrawer clinician={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ClinicianRow({ clinician, activeColumns, onOpen }) {
  const dc = DISC_COLORS[clinician.discipline] || hexToRgba(palette.backgroundDark.hex, 0.5);
  const battery = clinician.device?.power?.batteryLevel ?? null;
  const model = modelLabel(clinician.device?.hardware);
  const os = osLabel(clinician.device?.software);
  const lastSeenIso = clinician.device?.lastSeen || clinician.location?.lastSeen;
  const hasGPS = !!clinician.location?.lat;

  return (
    <tr
      onClick={onOpen}
      title="Click to view snapshot"
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer', transition: 'background 0.1s' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {activeColumns.map((col) => {
        switch (col.key) {
          case 'tablet':
            return (
              <td key={col.key} style={{ padding: '11px 6px', textAlign: 'center', width: 50 }}>
                <TabletIcon
                  online={clinician.online}
                  battery={battery}
                  size={18}
                  title={`${model || 'Tablet'} · ${clinician.online ? 'Online' : 'Offline'}${battery != null ? ` · ${battery}%` : ''}`}
                />
              </td>
            );
          case 'name':
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>
                {clinician.displayName}
              </td>
            );
          case 'workerId':
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {clinician.workerId}
              </td>
            );
          case 'discipline':
            return (
              <td key={col.key} style={{ padding: '11px 14px' }}>
                <span style={{ fontSize: 12, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: hexToRgba(dc, 0.14), color: dc }}>
                  {clinician.discipline}
                </span>
              </td>
            );
          case 'zip':
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 12.5, color: clinician.zip ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.25) }}>
                {clinician.zip || '—'}
              </td>
            );
          case 'model':
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 12.5, color: model ? hexToRgba(palette.backgroundDark.hex, 0.7) : hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                {model || '—'}
              </td>
            );
          case 'os':
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 12, color: os ? hexToRgba(palette.backgroundDark.hex, 0.6) : hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                {os || '—'}
              </td>
            );
          case 'battery':
            return (
              <td key={col.key} style={{ padding: '11px 14px', textAlign: 'center' }}>
                <BatteryPill level={battery} />
              </td>
            );
          case 'lastSeen': {
            const ago = timeAgo(lastSeenIso);
            const minsAgo = lastSeenIso ? (Date.now() - new Date(lastSeenIso).getTime()) / 60000 : null;
            const stale = minsAgo != null && minsAgo > 60 * 24; // >24h
            return (
              <td key={col.key} style={{ padding: '11px 14px', fontSize: 12, color: ago ? (stale ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6)) : hexToRgba(palette.backgroundDark.hex, 0.3) }}>
                {ago || '—'}
              </td>
            );
          }
          case 'gps':
            return (
              <td key={col.key} style={{ padding: '11px 14px', textAlign: 'center' }}>
                {hasGPS ? (
                  <span title={`${clinician.location.lat.toFixed(4)}, ${clinician.location.lon.toFixed(4)}`}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: hexToRgba(palette.accentBlue.hex, 0.14), color: palette.accentBlue.hex }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                      <path d="M12 22s-7-7.5-7-13a7 7 0 1114 0c0 5.5-7 13-7 13z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>
                )}
              </td>
            );
          case 'status':
            return (
              <td key={col.key} style={{ padding: '11px 14px', textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: clinician.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: clinician.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.2) }} />
                  {clinician.online ? 'Online' : 'Offline'}
                </span>
              </td>
            );
          default: return <td key={col.key} />;
        }
      })}
    </tr>
  );
}

function BatteryPill({ level }) {
  if (level == null) {
    return <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>;
  }
  const color = level <= 15 ? palette.primaryMagenta.hex : level <= 35 ? palette.accentOrange.hex : palette.accentGreen.hex;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ position: 'relative', width: 28, height: 12, borderRadius: 3, border: `1.4px solid ${hexToRgba(palette.backgroundDark.hex, 0.18)}`, boxSizing: 'border-box', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${level}%`, background: color }} />
        <span style={{ position: 'absolute', right: -3, top: 3, width: 2, height: 6, background: hexToRgba(palette.backgroundDark.hex, 0.18), borderRadius: 1 }} />
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 650, color, minWidth: 28 }}>{level}%</span>
    </span>
  );
}
