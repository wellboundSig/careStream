import { useMemo, useState } from 'react';
import { useLookups } from '../../hooks/useLookups.js';
import { exportToExcel } from '../../utils/reportEngine.js';
import palette from '../../utils/colors.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import {
  AGING_BUCKETS,
  DATE_BASIS,
  JOURNEY_EXPORT_COLUMNS,
  JOURNEY_HOPS,
  JOURNEY_MILESTONES,
  annotateJourneyOutliers,
  applyJourneyFilters,
  buildJourneyRows,
  buildWeeklyJourneySeries,
  filterReferralsByDateBasis,
  summarizeJourney,
  uniqueSorted,
} from '../../utils/referralToSocJourney.js';

const STAGES = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'EMR Onboarding', 'Staffing Feasibility', 'Admin Confirmation',
  'Pre-SOC', 'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC',
];
const SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];

const MAGENTA = '#D91E75';
const ORANGE = '#DB8640';
const GREEN = '#6EC72B';
const PLUM = '#450931';
const CYAN = '#0891B2';

const HOP_COLOR = {
  referral_to_hchb: MAGENTA,
  hchb_to_emr: ORANGE,
  emr_to_scheduled: CYAN,
  scheduled_to_soc: GREEN,
};

const RING_COLOR = {
  referral: PLUM,
  initial_emr: MAGENTA,
  full_emr: ORANGE,
  soc_scheduled: CYAN,
  soc_completed: GREEN,
};

const EMPTY_FILTERS = {
  cohort: 'all',
  stuckHop: '',
  reachedMilestone: '',
  droppedBefore: '',
  outliersOnly: false,
  missedHchbTarget: false,
  hchbNotEntered: false,
  patient: '',
  facility: '',
  marketer: '',
  source: '',
  intakeOwner: '',
  clinicalRn: '',
  stage: '',
  service: '',
  aging: '',
  priority: '',
  minDays: '',
  maxDays: '',
  hchbMinDays: '',
  hchbMaxDays: '',
};

function theme() {
  const dark = palette.backgroundLight.hex === '#14141E';
  return {
    dark,
    ink: palette.backgroundDark.hex,
    page: palette.backgroundLight.hex,
    card: dark ? '#1C1C28' : '#FFFFFF',
    track: dark ? '#2C2C3A' : '#E6E6EC',
    muted: dark ? '#A0A0B0' : '#6A6A76',
    faint: dark ? '#7A7A88' : '#8E8E9A',
    line: dark ? '#2C2C3A' : '#ECECF1',
    alt: dark ? '#181824' : '#F4F4F8',
    input: dark ? '#14141E' : '#FFFFFF',
  };
}

function Ring({ size = 128, pct, color, center, sub, onClick, active }) {
  const t = theme();
  const sweep = Math.max(0, Math.min(100, pct || 0)) / 100;
  const r = (size / 2) - 11;
  const c = 2 * Math.PI * r;
  const dash = c * sweep;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        textAlign: 'center',
        outline: active ? `2px solid ${color}` : 'none',
        outlineOffset: 6,
        borderRadius: 999,
      }}
    >
      <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.track} strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x={size / 2}
          y={size / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size > 120 ? 28 : 20}
          fontWeight="750"
          fill={t.ink}
          fontFamily="inherit"
        >
          {center}
        </text>
      </svg>
      {sub && (
        <div style={{ marginTop: 10, fontSize: 13, color: t.muted, lineHeight: 1.35, maxWidth: size + 28, marginLeft: 'auto', marginRight: 'auto', whiteSpace: 'pre-line' }}>
          {sub}
        </div>
      )}
    </button>
  );
}

function Panel({ children, style }) {
  const t = theme();
  return (
    <div style={{
      background: t.card,
      borderRadius: 20,
      padding: '36px 40px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  const t = theme();
  return (
    <p style={{
      margin: '0 0 18px',
      fontSize: 12,
      fontWeight: 650,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: t.faint,
    }}>
      {children}
    </p>
  );
}

function Pill({ active, onClick, children, solid }) {
  const t = theme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 14px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        background: active ? (solid || t.ink) : t.track,
        color: active ? '#FFFFFF' : t.ink,
      }}
    >
      {children}
    </button>
  );
}

