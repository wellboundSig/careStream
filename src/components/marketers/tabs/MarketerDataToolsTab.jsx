import { useState, useMemo } from 'react';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import { FilterInput } from '../../../utils/columnModel.jsx';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysInStage(updatedAt) {
  if (!updatedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
}

const DATA_COLUMNS = [
  { key: 'patient',    label: 'Patient',       filterable: false },
  { key: 'division',   label: 'Division',      filterable: true },
  { key: 'stage',      label: 'Stage',         filterable: true },
  { key: 'days',       label: 'Days',          filterable: false },
  { key: 'source',     label: 'Source',        filterable: true },
  { key: 'insurance',  label: 'Insurance',     filterable: true },
  { key: 'facility',   label: 'Facility',      filterable: true },
  { key: 'priority',   label: 'Priority',      filterable: true },
  { key: 'services',   label: 'Services',      filterable: false },
  { key: 'date',       label: 'Referral Date', filterable: false },
];

export default function MarketerDataToolsTab({ referrals }) {
  const { open: openPatient } = usePatientDrawer();
  const { resolveSource, resolveFacility } = useLookups();

  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState({ division: '', stage: '', source: '', insurance: '', facility: '', priority: '' });

  function setColFilter(key, val) { setColFilters((p) => ({ ...p, [key]: val })); }
  const hasActiveFilters = search.trim() || Object.values(colFilters).some((v) => v.trim());
  function clearAll() { setSearch(''); setColFilters({ division: '', stage: '', source: '', insurance: '', facility: '', priority: '' }); }

  const filtered = useMemo(() => {
    let list = referrals;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => (r.patientName || '').toLowerCase().includes(q) || (r.patient_id || '').toLowerCase().includes(q) || (r.current_stage || '').toLowerCase().includes(q));
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
          case 'facility': return (resolveFacility(r.facility_id) || '').toLowerCase().includes(q);
          case 'priority': return (r.priority || '').toLowerCase().includes(q);
          default: return true;
        }
      });
    }
    return [...list].sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0));
  }, [referrals, search, colFilters, resolveSource, resolveFacility]);

  const colOptions = useMemo(() => {
    const opts = {};
    DATA_COLUMNS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      referrals.forEach((r) => {
        switch (col.key) {
          case 'division': if (r.division) vals.add(r.division); break;
          case 'stage': if (r.current_stage) vals.add(r.current_stage); break;
          case 'source': { const v = resolveSource(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'insurance': { const v = r.patient?.insurance_plan || r.insurance_plan; if (v) vals.add(v); break; }
          case 'facility': { const v = resolveFacility(r.facility_id); if (v && v !== '—') vals.add(v); break; }
          case 'priority': if (r.priority) vals.add(r.priority); break;
        }
      });
      opts[col.key] = [...vals].sort();
    });
    return opts;
  }, [referrals, resolveSource, resolveFacility]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid var(--color-border)`, display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 6, padding: '0 8px', height: 28, flex: 1, maxWidth: 200 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all data…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11.5, color: palette.backgroundDark.hex, width: '100%' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', borderRadius: 3, width: 14, height: 14, cursor: 'pointer', color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>×</button>}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowFilters((v) => !v)} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none', fontSize: 11, fontWeight: 600, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Filters
          {hasActiveFilters && <span style={{ width: 5, height: 5, borderRadius: '50%', background: palette.accentBlue.hex }} />}
        </button>
        {hasActiveFilters && <button onClick={clearAll} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer' }}>Clear</button>}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>
            {hasActiveFilters ? 'No data matches filters.' : 'No referral data.'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {DATA_COLUMNS.map((col) => (
                  <th key={col.key} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), whiteSpace: 'nowrap' }}>{col.label}</th>
                ))}
              </tr>
              {showFilters && (
                <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                  {DATA_COLUMNS.map((col) => (
                    <th key={col.key} style={{ padding: '3px 5px' }}>
                      {col.filterable ? <FilterInput value={colFilters[col.key] || ''} onChange={(v) => setColFilter(col.key, v)} placeholder={col.label} options={colOptions[col.key] || []} /> : null}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map((ref) => {
                const days = daysInStage(ref.updated_at);
                const services = Array.isArray(ref.services_requested) ? ref.services_requested.join(', ') : (ref.services_requested || '—');
                return (
                  <tr key={ref._id} onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.04)}`, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '8px 10px', fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</td>
                    <td style={{ padding: '8px 10px' }}><DivisionBadge division={ref.division} size="small" /></td>
                    <td style={{ padding: '8px 10px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 12, fontWeight: days > 14 ? 650 : 400, color: days > 14 ? palette.primaryMagenta.hex : days > 7 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}>{days === 0 ? 'Today' : `${days}d`}</span>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSource(ref.referral_source_id) || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{ref.patient?.insurance_plan || ref.insurance_plan || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveFacility(ref.facility_id) || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{ref.priority || 'Normal'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{services}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{fmtDate(ref.referral_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '8px 16px', borderTop: `1px solid var(--color-border)`, flexShrink: 0, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
        {filtered.length} of {referrals.length} records · Double-click to open patient
      </div>
    </div>
  );
}
