import { useState, useMemo, useCallback } from 'react';
import { usePipelineData } from '../hooks/usePipelineData.js';
import { useLookups } from '../hooks/useLookups.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { useCareStore, mergeEntities } from '../store/careStore.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { exportToExcel } from '../utils/reportEngine.js';
import LoadingState from '../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import {
  fmtCalendarDate,
  parseCalendarDate,
  daysSinceCalendarDate,
  todayCalendarDate,
  toCalendarDateString,
} from '../utils/dateFormat.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import {
  PROCESSING_FLAG_COLUMNS,
  PROCESSING_META_COLUMNS,
  PROCESSING_OVERVIEW_EXPORT_COLUMNS,
  VERIFYABLE_FLAG_KEYS,
  buildProcessingOverviewRows,
} from '../utils/processingOverview.js';
import { verifyPhysicianNpi } from '../api/cms.js';
import { updatePhysician } from '../api/physicians.js';
import { normalizePhysicianTitle } from '../utils/physicianName.js';
import ReferralToSocView from '../components/dataTools/ReferralToSocView.jsx';

const PIPELINE_STAGES = [
  'Clinical Lead Pre-Check','Lead Entry','Intake','Eligibility Verification','Disenrollment Required',
  'F2F/MD Orders Pending','Clinical Intake RN Review','Authorization Pending',
  'Conflict','EMR Onboarding','Staffing Feasibility','Admin Confirmation',
  'Pre-SOC','SOC Scheduled','SOC Completed','Hold','NTUC',
];
const TERMINAL = new Set(['SOC Completed','NTUC']);
const ALL_SERVICES = ['SN','PT','OT','ST','HHA','ABA'];

const STAGE_COLOR = {
  'Clinical Lead Pre-Check': palette.primaryDeepPlum.hex,
  'Lead Entry': palette.accentBlue.hex,
  'Intake': hexToRgba(palette.accentBlue.hex, 0.7),
  'Eligibility Verification': palette.accentOrange.hex,
  'Disenrollment Required': hexToRgba(palette.accentOrange.hex, 0.7),
  'F2F/MD Orders Pending': hexToRgba(palette.accentOrange.hex, 0.5),
  'Clinical Intake RN Review': palette.primaryMagenta.hex,
  'Authorization Pending': hexToRgba(palette.primaryMagenta.hex, 0.6),
  'Conflict': hexToRgba(palette.primaryMagenta.hex, 0.4),
  'EMR Onboarding': hexToRgba(palette.accentGreen.hex, 0.55),
  'Staffing Feasibility': hexToRgba(palette.accentBlue.hex, 0.4),
  'Admin Confirmation': palette.primaryDeepPlum.hex,
  'Pre-SOC': hexToRgba(palette.accentGreen.hex, 0.4),
  'SOC Scheduled': hexToRgba(palette.accentGreen.hex, 0.65),
  'SOC Completed': palette.accentGreen.hex,
  'Hold': palette.highlightYellow.hex,
  'NTUC': hexToRgba(palette.backgroundDark.hex, 0.35),
};

const PERIOD_PRESETS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y',  days: 365 },
  { label: 'All', days: null },
  { label: 'Custom', days: 'custom' },
];

const COMPARE_METRICS = [
  { key: 'total',         label: 'Total Referrals',         fmt: 'n' },
  { key: 'alf',           label: 'ALF Division',            fmt: 'n' },
  { key: 'sn',            label: 'Special Needs Division',  fmt: 'n' },
  { key: 'active',        label: 'Active (in pipeline)',    fmt: 'n' },
  { key: 'soc',           label: 'SOC Completed',          fmt: 'n' },
  { key: 'ntuc',          label: 'NTUC',                   fmt: 'n' },
  { key: 'hold',          label: 'On Hold',                fmt: 'n' },
  { key: 'high_priority', label: 'High / Critical Priority', fmt: 'n' },
  { key: 'conversion',    label: 'SOC Conversion Rate',    fmt: '%' },
  { key: 'ntuc_rate',     label: 'NTUC Rate',              fmt: '%' },
  { key: 'avg_days',      label: 'Avg Days in Pipeline',   fmt: 'd' },
];

const TABS = ['Overview','Referral to SOC','Trends','Sources','Period Comparison','Heatmap','Processing Overview','Data Table'];

// ── Utility ───────────────────────────────────────────────────────────────────

function dayStart(daysAgo) {
  const d = new Date();
  d.setHours(0,0,0,0);
  if (daysAgo !== null) d.setDate(d.getDate() - daysAgo);
  return daysAgo === null ? new Date(0) : d;
}

function filterByPeriod(referrals, days) {
  if (days === null) return referrals;
  const cutoff = dayStart(days).getTime();
  return referrals.filter((r) => {
    const d = parseCalendarDate(r.referral_date);
    return d && d.getTime() >= cutoff;
  });
}

function filterByDivision(referrals, division) {
  if (division === 'All') return referrals;
  return referrals.filter((r) => r.division === division);
}

function filterByDateRange(referrals, start, end) {
  const s = start ? (parseCalendarDate(start)?.getTime() ?? 0) : 0;
  const e = end ? ((parseCalendarDate(end)?.getTime() ?? 0) + 86400000 - 1) : Date.now();
  return referrals.filter((r) => {
    if (!r.referral_date) return false;
    const t = parseCalendarDate(r.referral_date)?.getTime();
    return t != null && t >= s && t <= e;
  });
}

function computeMetrics(referrals) {
  const total = referrals.length;
  const soc   = referrals.filter((r) => isSocCompletedReferral(r)).length;
  const ntuc  = referrals.filter((r) => r.current_stage === 'NTUC').length;
  const withDates = referrals.filter((r) => r.referral_date);
  const sumDays = withDates.reduce((s, r) => s + (daysSinceCalendarDate(r.referral_date) ?? 0), 0);
  return {
    total,
    alf:           referrals.filter((r) => r.division === 'ALF').length,
    sn:            referrals.filter((r) => r.division === 'Special Needs').length,
    active:        referrals.filter((r) => !TERMINAL.has(r.current_stage)).length,
    soc,
    ntuc,
    hold:          referrals.filter((r) => r.current_stage === 'Hold').length,
    high_priority: referrals.filter((r) => r.priority === 'High' || r.priority === 'Critical').length,
    conversion:    total > 0 ? (soc / total) * 100 : 0,
    ntuc_rate:     total > 0 ? (ntuc / total) * 100 : 0,
    avg_days:      withDates.length > 0 ? Math.round(sumDays / withDates.length) : null,
  };
}

