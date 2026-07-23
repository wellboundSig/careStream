import { useState, useCallback } from 'react';
import {
  TABLE_SCHEMAS,
  STAGES, DIVISIONS, F2F_URGENCY,
  fetchReportData, exportToExcel,
} from '../utils/reportEngine.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import AccessDenied from '../components/common/AccessDenied.jsx';
import GuidedReports from '../components/reports/GuidedReports.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

// ── SVG icons ──────────────────────────────────────────────────────────────────
const Icon = {
  Download: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Run: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  Remove: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Check: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Pipeline:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><rect x="2" y="3" width="4" height="18"/><rect x="10" y="7" width="4" height="14"/><rect x="18" y="11" width="4" height="10"/></svg>,
  Chart:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  Block:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  Clock:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Pause:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Shield:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Checkmark: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Pills:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><path d="M10.5 20H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3"/><path d="m17 17 5 5"/><path d="m22 17-5 5"/></svg>,
  Warning:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Link:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  Ticket:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>,
};

// ── Custom builder ─────────────────────────────────────────────────────────────
const OPERATORS_FOR = {
  text:    [{ v: 'contains', l: 'Contains' }, { v: 'eq', l: 'Equals' }, { v: 'not_empty', l: 'Is not empty' }, { v: 'is_empty', l: 'Is empty' }],
  enum:    [{ v: 'in', l: 'Is one of' }, { v: 'eq', l: 'Equals' }, { v: 'neq', l: 'Not equals' }],
  boolean: [{ v: 'true', l: 'Is Yes' }, { v: 'false', l: 'Is No' }],
  date:    [{ v: 'between', l: 'Between' }, { v: 'after', l: 'After' }, { v: 'before', l: 'Before' }, { v: 'not_empty', l: 'Is set' }, { v: 'is_empty', l: 'Is not set' }],
  number:  [{ v: 'eq', l: 'Equals' }, { v: 'gt', l: 'Greater than' }, { v: 'lt', l: 'Less than' }, { v: 'gte', l: '>=' }, { v: 'lte', l: '<=' }],
};

