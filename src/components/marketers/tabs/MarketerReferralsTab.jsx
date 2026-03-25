import { useState, useMemo } from 'react';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import { FilterInput } from '../../../utils/columnModel.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const F2F_COLORS = {
  Green: palette.accentGreen.hex, Yellow: palette.highlightYellow.hex,
  Orange: palette.accentOrange.hex, Red: palette.primaryMagenta.hex,
  Expired: hexToRgba(palette.backgroundDark.hex, 0.3),
};

const COLUMN_DEFS = [
  { key: 'patient',   label: 'Patient',    filterable: false },
  { key: 'division',  label: 'Division',   filterable: true },
  { key: 'stage',     label: 'Stage',      filterable: true },
  { key: 'source',    label: 'Source',     filterable: true },
  { key: 'insurance', label: 'Insurance',  filterable: true },
  { key: 'f2f',       label: 'F2F',        filterable: false },
  { key: 'date',      label: 'Date',       filterable: false },
];

export default function MarketerReferralsTab({ referrals }) {
  const { open: openPatient } = usePatientDrawer();
  const { resolveSource } = useLookups();
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState({ division: '', stage: '', source: '', insurance: '' });
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  function setColFilter(key, val) { setColFilters((p) => ({ ...p, [key]: val })); }
  function clearAll() { setSearch(''); setColFilters({ division: '', stage: '', source: '', insurance: '' }); setStatusFilter('all'); }

  const hasActiveFilters = search.trim() || Object.values(colFilters).some((v) => v.trim());

  const displayed = useMemo(() => {
    let list = referrals;
    if (statusFilter === 'active') list = list.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed');
    else if (statusFilter === 'admitted') list = list.filter((r) => r.current_stage === 'SOC Completed');
    else if (statusFilter === 'ntuc') list = list.filter((r) => r.current_stage === 'NTUC');

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => (r.patientName || '').toLowerCase().includes(q) || (r.patient_id || '').toLowerCase().includes(q));
    }

    for (const [key, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const q = val.toLowerCase();
      list = list.filter((r) => {
        switch (key) {
          case 'division': return (r.division || '').toLowerCase().includes(q);
          case 'stage': return (r.current_stage || '').toLowerCase().includes(q);
          case 'source': return (resolveSource(r.referral_source_id) || '').toLowerCase().includes(q);
          case 'insurance': return (r.patient?.insurance_plan || r.insurance_plan || '').toLowerCase().includes(q);
          default: return true;
        }
      });
    }

    return [...list].sort((a, b) => {
      if (sortField === 'date') {
        const da = new Date(a.referral_date || 0).getTime();
        const db = new Date(b.referral_date || 0).getTime();
        return sortDir === 'desc' ? db - da : da - db;
      }
      if (sortField === 'name') {
        return sortDir === 'asc' ? (a.patientName || '').localeCompare(b.patientName || '') : (b.patientName || '').localeCompare(a.patientName || '');
      }
      if (sortField === 'stage') {
        return sortDir === 'asc' ? (a.current_stage || '').localeCompare(b.current_stage || '') : (b.current_stage || '').localeCompare(a.current_stage || '');
      }
      return 0;
    });
  }, [referrals, statusFilter, search, colFilters, sortField, sortDir, resolveSource]);

  const colOptions = useMemo(() => {
    const opts = {};
    COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      referrals.forEach((r) => {
        switch (col.key) {
          case 'division': if (r.division) vals.add(r.division); break;
          case 'stage': if (r.current_stage) vals.add(r.current_stage); break;
          case 'source': { const v = resolveSource(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'insurance': { const v = r.patient?.insurance_plan || r.insurance_plan; if (v) vals.add(v); break; }
        }
      });
      opts[col.key] = [...vals].sort();
    });
    return opts;
  }, [referrals, resolveSource]);

  function toggleSort(field) {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid var(--color-border)`, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['all', 'All'], ['active', 'Active'], ['admitted', 'Admitted'], ['ntuc', 'NTUC']].map(([id, label]) => (
          <button key={id} onClick={() => setStatusFilter(id)} style={{ padding: '4px 11px', borderRadius: 6, border: 'none', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: statusFilter === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.06), color: statusFilter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55), transition: 'all 0.12s' }}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 6, padding: '0 8px', height: 28, minWidth: 140 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11.5, color: palette.backgroundDark.hex, width: '100%' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 3, width: 14, height: 14, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>}
        </div>
        <button onClick={() => setShowFilters((v) => !v)} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none', fontSize: 11, fontWeight: 600, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Filters
          {hasActiveFilters && <span style={{ width: 5, height: 5, borderRadius: '50%', background: palette.accentBlue.hex }} />}
        </button>
        {hasActiveFilters && <button onClick={clearAll} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer' }}>Clear</button>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayed.length === 0 ? (
          <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>
            {hasActiveFilters ? 'No referrals match filters.' : 'No referrals found.'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {COLUMN_DEFS.map((col) => (
                  <th key={col.key} onClick={col.key === 'patient' ? () => toggleSort('name') : col.key === 'stage' ? () => toggleSort('stage') : col.key === 'date' ? () => toggleSort('date') : undefined} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), cursor: ['patient', 'stage', 'date'].includes(col.key) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                    {col.label}
                    {col.key === 'patient' && sortField === 'name' && <span style={{ fontSize: 8 }}> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                    {col.key === 'stage' && sortField === 'stage' && <span style={{ fontSize: 8 }}> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                    {col.key === 'date' && sortField === 'date' && <span style={{ fontSize: 8 }}> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
              {showFilters && (
                <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                  {COLUMN_DEFS.map((col) => (
                    <th key={col.key} style={{ padding: '3px 6px' }}>
                      {col.filterable ? <FilterInput value={colFilters[col.key] || ''} onChange={(v) => setColFilter(col.key, v)} placeholder={col.label} options={colOptions[col.key] || []} /> : null}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {displayed.map((ref) => {
                const f2fColor = F2F_COLORS[ref.f2f_urgency] || null;
                return (
                  <tr key={ref._id} onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</td>
                    <td style={{ padding: '9px 12px' }}><DivisionBadge division={ref.division} size="small" /></td>
                    <td style={{ padding: '9px 12px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSource(ref.referral_source_id) || '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{ref.patient?.insurance_plan || ref.insurance_plan || '—'}</td>
                    <td style={{ padding: '9px 12px' }}>
                      {f2fColor ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: f2fColor, fontWeight: 600 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: f2fColor }} />{ref.f2f_urgency}</span>
                        : <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{fmtDate(ref.referral_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '8px 16px', borderTop: `1px solid var(--color-border)`, flexShrink: 0, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
        {displayed.length} of {referrals.length} referrals
      </div>
    </div>
  );
}