function weekLabel(date) {
  const d = new Date(date);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function groupByWeek(referrals, nWeeks = 16) {
  const now = Date.now();
  const weeks = Array.from({ length: nWeeks }, (_, i) => {
    const end   = new Date(now - i * 7 * 86400000);
    const start = new Date(end.getTime() - 7 * 86400000);
    return { start, end, count: 0, label: weekLabel(start) };
  }).reverse();

  referrals.forEach((r) => {
    if (!r.referral_date) return;
    const t = parseCalendarDate(r.referral_date)?.getTime();
    if (t == null) return;
    const w = weeks.find((w) => t >= w.start.getTime() && t < w.end.getTime());
    if (w) w.count++;
  });
  return weeks;
}

function groupByKey(referrals, keyFn, labelFn) {
  const counts = {};
  referrals.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    counts[k] = (counts[k] || { key: k, label: labelFn ? labelFn(k) : k, count: 0 });
    counts[k].count++;
  });
  return Object.values(counts).sort((a, b) => b.count - a.count);
}

function fmtMetric(value, fmt) {
  if (value === null || value === undefined) return '—';
  if (fmt === '%') return `${value.toFixed(1)}%`;
  if (fmt === 'd') return `${value}d`;
  return String(value);
}

function deltaColor(delta, fmt) {
  if (delta === null || delta === 0) return hexToRgba(palette.backgroundDark.hex, 0.4);
  if (fmt === '%' || fmt === 'n' || fmt === 'd') {
    return delta > 0 ? palette.accentGreen.hex : palette.accentOrange.hex;
  }
  return hexToRgba(palette.backgroundDark.hex, 0.4);
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      background: palette.backgroundLight.hex, borderRadius: 12,
      border: `1px solid var(--color-border)`, padding: '18px 20px', ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 14 }}>
      {children}
    </p>
  );
}