function FilterRow({ filter, filterDef, onUpdate, onRemove }) {
  const type = filterDef?.type || 'text';
  const ops  = OPERATORS_FOR[type] || OPERATORS_FOR.text;
  const setF = (k, v) => onUpdate({ ...filter, [k]: v });

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), width: 160, whiteSpace: 'nowrap' }}>
        {filterDef?.label || filter.field}
      </td>
      <td style={{ padding: '6px 8px', width: 150 }}>
        <Select value={filter.operator || ''} onChange={(e) => setF('operator', e.target.value)}>
          <option value="">Select operator</option>
          {ops.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </Select>
      </td>
      <td style={{ padding: '6px 8px' }}>
        {filter.operator === 'in' && filterDef?.options && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {filterDef.options.map((opt) => {
              const sel = Array.isArray(filter.value) && filter.value.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => {
                    const cur  = Array.isArray(filter.value) ? filter.value : [];
                    const next = sel ? cur.filter((x) => x !== opt) : [...cur, opt];
                    setF('value', next);
                  }}
                  style={{
                    padding: '2px 8px', borderRadius: 2, fontSize: 11.5, fontWeight: sel ? 650 : 500, cursor: 'pointer',
                    border: `1px solid ${sel ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                    background: sel ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'transparent',
                    color: sel ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}
        {['eq','neq','contains','gt','lt','gte','lte'].includes(filter.operator) && (
          <Field value={filter.value || ''} onChange={(e) => setF('value', e.target.value)} placeholder="value" style={{ width: 200 }} />
        )}
        {filter.operator === 'after'  && <Field type="date" value={filter.value || ''}  onChange={(e) => setF('value', e.target.value)}  style={{ width: 140 }} />}
        {filter.operator === 'before' && <Field type="date" value={filter.value || ''}  onChange={(e) => setF('value', e.target.value)}  style={{ width: 140 }} />}
        {filter.operator === 'between' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Field type="date" value={filter.value  || ''} onChange={(e) => setF('value',  e.target.value)} style={{ width: 130 }} />
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>to</span>
            <Field type="date" value={filter.value2 || ''} onChange={(e) => setF('value2', e.target.value)} style={{ width: 130 }} />
          </div>
        )}
      </td>
      <td style={{ padding: '6px 8px', width: 32, textAlign: 'center' }}>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: hexToRgba(palette.backgroundDark.hex, 0.35), display: 'flex', alignItems: 'center' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = palette.primaryMagenta.hex)}
          onMouseLeave={(e) => (e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.35))}>
          <Icon.Remove />
        </button>
      </td>
    </tr>
  );
}

function CustomBuilder() {
  const [tableKey,  setTableKey]  = useState('Referrals');
  const [columns,   setColumns]   = useState(['__patient_name','division','current_stage','priority','referral_date','__marketer_name','__facility_name']);
  const [filters,   setFilters]   = useState([]);
  const [sortField, setSortField] = useState('');
  const [sortDir,   setSortDir]   = useState('desc');
  const [loading,   setLoading]   = useState(false);
  const [preview,   setPreview]   = useState(null);
  const [status,    setStatus]    = useState(null);
  const [errMsg,    setErrMsg]    = useState('');

  const schema     = TABLE_SCHEMAS[tableKey];
  const allFields  = allFieldsFlat(schema);
  const fieldMap   = fieldsByKey(schema);
  const filterDefs = schema.airtableFilters;

  function handleTableChange(t) {
    const next = TABLE_SCHEMAS[t];
    const defaults = (next?.groups || [])
      .flatMap((g) => g.fields)
      .slice(0, 8)
      .map((f) => f.key);
    setTableKey(t);
    setColumns(defaults);
    setFilters([]);
    setSortField('');
    setPreview(null);
    setStatus(null);
  }

  const toggleCol  = (k) => setColumns((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);
  const addFilter  = (k) => { if (k) setFilters((p) => [...p, { id: Date.now(), field: k, operator: '', value: '' }]); };
  const updFilter  = (id, next) => setFilters((p) => p.map((f) => f.id === id ? { ...next, id } : f));
  const remFilter  = (id)       => setFilters((p) => p.filter((f) => f.id !== id));

  const handleRun = useCallback(async (doExport = false) => {
    if (!columns.length) { setErrMsg('Select at least one column.'); setStatus('error'); return; }
    setLoading(true); setStatus(null); setErrMsg('');
    const airtableFilters = filters.filter((f) => filterDefs.find((d) => d.key === f.field) && f.operator);
    const sort = sortField ? [{ field: sortField, direction: sortDir }] : [];
    try {
      const { rows, total } = await fetchReportData({ tableName: tableKey, filters: airtableFilters, selectedKeys: columns, sort });
      const orderedCols = columns.map((k) => { const f = fieldMap[k]; return f ? { key: k, label: f.label } : null; }).filter(Boolean);
      if (doExport) {
        const sub = airtableFilters.length
          ? `Filters: ${airtableFilters.map((f) => `${f.field} ${f.operator} ${f.value || ''}`).join(' | ')}`
          : `Generated: ${new Date().toLocaleString()}`;
        await exportToExcel(rows, orderedCols, `${schema.label} Report`, sub);
        setStatus('done');
      } else {
        setStatus('preview');
      }
      setPreview({ rows: rows.slice(0, 20), columns: orderedCols, total });
    } catch (e) {
      setErrMsg(e.message || 'Failed'); setStatus('error');
    } finally { setLoading(false); }
  }, [columns, filters, sortField, sortDir, tableKey, schema, fieldMap, filterDefs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>

      {/* 1 - Data source */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <SectionHeader label="1. Data Source" />
        <div style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.entries(TABLE_SCHEMAS).map(([key, s]) => {
              const active = tableKey === key;
              return (
                <button key={key} onClick={() => handleTableChange(key)} style={{
                  padding: '6px 14px', borderRadius: 3, fontSize: 12.5, fontWeight: active ? 650 : 500, cursor: 'pointer',
                  border: `1px solid ${active ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                  background: active ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'transparent',
                  color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                }}>
                  {s.label}
                </button>
              );
            })}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.45 }}>
            {schema.description} · {allFields.length} columns available. Stack multiple filters for granular cuts.
          </p>
        </div>
      </div>

      {/* 2 - Columns */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <SectionHeader
          label={`2. Output Columns (${columns.length} of ${allFields.length} selected)`}
          right={
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setColumns(allFields.map((f) => f.key))} style={{ fontSize: 11, padding: '3px 8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 2, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Select all</button>
              <button onClick={() => setColumns([])} style={{ fontSize: 11, padding: '3px 8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 2, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Clear</button>
            </div>
          }
        />
        <div style={{ padding: '12px 14px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {schema.groups.map((group) => (
            <div key={group.label} style={{ minWidth: 180 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '0 0 8px' }}>
                {group.label}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.fields.map((f) => {
                  const checked = columns.includes(f.key);
                  return (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 0' }}>
                      <span style={{
                        width: 14, height: 14, borderRadius: 2, flexShrink: 0,
                        border: `1px solid ${checked ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                        background: checked ? palette.primaryMagenta.hex : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }} onClick={() => toggleCol(f.key)}>
                        {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </span>
                      <span
                        onClick={() => toggleCol(f.key)}
                        style={{ fontSize: 12, color: checked ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.5), userSelect: 'none' }}
                      >
                        {f.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3 - Filters */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <SectionHeader
          label={`3. Filter Conditions (${filters.length})`}
          right={
            <Select
              defaultValue=""
              onChange={(e) => { addFilter(e.target.value); e.target.value = ''; }}
              style={{ fontSize: 11.5, padding: '3px 8px', width: 'auto' }}
            >
              <option value="">Add condition...</option>
              {filterDefs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          }
        />
        {filters.length === 0 ? (
          <p style={{ padding: '12px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: 0 }}>
            No conditions applied. All records in this table will be returned.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.02) }}>
                {['Field','Operator','Value',''].map((h) => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filters.map((f) => {
                const def = filterDefs.find((d) => d.key === f.field);
                return <FilterRow key={f.id} filter={f} filterDef={def} onUpdate={(next) => updFilter(f.id, next)} onRemove={() => remFilter(f.id)} />;
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 4 - Sort + Run */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <SectionHeader label="4. Sort & Execute" />
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Sort by</span>
            <Select value={sortField} onChange={(e) => setSortField(e.target.value)} style={{ width: 180 }}>
              <option value="">No sort</option>
              {filterDefs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
            <Select value={sortDir} onChange={(e) => setSortDir(e.target.value)} style={{ width: 140 }}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </Select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => handleRun(false)}
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 3, border: '1px solid var(--color-border)',
                background: 'transparent', color: hexToRgba(palette.backgroundDark.hex, 0.65),
                fontSize: 12.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Icon.Run /> Preview
            </button>
            <button
              onClick={() => handleRun(true)}
              disabled={loading || !columns.length}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 3, border: 'none',
                background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
                fontSize: 12.5, fontWeight: 650, cursor: (loading || !columns.length) ? 'not-allowed' : 'pointer',
                opacity: (loading || !columns.length) ? 0.6 : 1,
              }}
            >
              <Icon.Download /> Export to Excel
            </button>
          </div>

          {status === 'error'   && <span style={{ fontSize: 12, color: palette.primaryMagenta.hex }}>{errMsg}</span>}
          {status === 'done'    && <span style={{ fontSize: 12, color: palette.accentGreen.hex, fontWeight: 600 }}>Exported {preview?.total?.toLocaleString()} records</span>}
          {status === 'preview' && <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{preview?.total?.toLocaleString()} records matched</span>}
        </div>
      </div>

      {/* Preview table */}
      {preview && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
          <SectionHeader
            label={`Preview: ${preview.rows.length} of ${preview.total?.toLocaleString()} records`}
            right={
              <button onClick={() => handleRun(true)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 2, border: 'none',
                background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
                fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
              }}>
                <Icon.Download /> Export all {preview.total?.toLocaleString()}
              </button>
            }
          />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)', background: hexToRgba(palette.backgroundDark.hex, 0.03) }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.025))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {preview.columns.map((c) => {
                      const v = row[c.key];
                      const display = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : String(v);
                      return (
                        <td key={c.key} style={{ padding: '8px 12px', color: palette.backgroundDark.hex, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {display || <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.2) }}>-</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [tab, setTab] = useState('guided');

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.REPORT_VIEW)) return <AccessDenied message="You do not have permission to view reports." />;

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1300, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 3px', letterSpacing: '-0.01em' }}>
          Reports
        </h1>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0 }}>
          Purpose-driven guided reports, or build a custom export.
        </p>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 20, gap: 0 }}>
        {[['guided', 'Guided Reports'], ['custom', 'Custom Report Builder']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '9px 18px', background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === id ? palette.primaryMagenta.hex : 'transparent'}`,
              fontSize: 13, fontWeight: tab === id ? 700 : 500, cursor: 'pointer',
              color: tab === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
              marginBottom: -1, transition: 'color 0.1s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'guided' && <GuidedReports />}
      {tab === 'custom' && <CustomBuilder />}
    </div>
  );
}
