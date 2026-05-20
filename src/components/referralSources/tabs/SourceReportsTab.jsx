import { useState, useMemo } from 'react';
import palette, { hexToRgba } from '../../../utils/colors.js';

function SectionTitle({ children, sub }) {
  return (
    <div style={{ margin: '20px 0 10px' }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
        {children}
      </p>
      {sub && <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 3 }}>{sub}</p>}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 11px',
        borderRadius: 6,
        border: 'none',
        fontSize: 11.5,
        fontWeight: 600,
        cursor: 'pointer',
        background: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
        color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
        transition: 'all 0.12s',
      }}
    >
      {children}
    </button>
  );
}

function BreakdownRow({ label, count, total, color }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ padding: '7px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7), maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: color || palette.backgroundDark.hex }}>
          {count}
          <span style={{ fontSize: 11, fontWeight: 400, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginLeft: 6 }}>({pct}%)</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.06), overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color || hexToRgba(palette.backgroundDark.hex, 0.35), borderRadius: 2 }} />
      </div>
    </div>
  );
}

function MonthlyChart({ months }) {
  if (!months.length) {
    return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', padding: '12px 0' }}>No dated referrals yet.</p>;
  }
  const peak = Math.max(1, ...months.map((m) => m.total));
  const formatLabel = (key) => {
    const [y, mo] = key.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
        {months.map((m) => {
          const h = Math.max(2, Math.round((m.total / peak) * 100));
          const aH = m.total ? Math.max(0, Math.round((m.admitted / peak) * 100)) : 0;
          return (
            <div key={m.key} title={`${formatLabel(m.key)} · ${m.total} referrals, ${m.admitted} admitted`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative' }}>
                <div style={{ width: '100%', height: `${h}%`, background: hexToRgba(palette.primaryMagenta.hex, 0.25), borderRadius: '3px 3px 0 0', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, (aH / Math.max(1, h)) * 100)}%`, background: palette.accentGreen.hex }} />
                </div>
              </div>
              <p style={{ fontSize: 9.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4, whiteSpace: 'nowrap' }}>{formatLabel(m.key)}</p>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: hexToRgba(palette.primaryMagenta.hex, 0.25) }} /> Referrals
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: palette.accentGreen.hex }} /> Admissions
        </span>
      </div>
    </div>
  );
}

function toCsv(rows, headers) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.map((h) => h.label).join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => escape(h.get(r))).join(',')));
  return lines.join('\n');
}

function downloadFile(name, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export default function SourceReportsTab({ source, referrals }) {
  const [range, setRange] = useState('all');     // 30 / 90 / 365 / all
  const [division, setDivision] = useState('all'); // all / ALF / Special Needs

  const filtered = useMemo(() => {
    let list = referrals;
    if (range !== 'all') {
      const cutoff = Date.now() - Number(range) * 86400000;
      list = list.filter((r) => r.referral_date && new Date(r.referral_date).getTime() >= cutoff);
    }
    if (division !== 'all') {
      list = list.filter((r) => r.division === division);
    }
    return list;
  }, [referrals, range, division]);

  const summary = useMemo(() => {
    const total    = filtered.length;
    const admitted = filtered.filter((r) => r.current_stage === 'SOC Completed').length;
    const ntuc     = filtered.filter((r) => r.current_stage === 'NTUC').length;
    const active   = total - admitted - ntuc;
    return {
      total, admitted, ntuc, active,
      convRate: total ? Math.round((admitted / total) * 100) : 0,
      ntucRate: total ? Math.round((ntuc / total) * 100) : 0,
    };
  }, [filtered]);

  const insuranceBreakdown = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      const k = r.insurance_plan || 'Unknown';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 8);
  }, [filtered]);

  const countyBreakdown = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      const k = r.patient_county || 'Unknown';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 6);
  }, [filtered]);

  const monthly = useMemo(() => {
    const buckets = {};
    filtered.forEach((r) => {
      if (!r.referral_date) return;
      const d = new Date(r.referral_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = { key, total: 0, admitted: 0, ntuc: 0 };
      buckets[key].total++;
      if (r.current_stage === 'SOC Completed') buckets[key].admitted++;
      if (r.current_stage === 'NTUC') buckets[key].ntuc++;
    });
    const max = range === 'all' ? 12 : range === '365' ? 12 : range === '90' ? 4 : 2;
    return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-max);
  }, [filtered, range]);

  function exportReport() {
    const headers = [
      { label: 'patient_id',     get: (r) => r.patient_id },
      { label: 'patient_name',   get: (r) => r.patientName },
      { label: 'division',       get: (r) => r.division },
      { label: 'current_stage',  get: (r) => r.current_stage },
      { label: 'insurance_plan', get: (r) => r.insurance_plan },
      { label: 'county',         get: (r) => r.patient_county },
      { label: 'referral_date',  get: (r) => r.referral_date },
      { label: 'f2f_urgency',    get: (r) => r.f2f_urgency },
      { label: 'priority',       get: (r) => r.priority },
      { label: 'ntuc_reason',    get: (r) => r.ntuc_reason },
    ];
    const slug = (source.name || 'source').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    downloadFile(`referral_source_${slug}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filtered, headers));
  }

  return (
    <div style={{ padding: '18px 22px 28px' }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 6 }}>Date range</p>
          <div style={{ display: 'flex', gap: 5 }}>
            <FilterChip active={range === '30'}  onClick={() => setRange('30')}>30d</FilterChip>
            <FilterChip active={range === '90'}  onClick={() => setRange('90')}>90d</FilterChip>
            <FilterChip active={range === '365'} onClick={() => setRange('365')}>1y</FilterChip>
            <FilterChip active={range === 'all'} onClick={() => setRange('all')}>All time</FilterChip>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 6 }}>Division</p>
          <div style={{ display: 'flex', gap: 5 }}>
            <FilterChip active={division === 'all'}            onClick={() => setDivision('all')}>All</FilterChip>
            <FilterChip active={division === 'ALF'}            onClick={() => setDivision('ALF')}>ALF</FilterChip>
            <FilterChip active={division === 'Special Needs'}  onClick={() => setDivision('Special Needs')}>Special Needs</FilterChip>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={exportReport}
          disabled={!filtered.length}
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 7,
            background: filtered.length ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
            border: 'none',
            fontSize: 12,
            fontWeight: 650,
            color: filtered.length ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.35),
            cursor: filtered.length ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export CSV
        </button>
      </div>

      {/* Summary KPIs */}
      <SectionTitle>Snapshot</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <Kpi label="Referrals"   value={summary.total}    color={palette.primaryMagenta.hex} />
        <Kpi label="Admitted"    value={summary.admitted} color={palette.accentGreen.hex} sub={`${summary.convRate}% conv.`} />
        <Kpi label="Active"      value={summary.active}   color={palette.accentBlue.hex} />
        <Kpi label="NTUC"        value={summary.ntuc}     color={hexToRgba(palette.backgroundDark.hex, 0.5)} sub={`${summary.ntucRate}% ntuc`} />
      </div>

      <SectionTitle sub="Monthly volume with admission overlay">Trend</SectionTitle>
      <MonthlyChart months={monthly} />

      <SectionTitle>Insurance plans</SectionTitle>
      {insuranceBreakdown.length === 0 ? (
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No insurance data in range.</p>
      ) : insuranceBreakdown.map(([plan, count]) => (
        <BreakdownRow key={plan} label={plan} count={count} total={summary.total} color={palette.accentBlue.hex} />
      ))}

      {countyBreakdown.some(([k]) => k !== 'Unknown') && (
        <>
          <SectionTitle>Top counties</SectionTitle>
          {countyBreakdown.map(([county, count]) => (
            <BreakdownRow key={county} label={county} count={count} total={summary.total} color={palette.primaryDeepPlum.hex} />
          ))}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ padding: '13px 14px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), textAlign: 'center' }}>
      <p style={{ fontSize: 24, fontWeight: 800, color: color || palette.backgroundDark.hex, lineHeight: 1, marginBottom: 4 }}>{value}</p>
      <p style={{ fontSize: 10.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{label}</p>
      {sub && <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 2 }}>{sub}</p>}
    </div>
  );
}