function Chip({ label, onClear }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 12px',
      borderRadius: 999,
      background: '#F3D4E4',
      color: PLUM,
      fontSize: 12.5,
      fontWeight: 650,
    }}>
      {label}
      <button type="button" onClick={onClear} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, lineHeight: 1 }}>
        ×
      </button>
    </span>
  );
}

function fmtDays(n) {
  if (n == null || n === '') return '-';
  return `${n}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${Math.round(n)}%`;
}

function daysColor(n, { warn = 3, alert = 8 } = {}) {
  if (n == null) return theme().faint;
  if (n <= 1) return GREEN;
  if (n <= warn) return CYAN;
  if (n <= alert) return ORANGE;
  return MAGENTA;
}

function selectStyle() {
  const t = theme();
  return {
    padding: '9px 12px',
    borderRadius: 10,
    border: `1px solid ${t.line}`,
    fontSize: 13,
    fontFamily: 'inherit',
    background: t.input,
    color: t.ink,
    cursor: 'pointer',
    outline: 'none',
    minWidth: 132,
  };
}

function inputStyle() {
  const t = theme();
  return {
    padding: '9px 12px',
    borderRadius: 10,
    border: `1px solid ${t.line}`,
    fontSize: 13,
    fontFamily: 'inherit',
    background: t.input,
    color: t.ink,
    outline: 'none',
    minWidth: 128,
  };
}