function KpiCard({ label, value, sub, color, delta }) {
  return (
    <Card>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.42), marginBottom: 6 }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p style={{ fontSize: 30, fontWeight: 800, color: color || palette.backgroundDark.hex, lineHeight: 1 }}>
          {value}
        </p>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span style={{ fontSize: 12, fontWeight: 700,
            color: delta > 0 ? palette.accentGreen.hex : palette.accentOrange.hex }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {sub && <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.38), marginTop: 4 }}>{sub}</p>}
    </Card>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function HBar({ label, value, max, color, total }) {
  const pct    = max > 0 ? (value / max) * 100 : 0;
  const ofTot  = total > 0 ? ` · ${((value / total) * 100).toFixed(0)}%` : '';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.72), maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: palette.backgroundDark.hex }}>{value}<span style={{ fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>{ofTot}</span></span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.07) }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function BarChart({ data, color, height = 100, showLabels = true }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const W = Math.max(data.length * 22, 200);
  const bw = 14;
  const step = W / data.length;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height + (showLabels ? 22 : 4)}`} preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}>
      {data.map((d, i) => {
        const bh = max > 0 ? ((d.count / max) * height) : 0;
        const x = i * step + (step - bw) / 2;
        const y = height - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh || 1} rx={3} fill={color}
              opacity={bh === 0 ? 0.2 : 0.85} />
            {bh > 0 && (
              <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize={8}
                fill={hexToRgba(palette.backgroundDark.hex, 0.55)}>{d.count}</text>
            )}
            {showLabels && (
              <text x={x + bw / 2} y={height + 16} textAnchor="middle" fontSize={8.5}
                fill={hexToRgba(palette.backgroundDark.hex, 0.45)}>{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, color, height = 80 }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const W = 400;
  const step = W / (data.length - 1);
  const pts = data.map((d, i) => [i * step, height - 4 - ((d.count / max) * (height - 8))]);
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${(data.length - 1) * step},${height} L0,${height} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="lgfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#lgfill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={color} />
      ))}
    </svg>
  );
}

function DonutChart({ segments, size = 100, label }) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div style={{ width: size, height: size }} />;

  const cx = size / 2, cy = size / 2;
  const r = size * 0.38;
  let angle = -90;
  const arcs = segments.map((seg) => {
    const sweep = (seg.value / total) * 360;
    const a1r = (angle * Math.PI) / 180;
    const a2r = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a1r), y1 = cy + r * Math.sin(a1r);
    const x2 = cx + r * Math.cos(a2r), y2 = cy + r * Math.sin(a2r);
    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    angle += sweep;
    return { ...seg, d };
  });

  return (
    <svg width={size} height={size}>
      {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} opacity={0.88} />)}
      <circle cx={cx} cy={cy} r={r * 0.58} fill={palette.backgroundLight.hex} />
      {label && (
        <>
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={16} fontWeight="800"
            fill={palette.backgroundDark.hex}>{label}</text>
          <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9}
            fill={hexToRgba(palette.backgroundDark.hex, 0.4)}>total</text>
        </>
      )}
    </svg>
  );
}

function FunnelChart({ stages, counts }) {
  const max = Math.max(...Object.values(counts), 1);
  const active = stages.filter((s) => !TERMINAL.has(s));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {active.map((stage) => {
        const n = counts[stage] || 0;
        const pct = (n / max) * 100;
        const margin = (100 - pct) / 2;
        return (
          <div key={stage}
            style={{ marginLeft: `${margin * 0.6}%`, marginRight: `${margin * 0.6}%`, transition: 'margin 0.4s' }}>
            <div style={{
              height: 26, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 10px', background: STAGE_COLOR[stage] || hexToRgba(palette.backgroundDark.hex, 0.2),
              opacity: n > 0 ? 0.92 : 0.22,
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 650, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '75%' }}>{stage}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{n}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarHeatmap({ referrals, weeks = 20 }) {
  const counts = {};
  referrals.forEach((r) => {
    if (!r.referral_date) return;
    const d = toCalendarDateString(r.referral_date);
    if (!d) return;
    counts[d] = (counts[d] || 0) + 1;
  });
  const max = Math.max(...Object.values(counts), 1);

  const now = new Date();
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (weeks * 7 - 1 - i));
    return toCalendarDateString(d);
  });

  const grid = [];
  for (let w = 0; w < weeks; w++) {
    grid.push(days.slice(w * 7, w * 7 + 7));
  }

  const DOW = ['M','T','W','T','F','S','S'];

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 4 }}>
          {DOW.map((d, i) => (
            <div key={i} style={{ height: 13, display: 'flex', alignItems: 'center',
              fontSize: 9, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
              {i % 2 === 0 ? d : ''}
            </div>
          ))}
        </div>
        {/* Columns */}
        {grid.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ height: 12, fontSize: 8, color: hexToRgba(palette.backgroundDark.hex, 0.3),
              whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {wi % 4 === 0 ? week[0]?.slice(5).replace('-','/') : ''}
            </div>
            {week.map((day, di) => {
              const n = counts[day] || 0;
              const intensity = n > 0 ? 0.15 + (n / max) * 0.85 : 0;
              return (
                <div key={di} title={`${day}: ${n} referral${n !== 1 ? 's' : ''}`}
                  style={{
                    width: 13, height: 13, borderRadius: 2,
                    background: n === 0
                      ? hexToRgba(palette.backgroundDark.hex, 0.06)
                      : hexToRgba(palette.accentGreen.hex, intensity),
                    cursor: n > 0 ? 'default' : undefined,
                    border: n > 0 ? `1px solid ${hexToRgba(palette.accentGreen.hex, 0.2)}` : '1px solid transparent',
                  }} />
              );
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10 }}>
        <span style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Less</span>
        {[0.06, 0.25, 0.45, 0.65, 0.85, 1].map((o, i) => (
          <div key={i} style={{ width: 11, height: 11, borderRadius: 2,
            background: i === 0 ? hexToRgba(palette.backgroundDark.hex, 0.06) : hexToRgba(palette.accentGreen.hex, o) }} />
        ))}
        <span style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>More</span>
      </div>
    </div>
  );
}

// ── Period selector ───────────────────────────────────────────────────────────

function PeriodSelector({ value, onChange, customRange, onCustomRangeChange }) {
  const dateInputStyle = {
    fontSize: 12, padding: '4px 7px', borderRadius: 6,
    border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
    background: palette.backgroundLight.hex, color: palette.backgroundDark.hex,
  };
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      {PERIOD_PRESETS.map((p) => (
        <button key={p.label} onClick={() => onChange(p.days)}
          style={{
            padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 650,
            background: value === p.days ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
            color:      value === p.days ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
            transition: 'all 0.12s',
          }}>
          {p.label}
        </button>
      ))}
      {value === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          <input type="date" value={customRange?.from || ''} max={customRange?.to || undefined}
            onChange={(e) => onCustomRangeChange({ ...customRange, from: e.target.value })}
            style={dateInputStyle} aria-label="From date" />
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>to</span>
          <input type="date" value={customRange?.to || ''} min={customRange?.from || undefined}
            onChange={(e) => onCustomRangeChange({ ...customRange, to: e.target.value })}
            style={dateInputStyle} aria-label="To date" />
        </span>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid var(--color-border)`, marginBottom: 24, overflowX: 'auto' }}>
      {TABS.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          style={{
            padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: active === t ? 700 : 500,
            color: active === t ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.45),
            borderBottom: `2px solid ${active === t ? palette.primaryMagenta.hex : 'transparent'}`,
            marginBottom: -1, whiteSpace: 'nowrap', transition: 'all 0.12s',
          }}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ referrals, allReferrals }) {
  const m  = useMemo(() => computeMetrics(referrals), [referrals]);
  const mA = useMemo(() => computeMetrics(allReferrals), [allReferrals]);

  const stageCounts = useMemo(() =>
    PIPELINE_STAGES.reduce((acc, s) => { acc[s] = referrals.filter((r) => r.current_stage === s).length; return acc; }, {}),
    [referrals]);

  const divisionSegments = [
    { label: 'ALF',           value: m.alf, color: palette.accentBlue.hex },
    { label: 'Special Needs', value: m.sn,  color: palette.primaryMagenta.hex },
  ];

  const prioritySegments = [
    { label: 'Low',      value: referrals.filter((r) => r.priority === 'Low').length,      color: hexToRgba(palette.backgroundDark.hex, 0.25) },
    { label: 'Normal',   value: referrals.filter((r) => r.priority === 'Normal' || !r.priority).length, color: palette.accentBlue.hex },
    { label: 'High',     value: referrals.filter((r) => r.priority === 'High').length,      color: palette.accentOrange.hex },
    { label: 'Critical', value: referrals.filter((r) => r.priority === 'Critical').length,  color: palette.primaryMagenta.hex },
  ];

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total Referrals"   value={m.total}  sub={`${mA.total} all time`} color={palette.primaryMagenta.hex} />
        <KpiCard label="Active in Pipeline" value={m.active} sub={`${((m.active / Math.max(m.total,1)) * 100).toFixed(0)}% of period`} color={palette.accentBlue.hex} />
        <KpiCard label="SOC Conversion"    value={`${m.conversion.toFixed(1)}%`} sub={`${m.soc} completed`} color={palette.accentGreen.hex} />
        <KpiCard label="NTUC Rate"         value={`${m.ntuc_rate.toFixed(1)}%`}  sub={`${m.ntuc} cases`}  color={m.ntuc_rate > 20 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>

        {/* Division split */}
        <Card>
          <SectionTitle>Division Split</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart segments={divisionSegments} size={96} label={m.total} />
            <div style={{ flex: 1 }}>
              {divisionSegments.map((s) => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                    <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>{s.label}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Priority split */}
        <Card>
          <SectionTitle>Priority Distribution</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart segments={prioritySegments} size={96} />
            <div style={{ flex: 1 }}>
              {prioritySegments.map((s) => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                    <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>{s.label}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Services */}
        <Card>
          <SectionTitle>Services Requested</SectionTitle>
          {ALL_SERVICES.map((svc) => {
            const n = referrals.filter((r) => Array.isArray(r.services_requested) && r.services_requested.includes(svc)).length;
            return <HBar key={svc} label={svc} value={n} max={m.total} color={palette.accentBlue.hex} total={m.total} />;
          })}
        </Card>
      </div>

      {/* Stage distribution */}
      <Card>
        <SectionTitle>Stage Distribution</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PIPELINE_STAGES.map((stage) => (
            <HBar key={stage} label={stage} value={stageCounts[stage] || 0}
              max={Math.max(...Object.values(stageCounts), 1)}
              color={STAGE_COLOR[stage]}
              total={m.total} />
          ))}
        </div>
      </Card>

      {/* Funnel */}
      <Card style={{ marginTop: 14 }}>
        <SectionTitle>Pipeline Funnel (active stages)</SectionTitle>
        <FunnelChart stages={PIPELINE_STAGES} counts={stageCounts} />
      </Card>
    </div>
  );
}

// ── Trends Tab ────────────────────────────────────────────────────────────────

function TrendsTab({ referrals }) {
  const [view, setView] = useState('weekly');
  const weeklyData = useMemo(() => groupByWeek(referrals, 20), [referrals]);

  const divWeeks = useMemo(() => ({
    ALF: groupByWeek(referrals.filter((r) => r.division === 'ALF'), 20),
    SN:  groupByWeek(referrals.filter((r) => r.division === 'Special Needs'), 20),
  }), [referrals]);

  const ntucTrend = useMemo(() => groupByWeek(referrals.filter((r) => r.current_stage === 'NTUC'), 20), [referrals]);
  const socTrend  = useMemo(() => groupByWeek(referrals.filter((r) => isSocCompletedReferral(r)), 20), [referrals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <SectionTitle>Referral Volume — Weekly</SectionTitle>
        </div>
        <BarChart data={weeklyData} color={palette.primaryMagenta.hex} height={100} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <SectionTitle>ALF Referrals — Trend</SectionTitle>
          <LineChart data={divWeeks.ALF} color={palette.accentBlue.hex} height={70} />
        </Card>
        <Card>
          <SectionTitle>Special Needs Referrals — Trend</SectionTitle>
          <LineChart data={divWeeks.SN} color={palette.primaryMagenta.hex} height={70} />
        </Card>
        <Card>
          <SectionTitle>SOC Completions — Weekly</SectionTitle>
          <LineChart data={socTrend} color={palette.accentGreen.hex} height={70} />
        </Card>
        <Card>
          <SectionTitle>NTUC Cases — Weekly</SectionTitle>
          <LineChart data={ntucTrend} color={palette.accentOrange.hex} height={70} />
        </Card>
      </div>

      {/* NTUC reasons */}
      <Card>
        <SectionTitle>NTUC Breakdown by Reason</SectionTitle>
        {(() => {
          const ntucRefs = referrals.filter((r) => r.current_stage === 'NTUC' && r.ntuc_reason);
          const counts = {};
          ntucRefs.forEach((r) => { counts[r.ntuc_reason] = (counts[r.ntuc_reason] || 0) + 1; });
          const sorted = Object.entries(counts).sort(([,a],[,b]) => b - a);
          if (!sorted.length) return <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontStyle: 'italic' }}>No NTUC data in period.</p>;
          const max = sorted[0][1];
          return sorted.map(([reason, n]) => (
            <HBar key={reason} label={reason} value={n} max={max} color={palette.accentOrange.hex} total={ntucRefs.length} />
          ));
        })()}
      </Card>
    </div>
  );
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function SourcesTab({ referrals, resolveMarketer, resolveSource }) {
  const sourceData   = useMemo(() => groupByKey(referrals, (r) => r.referral_source_id, resolveSource).slice(0, 12), [referrals, resolveSource]);
  const marketerData = useMemo(() => groupByKey(referrals, (r) => r.marketer_id, resolveMarketer).slice(0, 12), [referrals, resolveMarketer]);

  const maxS = sourceData[0]?.count || 1;
  const maxM = marketerData[0]?.count || 1;

  const total = referrals.length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Card>
        <SectionTitle>Top Referral Sources</SectionTitle>
        {sourceData.length === 0
          ? <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontStyle: 'italic' }}>No data.</p>
          : sourceData.map((s) => <HBar key={s.key} label={s.label} value={s.count} max={maxS} color={palette.accentOrange.hex} total={total} />)}
      </Card>
      <Card>
        <SectionTitle>Marketer Performance</SectionTitle>
        {marketerData.length === 0
          ? <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), fontStyle: 'italic' }}>No data.</p>
          : marketerData.map((m) => <HBar key={m.key} label={m.label} value={m.count} max={maxM} color={palette.accentBlue.hex} total={total} />)}
      </Card>

      {/* Priority by source — top 8 */}
      <Card style={{ gridColumn: '1 / -1' }}>
        <SectionTitle>Referrals by Priority × Source (top sources)</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {sourceData.slice(0, 8).map((s) => {
            const srcRefs = referrals.filter((r) => r.referral_source_id === s.key);
            const high = srcRefs.filter((r) => r.priority === 'High' || r.priority === 'Critical').length;
            const highPct = srcRefs.length > 0 ? ((high / srcRefs.length) * 100).toFixed(0) : 0;
            return (
              <div key={s.key} style={{ padding: '12px 14px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.03), border: `1px solid var(--color-border)` }}>
                <p style={{ fontSize: 11.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: palette.backgroundDark.hex, lineHeight: 1 }}>{s.count}</p>
                <p style={{ fontSize: 11, color: high > 0 ? palette.accentOrange.hex : palette.accentGreen.hex, marginTop: 4 }}>
                  {highPct}% high/critical
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Period Comparison Tab ─────────────────────────────────────────────────────

function PeriodComparisonTab({ allReferrals }) {
  const today = todayCalendarDate();
  const [aStart, setAStart] = useState('');
  const [aEnd,   setAEnd]   = useState('');
  const [bStart, setBStart] = useState('');
  const [bEnd,   setBEnd]   = useState('');
  const [selected, setSelected] = useState(new Set(COMPARE_METRICS.slice(0, 6).map((m) => m.key)));
  const [result, setResult] = useState(null);

  function toggleMetric(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function runComparison() {
    const refA = filterByDateRange(allReferrals, aStart, aEnd);
    const refB = filterByDateRange(allReferrals, bStart, bEnd);
    setResult({ a: computeMetrics(refA), b: computeMetrics(refB), countA: refA.length, countB: refB.length });
  }

  const inputStyle = {
    padding: '7px 10px', borderRadius: 7, border: `1px solid var(--color-border)`,
    fontSize: 13, fontFamily: 'inherit', background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex, outline: 'none',
  };

  return (
    <div>
      {/* Period pickers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Card>
          <SectionTitle>Period A</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 4 }}>Start</p>
              <input type="date" max={today} value={aStart} onChange={(e) => setAStart(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 4 }}>End</p>
              <input type="date" max={today} value={aEnd} onChange={(e) => setAEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </Card>
        <Card>
          <SectionTitle>Period B</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 4 }}>Start</p>
              <input type="date" max={today} value={bStart} onChange={(e) => setBStart(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 4 }}>End</p>
              <input type="date" max={today} value={bEnd} onChange={(e) => setBEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </Card>
      </div>

      {/* Metric selector */}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Metrics to Compare</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {COMPARE_METRICS.map((m) => {
            const on = selected.has(m.key);
            return (
              <button key={m.key} onClick={() => toggleMetric(m.key)}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: `1px solid ${on ? palette.primaryMagenta.hex : 'var(--color-border)'}`,
                  fontSize: 12, fontWeight: on ? 650 : 500, cursor: 'pointer',
                  background: on ? hexToRgba(palette.primaryMagenta.hex, 0.08) : 'none',
                  color: on ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                  transition: 'all 0.12s',
                }}>
                {m.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}>
          <button
            onClick={runComparison}
            disabled={!aStart || !aEnd || !bStart || !bEnd}
            style={{
              padding: '9px 22px', borderRadius: 8, border: 'none',
              background: (aStart && aEnd && bStart && bEnd) ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
              color: (aStart && aEnd && bStart && bEnd) ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
              fontSize: 13, fontWeight: 700, cursor: (aStart && aEnd && bStart && bEnd) ? 'pointer' : 'not-allowed',
              letterSpacing: '-0.01em',
            }}>
            Run Comparison →
          </button>
        </div>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <SectionTitle>Comparison Results</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid var(--color-border)` }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>Metric</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>
                    Period A <span style={{ fontWeight: 400 }}>({aStart} → {aEnd})</span>
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>
                    Period B <span style={{ fontWeight: 400 }}>({bStart} → {bEnd})</span>
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>Δ Change</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>% Change</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.filter((m) => selected.has(m.key)).map((m, i) => {
                  const vA = result.a[m.key];
                  const vB = result.b[m.key];
                  const delta = (vA !== null && vB !== null) ? (m.fmt === '%' ? vB - vA : vB - vA) : null;
                  const pctChange = (vA && delta !== null) ? ((delta / Math.abs(vA)) * 100).toFixed(1) : null;
                  const dc = delta !== null ? deltaColor(delta, m.fmt) : hexToRgba(palette.backgroundDark.hex, 0.35);
                  return (
                    <tr key={m.key} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: i % 2 === 0 ? 'transparent' : hexToRgba(palette.backgroundDark.hex, 0.015) }}>
                      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{m.label}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: 13, color: palette.backgroundDark.hex }}>{fmtMetric(vA, m.fmt)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: 13, color: palette.backgroundDark.hex }}>{fmtMetric(vB, m.fmt)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: dc }}>
                        {delta !== null ? `${delta > 0 ? '+' : ''}${fmtMetric(delta, m.fmt)}` : '—'}
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                        {pctChange !== null ? (
                          <span style={{
                            fontSize: 11.5, fontWeight: 650, padding: '2px 8px', borderRadius: 20,
                            background: hexToRgba(dc, 0.1), color: dc,
                          }}>
                            {parseFloat(pctChange) > 0 ? '+' : ''}{pctChange}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Processing Overview Tab ───────────────────────────────────────────────────

const PO_BORDER = '#C5C5C5';
const PO_HEADER_BG = '#EFEFEF';
const PO_FILTER_BG = '#F7F7F7';
const PO_CELL = {
  padding: '5px 7px',
  border: `1px solid ${PO_BORDER}`,
  fontSize: 12,
  color: palette.backgroundDark.hex,
  background: palette.backgroundLight.hex,
  verticalAlign: 'middle',
};
const PO_TH = {
  ...PO_CELL,
  background: PO_HEADER_BG,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: '#333',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 3,
};
const PO_FILTER_TH = {
  ...PO_CELL,
  background: PO_FILTER_BG,
  padding: '3px 4px',
  position: 'sticky',
  top: 28,
  zIndex: 3,
};
const PO_FILTER_INPUT = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${PO_BORDER}`,
  background: '#fff',
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '3px 5px',
  outline: 'none',
  color: palette.backgroundDark.hex,
  minWidth: 56,
};

function YesNoCell({ yes, clickable, busy, title, onClick }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 34,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 750,
    letterSpacing: '0.02em',
    padding: '2px 6px',
    border: `1px solid ${yes ? '#8FCF9E' : '#D0D0D0'}`,
    background: yes ? '#E7F8EE' : '#F3F3F3',
    color: yes ? '#157347' : '#777',
    cursor: clickable && !busy ? 'pointer' : 'default',
  };
  if (busy) {
    return <span style={{ ...base, color: palette.primaryMagenta.hex }}>…</span>;
  }
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        style={{ ...base, fontFamily: 'inherit' }}
      >
        {yes ? 'Yes' : 'Check'}
      </button>
    );
  }
  return <span style={base}>{yes ? 'Yes' : 'No'}</span>;
}

function ProcessingOverviewTab({ referrals }) {
  const {
    resolveMarketer, resolveFacility, resolveUser, resolvePhysician, resolvePatient,
  } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const triageAdult = useCareStore((s) => s.triageAdult) || {};
  const triagePediatric = useCareStore((s) => s.triagePediatric) || {};
  const physicians = useCareStore((s) => s.physicians) || {};
  const patients = useCareStore((s) => s.patients) || {};
  const [exporting, setExporting] = useState(false);
  const [divFilter, setDivFilter] = useState('All');
  const [textFilters, setTextFilters] = useState({
    patientName: '', stage: '', facility: '', marketer: '', intakeOwner: '', doctor: '',
  });
  const [flagFilters, setFlagFilters] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);
  const [verifyError, setVerifyError] = useState(null);

  const setText = (key, val) => setTextFilters((prev) => ({ ...prev, [key]: val }));
  const setFlag = (key, val) => setFlagFilters((prev) => ({ ...prev, [key]: val }));

  const baseRows = useMemo(() => buildProcessingOverviewRows(referrals, {
    triageAdult,
    triagePediatric,
    physicians,
    patients,
    resolveFacility,
    resolveMarketer,
    resolveUser,
    resolvePhysician,
    resolvePatient,
  }), [
    referrals, triageAdult, triagePediatric, physicians, patients,
    resolveFacility, resolveMarketer, resolveUser, resolvePhysician, resolvePatient,
  ]);

  const rows = useMemo(() => {
    let list = baseRows;
    if (divFilter !== 'All') list = list.filter((r) => r.division === divFilter);

    const tf = textFilters;
    const match = (val, q) => !q || String(val || '').toLowerCase().includes(q.toLowerCase());
    list = list.filter((r) => (
      match(r.patientName, tf.patientName)
      && match(r.current_stage, tf.stage)
      && match(r.facility, tf.facility)
      && match(r.marketer, tf.marketer)
      && match(r.intakeOwner, tf.intakeOwner)
      && match(r.doctor, tf.doctor)
    ));

    for (const col of PROCESSING_FLAG_COLUMNS) {
      const f = flagFilters[col.key];
      if (f === 'Yes') list = list.filter((r) => r.flags[col.key]);
      else if (f === 'No') list = list.filter((r) => !r.flags[col.key]);
    }
    return list;
  }, [baseRows, divFilter, textFilters, flagFilters]);

  const bottleneckHint = useMemo(() => {
    if (!rows.length) return null;
    let worst = null;
    for (const col of PROCESSING_FLAG_COLUMNS) {
      if (col.key === 'socCompleted') continue;
      const nos = rows.filter((r) => !r.flags[col.key]).length;
      if (!worst || nos > worst.nos) worst = { label: col.label, nos };
    }
    if (!worst || worst.nos === 0) return null;
    const pct = Math.round((worst.nos / rows.length) * 100);
    return `${worst.label}: ${worst.nos} open (${pct}%)`;
  }, [rows]);

  const handleVerify = useCallback(async (row) => {
    const recId = row.physician_record_id;
    const npi = row.physician_npi;
    if (!recId || !npi || npi.length !== 10) {
      setVerifyError(
        !row.doctor
          ? 'No physician linked — add one on the patient Physician tab first.'
          : 'Physician needs a valid 10-digit NPI before CMS check.',
      );
      return;
    }
    setVerifyingId(recId);
    setVerifyError(null);
    try {
      const r = await verifyPhysicianNpi(npi);
      const title = normalizePhysicianTitle(r.details?.credential);
      const fields = {
        npi_status: r.npiStatus,
        npi_checked_at: r.checkedAt,
        npi_provider_name: r.providerName || '',
        npi_details: r.details ? JSON.stringify(r.details) : '',
        ...(title ? { title } : {}),
        is_pecos_enrolled: r.pecosEnrolled ? true : null,
        pecos_last_checked: r.checkedAt,
        is_opra_enrolled: r.opraEligible ? true : null,
        opra_last_checked: r.checkedAt,
        order_refer_flags: JSON.stringify(r.flags || {}),
        verification_last_run_at: r.checkedAt,
        verification_checked_by_id: appUserId || 'unknown',
      };
      await updatePhysician(recId, fields);
      const existing = physicians[recId] || {};
      mergeEntities('physicians', {
        [recId]: {
          ...existing,
          ...fields,
          is_pecos_enrolled: !!r.pecosEnrolled,
          is_opra_enrolled: !!r.opraEligible,
        },
      });
    } catch (e) {
      setVerifyError(e.message || 'CMS verification failed');
    } finally {
      setVerifyingId(null);
    }
  }, [appUserId, physicians]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportToExcel(
        rows,
        PROCESSING_OVERVIEW_EXPORT_COLUMNS,
        'Processing Overview',
        `${rows.length} patients · not SOC completed · ${new Date().toLocaleDateString()}`,
      );
    } finally {
      setExporting(false);
    }
  }

  const toolbarBtn = {
    padding: '6px 12px',
    border: `1px solid ${PO_BORDER}`,
    background: '#fff',
    fontSize: 12,
    fontFamily: 'inherit',
    color: palette.backgroundDark.hex,
    cursor: 'pointer',
  };

  return (
    <div>
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap',
        padding: '10px 12px',
        background: PO_HEADER_BG,
        border: `1px solid ${PO_BORDER}`,
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 750, color: palette.backgroundDark.hex }}>
            Processing Overview
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#666' }}>
            Open pipeline (not SOC completed). PECOS / OPRA / NPI cells: click to run CMS check.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={divFilter}
            onChange={(e) => setDivFilter(e.target.value)}
            style={{ ...toolbarBtn, minWidth: 140 }}
          >
            <option value="All">ALF + Special Needs</option>
            <option value="ALF">ALF only</option>
            <option value="Special Needs">Special Needs only</option>
          </select>
          <span style={{ fontSize: 12, color: '#666' }}>{rows.length} rows</span>
          {bottleneckHint && (
            <span style={{ fontSize: 11.5, fontWeight: 650, color: '#92400E', background: '#FEF4E5', border: '1px solid #F0D2A0', padding: '4px 8px' }}>
              Gap: {bottleneckHint}
            </span>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !rows.length}
            style={{
              ...toolbarBtn,
              background: palette.primaryMagenta.hex,
              borderColor: palette.primaryMagenta.hex,
              color: '#fff',
              fontWeight: 650,
              opacity: exporting || !rows.length ? 0.55 : 1,
              cursor: exporting || !rows.length ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? 'Exporting…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {verifyError && (
        <p style={{
          margin: '0 0 8px', fontSize: 12, color: palette.primaryMagenta.hex,
          padding: '6px 10px', border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.35)}`,
          background: hexToRgba(palette.primaryMagenta.hex, 0.06),
        }}>
          {verifyError}
        </p>
      )}

      <div style={{ border: `1px solid ${PO_BORDER}`, background: '#fff', overflow: 'auto', maxHeight: 'min(72vh, 680px)' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 1680 }}>
          <thead>
            <tr>
              {['Patient', 'Div', 'Stage', ...PROCESSING_META_COLUMNS.map((c) => c.label), ...PROCESSING_FLAG_COLUMNS.map((c) => c.label)].map((label, i) => (
                <th
                  key={label}
                  style={{
                    ...PO_TH,
                    ...(i === 0 ? { left: 0, zIndex: 5, minWidth: 140 } : null),
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...PO_FILTER_TH, left: 0, zIndex: 5, minWidth: 140 }}>
                <input
                  value={textFilters.patientName}
                  onChange={(e) => setText('patientName', e.target.value)}
                  placeholder="Filter"
                  style={PO_FILTER_INPUT}
                />
              </th>
              <th style={PO_FILTER_TH}>
                <select value={divFilter} onChange={(e) => setDivFilter(e.target.value)} style={PO_FILTER_INPUT}>
                  <option value="All">All</option>
                  <option value="ALF">ALF</option>
                  <option value="Special Needs">SPN</option>
                </select>
              </th>
              <th style={PO_FILTER_TH}>
                <input
                  value={textFilters.stage}
                  onChange={(e) => setText('stage', e.target.value)}
                  placeholder="Filter"
                  style={PO_FILTER_INPUT}
                />
              </th>
              {PROCESSING_META_COLUMNS.map((c) => (
                <th key={c.key} style={PO_FILTER_TH}>
                  <input
                    value={textFilters[c.key] || ''}
                    onChange={(e) => setText(c.key, e.target.value)}
                    placeholder="Filter"
                    style={PO_FILTER_INPUT}
                  />
                </th>
              ))}
              {PROCESSING_FLAG_COLUMNS.map((c) => (
                <th key={c.key} style={PO_FILTER_TH}>
                  <select
                    value={flagFilters[c.key] || ''}
                    onChange={(e) => setFlag(c.key, e.target.value)}
                    style={PO_FILTER_INPUT}
                  >
                    <option value="">All</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = verifyingId && verifyingId === r.physician_record_id;
              return (
                <tr key={r._id || r.referral_id}>
                  <td style={{
                    ...PO_CELL,
                    fontWeight: 650,
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    minWidth: 140,
                  }}>
                    {r.patientName}
                  </td>
                  <td style={{ ...PO_CELL, whiteSpace: 'nowrap' }}>
                    {r.division === 'Special Needs' ? 'SPN' : (r.division || '')}
                  </td>
                  <td style={{ ...PO_CELL, whiteSpace: 'nowrap' }}>{r.current_stage}</td>
                  {PROCESSING_META_COLUMNS.map((c) => (
                    <td key={c.key} style={{ ...PO_CELL, whiteSpace: 'nowrap', maxWidth: 180 }}>
                      {r[c.key] || '—'}
                    </td>
                  ))}
                  {PROCESSING_FLAG_COLUMNS.map((c) => {
                    const verifiable = VERIFYABLE_FLAG_KEYS.has(c.key);
                    return (
                      <td key={c.key} style={{ ...PO_CELL, textAlign: 'center' }}>
                        <YesNoCell
                          yes={!!r.flags[c.key]}
                          clickable={verifiable}
                          busy={busy && verifiable}
                          title={verifiable
                            ? (r.physician_npi?.length === 10
                              ? 'Click to run NPPES + CMS PECOS / OPRA check'
                              : 'Needs linked physician with 10-digit NPI')
                            : undefined}
                          onClick={verifiable ? () => handleVerify(r) : undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p style={{ padding: 28, textAlign: 'center', fontSize: 13, color: '#999', margin: 0 }}>
            No open pipeline patients match these filters.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Data Table Tab ────────────────────────────────────────────────────────────

function DataTableTab({ referrals, resolveMarketer, resolveSource }) {
  const [sortKey,  setSortKey]  = useState('referral_date');
  const [sortDir,  setSortDir]  = useState('desc');
  const [stageFilter, setStageFilter] = useState('All');
  const [divFilter,   setDivFilter]   = useState('All');
  const [exporting, setExporting] = useState(false);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const filtered = useMemo(() => {
    let r = referrals;
    if (stageFilter !== 'All') r = r.filter((x) => x.current_stage === stageFilter);
    if (divFilter   !== 'All') r = r.filter((x) => x.division === divFilter);
    return [...r].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'referral_date') { va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [referrals, stageFilter, divFilter, sortKey, sortDir]);

  async function handleExport() {
    setExporting(true);
    try {
      const columns = [
        { key: 'patientName',     label: 'Patient' },
        { key: 'division',        label: 'Division' },
        { key: 'current_stage',   label: 'Stage' },
        { key: 'priority',        label: 'Priority' },
        { key: 'referral_date',   label: 'Referral Date' },
        { key: 'source',          label: 'Source' },
        { key: 'marketer',        label: 'Marketer' },
        { key: 'services',        label: 'Services' },
      ];
      const rows = filtered.map((r) => ({
        patientName:   r.patientName || r.patient_id,
        division:      r.division || '',
        current_stage: r.current_stage || '',
        priority:      r.priority || 'Normal',
        referral_date: r.referral_date ? fmtCalendarDate(r.referral_date, '') : '',
        source:        resolveSource(r.referral_source_id),
        marketer:      resolveMarketer(r.marketer_id),
        services:      Array.isArray(r.services_requested) ? r.services_requested.join(', ') : '',
      }));
      await exportToExcel(rows, columns, 'CareStream Data Export', `${filtered.length} records · exported ${new Date().toLocaleDateString()}`);
    } finally { setExporting(false); }
  }

  const selectStyle = {
    padding: '6px 10px', borderRadius: 7, border: `1px solid var(--color-border)`,
    fontSize: 12.5, fontFamily: 'inherit', background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex, cursor: 'pointer', outline: 'none',
  };

  const th = (key, label) => (
    <th onClick={() => toggleSort(key)} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42),
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      borderBottom: `1px solid var(--color-border)`,
    }}>
      {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={selectStyle}>
          <option value="All">All stages</option>
          {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={divFilter} onChange={(e) => setDivFilter(e.target.value)} style={selectStyle}>
          <option value="All">All divisions</option>
          <option value="ALF">ALF</option>
          <option value="Special Needs">Special Needs</option>
        </select>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginLeft: 4 }}>
          {filtered.length} records
        </span>
        <button onClick={handleExport} disabled={exporting || !filtered.length}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: hexToRgba(palette.backgroundDark.hex, 0.07),
            color: hexToRgba(palette.backgroundDark.hex, 0.65),
            fontSize: 12.5, fontWeight: 650 }}>
          {exporting ? 'Exporting…' : '↓ Export Excel'}
        </button>
      </div>

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 10, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: hexToRgba(palette.backgroundDark.hex, 0.025), zIndex: 2 }}>
              <tr>
                {th('patientName',   'Patient')}
                {th('division',      'Division')}
                {th('current_stage', 'Stage')}
                {th('priority',      'Priority')}
                {th('referral_date', 'Referral Date')}
                {th('referral_source_id', 'Source')}
                {th('marketer_id',   'Marketer')}
                <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.42), borderBottom: `1px solid var(--color-border)` }}>Services</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r._id} style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: i % 2 !== 0 ? hexToRgba(palette.backgroundDark.hex, 0.012) : 'transparent' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{r.patientName || r.patient_id}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{r.division}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                      background: hexToRgba(STAGE_COLOR[r.current_stage] || '#888', 0.15),
                      color: STAGE_COLOR[r.current_stage] || hexToRgba(palette.backgroundDark.hex, 0.7) }}>
                      {r.current_stage}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: r.priority === 'Critical' ? palette.primaryMagenta.hex : r.priority === 'High' ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                    {r.priority || 'Normal'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                    {r.referral_date ? fmtCalendarDate(r.referral_date) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveSource(r.referral_source_id)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>{resolveMarketer(r.marketer_id)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                    {Array.isArray(r.services_requested) ? r.services_requested.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p style={{ padding: '32px', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No records match the selected filters.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataTools() {
  // All hooks must be declared before any conditional returns (Rules of Hooks).
  const { appUser } = useCurrentAppUser();
  const { data: allReferrals, loading } = usePipelineData();
  const { resolveMarketer, resolveSource } = useLookups();

  const [tab,      setTab]      = useState('Overview');
  const [period,   setPeriod]   = useState(30);
  const [division, setDivision] = useState('All');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });

  const { can } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.ADMIN_DATA_TOOLS);

  // Always compute — hooks cannot come after early returns
  const periodFiltered   = useMemo(
    () => {
      if (loading || !isAdmin) return [];
      if (period === 'custom') {
        if (!customRange.from && !customRange.to) return allReferrals;
        return filterByDateRange(allReferrals, customRange.from, customRange.to);
      }
      return filterByPeriod(allReferrals, period);
    },
    [allReferrals, period, customRange, loading, isAdmin],
  );
  const divisionFiltered = useMemo(
    () => (!loading && isAdmin) ? filterByDivision(periodFiltered, division)  : [],
    [periodFiltered, division, loading, isAdmin],
  );

  // ── Guard returns (after all hooks) ──────────────────────────────────────
  if (!appUser) return <LoadingState message="Checking access…" />;

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400 }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: hexToRgba(palette.primaryMagenta.hex, 0.1),
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={palette.primaryMagenta.hex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 8 }}>Admin Access Required</h2>
          <p style={{ fontSize: 13.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.55 }}>
            Data Tools is restricted to administrators. Contact your system admin to request access.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingState message="Loading data…" />;

  return (
    <div style={{
      padding: tab === 'Referral to SOC' ? '28px 40px 64px' : '24px 28px',
      maxWidth: tab === 'Referral to SOC' ? 1720 : tab === 'Processing Overview' ? 1600 : 1280,
      margin: '0 auto',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 750, color: palette.backgroundDark.hex, marginBottom: 3 }}>Data Tools</h1>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Analytics, trends, period comparisons, and exports · {allReferrals.length} total referrals
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Division filter */}
          <div style={{ display: 'flex', gap: 3 }}>
            {['All','ALF','Special Needs'].map((d) => (
              <button key={d} onClick={() => setDivision(d)}
                style={{
                  padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 650,
                  background: division === d ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                  color:      division === d ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                }}>
                {d}
              </button>
            ))}
          </div>
          <PeriodSelector value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
        </div>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'Overview'          && <OverviewTab referrals={divisionFiltered} allReferrals={allReferrals} />}
      {tab === 'Referral to SOC'   && (
        <ReferralToSocView
          referrals={divisionFiltered}
          // Custom range: hand the view pre-filtered rows and disable its own
          // day-window so the explicit From/To bounds are respected.
          allReferrals={period === 'custom' ? periodFiltered : allReferrals}
          period={period === 'custom' ? null : period}
          division={division}
        />
      )}
      {tab === 'Trends'            && <TrendsTab referrals={divisionFiltered} />}
      {tab === 'Sources'           && <SourcesTab referrals={divisionFiltered} resolveMarketer={resolveMarketer} resolveSource={resolveSource} />}
      {tab === 'Period Comparison' && <PeriodComparisonTab allReferrals={allReferrals} />}
      {tab === 'Heatmap'           && (
        <Card>
          <SectionTitle>Referral Activity Heatmap — Last 20 Weeks</SectionTitle>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 16 }}>
            Each cell is one calendar day. Color intensity reflects the number of referrals received.
          </p>
          <CalendarHeatmap referrals={allReferrals} weeks={20} />
        </Card>
      )}
      {tab === 'Processing Overview' && (
        <ProcessingOverviewTab referrals={divisionFiltered} />
      )}
      {tab === 'Data Table' && (
        <DataTableTab referrals={divisionFiltered} resolveMarketer={resolveMarketer} resolveSource={resolveSource} />
      )}
    </div>
  );
}
