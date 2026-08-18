import { useState, useMemo } from 'react';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCareStore } from '../../../store/careStore.js';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import { FilterInput } from '../../../utils/columnModel.jsx';
import { useLockedTableGrid } from '../../../hooks/useLockedTableGrid.js';
import { useFlipWindow } from '../../../hooks/useFlipWindow.js';
import { lockedGridClass, lockColClass } from '../../../utils/tableScrollMode.js';
import FlipTableShell from '../../common/FlipTableShell.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { fmtCalendarDate } from '../../../utils/dateFormat.js';
import { isSocCompletedReferral } from '../../../data/stageConfig.js';
import {
  TRIAGE_FILTER_OPTIONS,
  buildTriagePresenceMap,
  matchesTriageFilter,
  triageColumnLabel,
} from '../../../utils/triageColumn.js';

const COLUMN_DEFS = [
  { key: 'patient', label: 'Patient', filterable: false },
  { key: 'division', label: 'Division', filterable: true },
  { key: 'licence', label: 'Entity', filterable: true },
  { key: 'source_entity', label: 'Referral Entity', filterable: true },
  { key: 'stage', label: 'Stage', filterable: true },
  { key: 'triage', label: 'Triage', filterable: true },
  { key: 'date', label: 'Referral Date', filterable: false },
];

export default function FacilityPatientsTab({ referrals, loading }) {
  const { open: openPatient } = usePatientDrawer();
  const { resolveEntity, resolveSourceEntity } = useLookups();
  const lockedGrid = useLockedTableGrid();
  const triageAdult = useCareStore((s) => s.triageAdult);
  const triagePediatric = useCareStore((s) => s.triagePediatric);
  const triagePresence = useMemo(
    () => buildTriagePresenceMap(triageAdult, triagePediatric),
    [triageAdult, triagePediatric]
  );
  const [filter, setFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState({ division: '', licence: '', source_entity: '', stage: '', triage: '' });

  function setColFilter(key, val) { setColFilters((p) => ({ ...p, [key]: val })); }
  function clearAll() { setColFilters({ division: '', licence: '', source_entity: '', stage: '', triage: '' }); setFilter('all'); }
  const hasActiveFilters = Object.values(colFilters).some((v) => v.trim());

  const displayed = useMemo(() => {
    let list = referrals;
    if (filter === 'active') list = list.filter((r) => r.current_stage !== 'NTUC' && r.current_stage !== 'SOC Completed');
    else if (filter === 'admitted') list = list.filter((r) => isSocCompletedReferral(r));

    for (const [key, val] of Object.entries(colFilters)) {
      if (!val.trim()) continue;
      const q = val.toLowerCase();
      list = list.filter((r) => {
        switch (key) {
          case 'division': return (r.division || '').toLowerCase().includes(q);
          case 'licence': return (resolveEntity(r.entity_id) || '').toLowerCase().includes(q);
          case 'source_entity': return (resolveSourceEntity(r.referral_source_id) || '').toLowerCase().includes(q);
          case 'stage': return (r.current_stage || '').toLowerCase().includes(q);
          case 'triage': return matchesTriageFilter(triageColumnLabel(r, !!(r?.id && triagePresence[r.id])), val);
          default: return true;
        }
      });
    }
    return list;
  }, [referrals, filter, colFilters, resolveEntity, resolveSourceEntity, triagePresence]);

  const tabHeaderH = showFilters ? 64 : 34;
  const flip = useFlipWindow(displayed, lockedGrid, { rowHeight: 42, headerHeight: tabHeaderH });

  const colOptions = useMemo(() => {
    const opts = {};
    COLUMN_DEFS.filter((c) => c.filterable).forEach((col) => {
      const vals = new Set();
      referrals.forEach((r) => {
        switch (col.key) {
          case 'division': if (r.division) vals.add(r.division); break;
          case 'licence': { const v = resolveEntity(r.entity_id); if (v && v !== '—') vals.add(v); break; }
          case 'source_entity': { const v = resolveSourceEntity(r.referral_source_id); if (v && v !== '—') vals.add(v); break; }
          case 'stage': if (r.current_stage) vals.add(r.current_stage); break;
          case 'triage': TRIAGE_FILTER_OPTIONS.forEach((opt) => vals.add(opt)); break;
        }
      });
      opts[col.key] = [...vals].sort();
    });
    return opts;
  }, [referrals, resolveEntity, resolveSourceEntity]);

  if (loading) return <LoadingState message="Loading patients…" size="small" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 22px 10px', borderBottom: `1px solid var(--color-border)`, display: 'flex', gap: 6, alignItems: 'center' }}>
        {[['all', `All (${referrals.length})`], ['active', 'Active'], ['admitted', 'Admitted']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: filter === id ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07), color: filter === id ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6), transition: 'all 0.12s' }}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowFilters((v) => !v)} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${showFilters ? palette.accentBlue.hex : 'var(--color-border)'}`, background: showFilters ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none', fontSize: 11, fontWeight: 600, color: showFilters ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>
          Filters{hasActiveFilters ? ' ·' : ''}
        </button>
        {hasActiveFilters && <button onClick={clearAll} style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', fontSize: 11, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer' }}>Clear</button>}
      </div>

      <FlipTableShell flip={flip} headerHeight={tabHeaderH} className={lockedGridClass(lockedGrid)} style={{ flex: 1, minHeight: 0 }}>
        {displayed.length === 0 ? (
          <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>No referrals in this view.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: `1px solid var(--color-border)` }}>
                {COLUMN_DEFS.map((col) => (
                  <th key={col.key} className={col.key === 'patient' ? lockColClass(lockedGrid) : undefined} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{col.label}</th>
                ))}
              </tr>
              {showFilters && (
                <tr style={{ background: hexToRgba(palette.accentBlue.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                  {COLUMN_DEFS.map((col) => (
                    <th key={col.key} className={col.key === 'patient' ? lockColClass(lockedGrid) : undefined} style={{ padding: '3px 8px' }}>
                      {col.filterable ? <FilterInput value={colFilters[col.key] || ''} onChange={(v) => setColFilter(col.key, v)} placeholder={col.label} options={colOptions[col.key] || []} /> : null}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {flip.windowItems.map((ref) => (
                <tr key={ref._id}
                  onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                  style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.03))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td className={lockColClass(lockedGrid)} style={{ padding: '9px 14px', fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>{ref.patientName || ref.patient_id}</td>
                  <td style={{ padding: '9px 14px' }}><DivisionBadge division={ref.division} size="small" /></td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveEntity(ref.entity_id) || '—'}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSourceEntity(ref.referral_source_id) || '—'}</td>
                  <td style={{ padding: '9px 14px' }}><StageBadge stage={ref.current_stage} size="small" /></td>
                  <td style={{ padding: '9px 14px', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{triageColumnLabel(ref, !!(ref.id && triagePresence[ref.id]))}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{fmtCalendarDate(ref.referral_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </FlipTableShell>
    </div>
  );
}