function Histogram({ buckets, color, onBarClick, activeMin, activeMax }) {
  const t = theme();
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 148 }}>
      {buckets.map((b) => {
        const h = Math.max(b.count ? 10 : 4, (b.count / max) * 112);
        const active = activeMin != null && String(b.min) === String(activeMin)
          && ((Number.isFinite(b.max) && String(b.max) === String(activeMax))
            || (!Number.isFinite(b.max) && (activeMax === '' || activeMax == null)));
        return (
          <button
            key={b.key}
            type="button"
            title={`${b.label}: ${b.count}`}
            onClick={() => onBarClick?.(b)}
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: t.ink }}>{b.count}</span>
            <div style={{
              width: '100%',
              height: h,
              borderRadius: 8,
              background: active ? t.ink : color,
            }} />
            <span style={{ fontSize: 11, color: t.faint }}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function WeeklyChart({ series }) {
  const t = theme();
  if (!series.length) return null;
  const max = Math.max(...series.flatMap((w) => [w.referrals, w.hchb, w.soc]), 1);
  const W = Math.max(series.length * 40, 280);
  const H = 120;
  const step = W / series.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 22}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {series.map((w, i) => {
        const x = i * step + 8;
        const bars = [
          { v: w.referrals, c: CYAN },
          { v: w.hchb, c: MAGENTA },
          { v: w.soc, c: GREEN },
        ];
        return (
          <g key={w.label}>
            {bars.map((b, bi) => {
              const h = (b.v / max) * (H - 10);
              return (
                <rect
                  key={bi}
                  x={x + bi * 9}
                  y={H - h}
                  width={7}
                  height={h || 1}
                  rx={2}
                  fill={b.v ? b.c : t.track}
                />
              );
            })}
            <text x={x + 14} y={H + 16} textAnchor="middle" fontSize={9} fill={t.faint}>{w.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function chipLabels(filters) {
  const chips = [];
  if (filters.cohort !== 'all') chips.push({ key: 'cohort', label: `Cohort: ${filters.cohort}` });
  if (filters.stuckHop) {
    const hop = JOURNEY_HOPS.find((h) => h.key === filters.stuckHop);
    chips.push({ key: 'stuckHop', label: hop?.label || filters.stuckHop });
  }
  if (filters.reachedMilestone) {
    const m = JOURNEY_MILESTONES.find((x) => x.key === filters.reachedMilestone);
    chips.push({ key: 'reachedMilestone', label: `Reached ${m?.short || filters.reachedMilestone}` });
  }
  if (filters.droppedBefore) {
    const m = JOURNEY_MILESTONES.find((x) => x.key === filters.droppedBefore);
    chips.push({ key: 'droppedBefore', label: `Dropped before ${m?.short || filters.droppedBefore}` });
  }
  if (filters.outliersOnly) chips.push({ key: 'outliersOnly', label: 'Outliers' });
  if (filters.missedHchbTarget) chips.push({ key: 'missedHchbTarget', label: 'Missed 1-day HCHB' });
  if (filters.hchbNotEntered) chips.push({ key: 'hchbNotEntered', label: 'HCHB not entered' });
  if (filters.patient) chips.push({ key: 'patient', label: filters.patient });
  if (filters.facility) chips.push({ key: 'facility', label: filters.facility });
  if (filters.marketer) chips.push({ key: 'marketer', label: filters.marketer });
  if (filters.source) chips.push({ key: 'source', label: filters.source });
  if (filters.intakeOwner) chips.push({ key: 'intakeOwner', label: filters.intakeOwner });
  if (filters.clinicalRn) chips.push({ key: 'clinicalRn', label: filters.clinicalRn });
  if (filters.stage) chips.push({ key: 'stage', label: filters.stage });
  if (filters.service) chips.push({ key: 'service', label: filters.service });
  if (filters.aging) chips.push({ key: 'aging', label: filters.aging });
  if (filters.priority) chips.push({ key: 'priority', label: filters.priority });
  if (filters.minDays !== '') chips.push({ key: 'minDays', label: `Min ${filters.minDays}d` });
  if (filters.maxDays !== '') chips.push({ key: 'maxDays', label: `Max ${filters.maxDays}d` });
  if (filters.hchbMinDays !== '') chips.push({ key: 'hchbMinDays', label: `HCHB ${filters.hchbMinDays}d+` });
  if (filters.hchbMaxDays !== '') chips.push({ key: 'hchbMaxDays', label: `HCHB ≤${filters.hchbMaxDays}d` });
  return chips;
}

function exportValue(row, key) {
  const v = row[key];
  if (v == null || v === '') return '-';
  if (['referral_date', 'hchb_at', 'emr_at', 'scheduled_at', 'soc_at', 'eligibility_at', 'f2f_at', 'clinical_at', 'staffing_at'].includes(key)) {
    return v === '-' ? '-' : (fmtCalendarDate(v, '-') || '-');
  }
  return v;
}

export default function ReferralToSocView({ allReferrals = [], period = 30, division = 'All' }) {
  const t = theme();
  const { resolveUser, resolveMarketer, resolveSource, resolveFacility, resolvePatient } = useLookups();
  const [basis, setBasis] = useState('referral');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState('current_wait');
  const [sortDir, setSortDir] = useState('desc');
  const [exporting, setExporting] = useState(false);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const toggleFilter = (key, value = true) => {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? (typeof value === 'boolean' ? false : '') : value }));
  };
  const clearChip = (key) => {
    setFilters((prev) => ({ ...prev, [key]: typeof EMPTY_FILTERS[key] === 'boolean' ? false : EMPTY_FILTERS[key] }));
  };

  const divisionAll = useMemo(() => {
    if (division === 'All') return allReferrals;
    return (allReferrals || []).filter((r) => r.division === division);
  }, [allReferrals, division]);

  const scoped = useMemo(
    () => filterReferralsByDateBasis(divisionAll, { days: period, basis }),
    [divisionAll, period, basis],
  );

  const resolve = useMemo(() => ({
    user: resolveUser,
    marketer: resolveMarketer,
    source: resolveSource,
    facility: resolveFacility,
    patient: resolvePatient,
  }), [resolveUser, resolveMarketer, resolveSource, resolveFacility, resolvePatient]);

  const annotated = useMemo(() => {
    const rows = buildJourneyRows(scoped, { resolve });
    return annotateJourneyOutliers(rows);
  }, [scoped, resolve]);

  const filtered = useMemo(
    () => applyJourneyFilters(annotated, filters),
    [annotated, filters],
  );

  const summary = useMemo(() => summarizeJourney(filtered), [filtered]);
  const weekly = useMemo(() => buildWeeklyJourneySeries(filtered, 12), [filtered]);
  const chips = chipLabels(filters);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      let va = a[sortKey];
      let vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb, undefined, { sensitivity: 'base' }) * dir;
      return (va - vb) * dir;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const longestWaits = useMemo(
    () => [...filtered]
      .filter((r) => r.current_wait != null)
      .sort((a, b) => (b.current_wait ?? 0) - (a.current_wait ?? 0))
      .slice(0, 8),
    [filtered],
  );

  const hopScale = Math.max(...summary.hops.map((h) => h.p90 || h.median || 0), 1);
  const reachedHchbPct = summary.total ? (summary.funnel.find((f) => f.key === 'initial_emr')?.count || 0) / summary.total * 100 : 0;
  const onTimeColor = summary.hchbOnTimePct >= 80 ? GREEN : summary.hchbOnTimePct >= 50 ? ORANGE : MAGENTA;
  const bottleneck = summary.bottleneck;
  const maxStuck = Math.max(...summary.hops.map((h) => h.stuck), 1);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'patient_name' ? 'asc' : 'desc'); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const rows = sorted.map((r) => {
        const out = {};
        for (const col of JOURNEY_EXPORT_COLUMNS) out[col.key] = exportValue(r, col.key);
        return out;
      });
      await exportToExcel(
        rows,
        JOURNEY_EXPORT_COLUMNS,
        'Referral to SOC',
        `${rows.length} cases · ${DATE_BASIS.find((b) => b.key === basis)?.label || 'Referral date'} · ${new Date().toLocaleDateString()}`,
      );
    } finally {
      setExporting(false);
    }
  }

  const th = (key, label) => (
    <th
      onClick={() => toggleSort(key)}
      style={{
        padding: '14px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 650,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: t.faint,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        background: t.card,
      }}
    >
      {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {DATE_BASIS.map((b) => (
            <Pill key={b.key} active={basis === b.key} onClick={() => setBasis(b.key)}>{b.label}</Pill>
          ))}
          <span style={{ width: 12 }} />
          {[
            { key: 'all', label: 'All' },
            { key: 'open', label: 'Open' },
            { key: 'soc', label: 'SOC done' },
            { key: 'ntuc', label: 'NTUC' },
            { key: 'hold', label: 'Hold' },
          ].map((c) => (
            <Pill key={c.key} active={filters.cohort === c.key} solid={MAGENTA} onClick={() => setFilter('cohort', c.key)}>
              {c.label}
            </Pill>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ fontSize: 13, color: t.muted }}>{filtered.length} of {annotated.length}</span>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !sorted.length}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: 'none',
              cursor: sorted.length ? 'pointer' : 'default',
              background: t.track,
              color: t.ink,
              fontSize: 13,
              fontWeight: 650,
              fontFamily: 'inherit',
            }}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      <Panel style={{ marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) auto', gap: 56, alignItems: 'center' }}>
          <div>
            <Label>Hold-up</Label>
            <h2 style={{ margin: '0 0 14px', fontSize: 34, fontWeight: 750, letterSpacing: '-0.03em', lineHeight: 1.15, color: t.ink }}>
              {bottleneck ? bottleneck.label : 'Not enough stamps yet'}
            </h2>
            {bottleneck && (
              <p style={{ margin: '0 0 22px', fontSize: 17, color: t.muted, lineHeight: 1.45 }}>
                {bottleneck.stuck
                  ? `${bottleneck.stuck} waiting${bottleneck.stuckMedian != null ? `, median ${bottleneck.stuckMedian} days` : ''}`
                  : `Median ${bottleneck.median ?? '-'} days on completed cases`}
              </p>
            )}
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => toggleFilter('hchbNotEntered', true)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 28, fontWeight: 750, color: MAGENTA, lineHeight: 1 }}>{summary.hchbMissing}</div>
                <div style={{ fontSize: 13, color: t.muted, marginTop: 6 }}>never entered HCHB</div>
              </button>
              <button type="button" onClick={() => toggleFilter('missedHchbTarget', true)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 28, fontWeight: 750, color: ORANGE, lineHeight: 1 }}>{summary.missedHchb}</div>
                <div style={{ fontSize: 13, color: t.muted, marginTop: 6 }}>missed the 1-day target</div>
              </button>
              <button type="button" onClick={() => setFilter('minDays', filters.minDays === '14' ? '' : '14')} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 28, fontWeight: 750, color: t.ink, lineHeight: 1 }}>{summary.stuckOver14}</div>
                <div style={{ fontSize: 13, color: t.muted, marginTop: 6 }}>waiting 14+ days</div>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 36, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Ring
              pct={summary.hchbOnTimePct}
              color={onTimeColor}
              center={fmtPct(summary.hchbOnTimePct)}
              sub={`HCHB in 1 day\n${summary.hchbOnTime} of ${summary.hchbEntered} entered`}
              onClick={() => toggleFilter('missedHchbTarget', true)}
            />
            <Ring
              pct={reachedHchbPct}
              color={MAGENTA}
              center={fmtPct(reachedHchbPct)}
              sub={`Reached HCHB\n${summary.hchbEntered} of ${summary.total}`}
              onClick={() => toggleFilter('reachedMilestone', 'initial_emr')}
            />
            <Ring
              pct={summary.conversion}
              color={GREEN}
              center={fmtPct(summary.conversion)}
              sub={`SOC completed\n${summary.socCount} of ${summary.total}`}
              onClick={() => setFilter('cohort', filters.cohort === 'soc' ? 'all' : 'soc')}
            />
          </div>
        </div>
      </Panel>

      <Panel style={{ marginBottom: 28 }}>
        <Label>The path</Label>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, overflowX: 'auto', padding: '8px 0 4px' }}>
          {summary.funnel.map((step, i) => (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 110 }}>
                <Ring
                  size={118}
                  pct={step.pctOfTotal}
                  color={RING_COLOR[step.key]}
                  center={step.count}
                  onClick={() => toggleFilter('reachedMilestone', step.key)}
                  active={filters.reachedMilestone === step.key}
                />
                <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: t.ink }}>{step.short}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: t.faint }}>{step.pctOfTotal}% of view</div>
              </div>
              {i < summary.funnel.length - 1 && (
                <button
                  type="button"
                  onClick={() => toggleFilter('droppedBefore', summary.funnel[i + 1].key)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: '0 6px',
                    minWidth: 48,
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ height: 2, background: t.track, position: 'relative', marginBottom: 18 }}>
                    <div style={{
                      position: 'absolute',
                      right: -4,
                      top: -3,
                      width: 8,
                      height: 8,
                      borderRadius: 8,
                      background: summary.funnel[i + 1].pctOfPrev < 80 ? ORANGE : t.track,
                    }} />
                  </div>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: summary.funnel[i + 1].pctOfPrev < 80 ? ORANGE : t.muted,
                  }}>
                    {summary.funnel[i + 1].pctOfPrev}%
                  </div>
                  <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>
                    {summary.funnel[i + 1].dropFromPrev} drop
                  </div>
                </button>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 20,
        marginBottom: 28,
        padding: '8px 8px 0',
      }}>
        {[
          { label: 'Median to HCHB', value: summary.medianToHchb == null ? '-' : `${summary.medianToHchb}d`, sub: summary.p90ToHchb == null ? 'No stamps' : `p90 ${summary.p90ToHchb}d`, color: daysColor(summary.medianToHchb, { warn: 1, alert: 3 }) },
          { label: 'Median to SOC', value: summary.medianToSoc == null ? '-' : `${summary.medianToSoc}d`, sub: summary.p90ToSoc == null ? 'No completes' : `p90 ${summary.p90ToSoc}d`, color: daysColor(summary.medianToSoc, { warn: 10, alert: 21 }) },
          { label: 'Waiting 7+ days', value: summary.stuckOver7, sub: `${summary.openCount} still open`, color: ORANGE, onClick: () => setFilter('minDays', filters.minDays === '7' ? '' : '7') },
          { label: 'Outliers', value: summary.outlierCount, sub: 'Long waits and slow hops', color: MAGENTA, onClick: () => toggleFilter('outliersOnly', true) },
        ].map((m) => (
          <button
            key={m.label}
            type="button"
            onClick={m.onClick}
            style={{
              border: 'none',
              background: 'none',
              padding: '8px 4px',
              textAlign: 'left',
              cursor: m.onClick ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 650, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.faint, marginBottom: 10 }}>{m.label}</div>
            <div style={{ fontSize: 36, fontWeight: 750, letterSpacing: '-0.03em', color: m.color, lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontSize: 13, color: t.muted, marginTop: 8 }}>{m.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20, marginBottom: 28 }}>
        <Panel>
          <Label>Time between stages</Label>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: t.faint, marginBottom: 22 }}>
            <span><span style={{ display: 'inline-block', width: 18, height: 8, borderRadius: 4, background: t.ink, marginRight: 8, verticalAlign: 'middle' }} />Median</span>
            <span><span style={{ display: 'inline-block', width: 18, height: 8, borderRadius: 4, background: t.track, marginRight: 8, verticalAlign: 'middle' }} />90th percentile</span>
          </div>
          {summary.hops.map((hop) => {
            const medPct = hop.median == null ? 0 : Math.min(100, (hop.median / hopScale) * 100);
            const p90Pct = hop.p90 == null ? 0 : Math.min(100, (hop.p90 / hopScale) * 100);
            const active = filters.stuckHop === hop.key;
            return (
              <button
                key={hop.key}
                type="button"
                onClick={() => toggleFilter('stuckHop', hop.key)}
                style={{
                  display: 'block',
                  width: '100%',
                  border: 'none',
                  background: 'none',
                  padding: '10px 0 18px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  outline: active ? `2px solid ${HOP_COLOR[hop.key]}` : 'none',
                  outlineOffset: 4,
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 14, color: t.ink }}>{hop.label}</span>
                  <span style={{ fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>
                    {hop.median == null ? 'no completes' : `${hop.median}d median`}
                    {hop.p90 != null ? `  ·  ${hop.p90}d p90` : ''}
                  </span>
                </div>
                <div style={{ height: 10, borderRadius: 10, background: t.track, position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0, width: `${p90Pct}%`, background: t.line, borderRadius: 10 }} />
                  <div style={{ position: 'absolute', inset: 0, width: `${medPct}%`, background: HOP_COLOR[hop.key], borderRadius: 10 }} />
                </div>
              </button>
            );
          })}
        </Panel>

        <Panel>
          <Label>Waiting now</Label>
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
            {summary.hops.map((hop) => (
              <Ring
                key={hop.key}
                size={96}
                pct={maxStuck ? (hop.stuck / maxStuck) * 100 : 0}
                color={HOP_COLOR[hop.key]}
                center={hop.stuck}
                sub={hop.label.replace(' → ', '\n')}
                onClick={() => toggleFilter('stuckHop', hop.key)}
                active={filters.stuckHop === hop.key}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
            {AGING_BUCKETS.map((b) => {
              const n = summary.agingOpen[b] || 0;
              const on = filters.aging === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setFilter('aging', on ? '' : b)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'none',
                    padding: '12px 4px 0',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                    boxShadow: on ? `inset 0 -2px 0 ${MAGENTA}` : 'none',
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 750, color: n && (b === '31+ days' || b === '15-30 days') ? ORANGE : t.ink }}>{n}</div>
                  <div style={{ fontSize: 11, color: t.faint, marginTop: 4 }}>{b.replace(' days', 'd')}</div>
                </button>
              );
            })}
          </div>
          <Label>Longest waits</Label>
          {longestWaits.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: t.muted }}>No open waits in this view.</p>
          ) : (
            longestWaits.slice(0, 6).map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${t.line}` }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 650, color: t.ink }}>{r.patient_name}</div>
                  <div style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>{r.stuck_label}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 750, color: daysColor(r.current_wait) }}>{r.current_wait}d</div>
              </div>
            ))
          )}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 28 }}>
        <Panel>
          <Label>Days to HCHB</Label>
          <Histogram
            buckets={summary.hchbHistogram}
            color={MAGENTA}
            activeMin={filters.hchbMinDays}
            activeMax={filters.hchbMaxDays}
            onBarClick={(b) => {
              setFilters((prev) => ({
                ...prev,
                hchbNotEntered: false,
                hchbMinDays: String(b.min),
                hchbMaxDays: Number.isFinite(b.max) ? String(b.max) : '',
              }));
            }}
          />
        </Panel>
        <Panel>
          <Label>Days to SOC</Label>
          <Histogram
            buckets={summary.socHistogram}
            color={GREEN}
            activeMin={filters.cohort === 'soc' ? filters.minDays : ''}
            activeMax={filters.cohort === 'soc' ? filters.maxDays : ''}
            onBarClick={(b) => {
              setFilters((prev) => ({
                ...prev,
                cohort: 'soc',
                minDays: String(b.min),
                maxDays: Number.isFinite(b.max) ? String(b.max) : '',
              }));
            }}
          />
        </Panel>
        <Panel>
          <Label>Weekly volume</Label>
          <WeeklyChart series={weekly} />
          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 12, color: t.muted }}>
            <span>Referrals</span>
            <span>HCHB</span>
            <span>SOC</span>
          </div>
        </Panel>
      </div>

      <Panel style={{ marginBottom: 12 }}>
          <Label>Cases</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: chips.length ? 14 : 20 }}>
            <input style={inputStyle()} placeholder="Patient" value={filters.patient} onChange={(e) => setFilter('patient', e.target.value)} />
            <input style={inputStyle()} placeholder="Facility" value={filters.facility} onChange={(e) => setFilter('facility', e.target.value)} />
            <input style={inputStyle()} placeholder="Marketer" value={filters.marketer} onChange={(e) => setFilter('marketer', e.target.value)} />
            <input style={inputStyle()} placeholder="Intake" value={filters.intakeOwner} onChange={(e) => setFilter('intakeOwner', e.target.value)} />
            <input style={inputStyle()} placeholder="RN" value={filters.clinicalRn} onChange={(e) => setFilter('clinicalRn', e.target.value)} />
            <select style={selectStyle()} value={filters.stage} onChange={(e) => setFilter('stage', e.target.value)}>
              <option value="">Stage</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={selectStyle()} value={filters.stuckHop} onChange={(e) => setFilter('stuckHop', e.target.value)}>
              <option value="">Wait point</option>
              {JOURNEY_HOPS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
            <select style={selectStyle()} value={filters.service} onChange={(e) => setFilter('service', e.target.value)}>
              <option value="">Service</option>
              {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={selectStyle()} value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">Priority</option>
              {PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {uniqueSorted(annotated, 'facility').length > 0 && (
              <select style={selectStyle()} value={filters.facility} onChange={(e) => setFilter('facility', e.target.value)}>
                <option value="">Facility list</option>
                {uniqueSorted(annotated, 'facility').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
          {chips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18, alignItems: 'center' }}>
              {chips.map((c) => <Chip key={c.key} label={c.label} onClear={() => clearChip(c.key)} />)}
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: t.faint, fontFamily: 'inherit' }}
              >
                Clear
              </button>
            </div>
          )}
          <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto', margin: '0 -8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  {th('patient_name', 'Patient')}
                  {th('current_stage', 'Stage')}
                  {th('days_to_hchb', 'To HCHB')}
                  {th('days_to_soc', 'To SOC')}
                  {th('current_wait', 'Wait')}
                  {th('stuck_label', 'Stuck at')}
                  {th('intake_owner', 'Intake')}
                  {th('clinical_rn', 'RN')}
                  {th('facility', 'Facility')}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.id || i} style={{ background: i % 2 ? t.alt : t.card }}>
                    <td style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 650, color: t.ink, whiteSpace: 'nowrap' }}>{r.patient_name}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>{r.current_stage}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 700, color: r.hchb_on_time === 'Yes' ? GREEN : daysColor(r.days_to_hchb, { warn: 1, alert: 3 }) }}>{fmtDays(r.days_to_hchb)}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13.5, color: daysColor(r.days_to_soc, { warn: 10, alert: 21 }) }}>{fmtDays(r.days_to_soc)}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 750, color: daysColor(r.current_wait) }}>{fmtDays(r.current_wait)}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>{r.stuck_label}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>{r.intake_owner}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>{r.clinical_rn}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: t.muted, whiteSpace: 'nowrap' }}>{r.facility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <p style={{ padding: 36, textAlign: 'center', fontSize: 14, color: t.faint, margin: 0 }}>No cases match these filters.</p>
            )}
          </div>
      </Panel>
    </div>
  );
}
