/**
 * Shared date-range filter for insights surfaces (directory drawers, Data
 * Tools). Preset chips plus an explicit custom From/To range.
 *
 * The range object is plain-serializable: { preset, from, to }
 *   preset: 'all' | '30' | '90' | '365' | 'custom'
 *   from/to: 'YYYY-MM-DD' (only used when preset === 'custom')
 *
 * Filtering helpers live here too so every surface counts the same way:
 * dates are compared on calendar days, inclusive on both ends, and rows
 * without the date field are excluded when a range is active.
 */
import palette, { hexToRgba } from '../../utils/colors.js';

export const DEFAULT_DATE_RANGE = { preset: 'all', from: '', to: '' };

export const DATE_RANGE_PRESETS = [
  { id: '30', label: '30d' },
  { id: '90', label: '90d' },
  { id: 'qtd', label: 'This qtr' },
  { id: 'lastq', label: 'Last qtr' },
  { id: 'ytd', label: 'YTD' },
  { id: '365', label: '1y' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

function dayStartTs(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function parseRowDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const DAY_MS = 86400000;

/** Calendar-quarter bounds: offset 0 = current quarter, -1 = previous. */
export function quarterBounds(offset = 0, now = new Date()) {
  const qIndex = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), qIndex * 3, 1);
  const end = new Date(now.getFullYear(), (qIndex + 1) * 3, 1).getTime() - 1;
  return { fromTs: start.getTime(), toTs: end };
}

/** Resolve a range object to inclusive [fromTs, toTs] bounds (null = open). */
export function dateRangeBounds(range) {
  if (!range || range.preset === 'all' || !range.preset) return null;
  if (range.preset === 'custom') {
    const fromTs = dayStartTs(range.from);
    const toStart = dayStartTs(range.to);
    if (fromTs == null && toStart == null) return null;
    return { fromTs, toTs: toStart != null ? toStart + DAY_MS - 1 : null };
  }
  if (range.preset === 'qtd') return { ...quarterBounds(0), toTs: null };
  if (range.preset === 'lastq') return quarterBounds(-1);
  if (range.preset === 'ytd') {
    const now = new Date();
    return { fromTs: new Date(now.getFullYear(), 0, 1).getTime(), toTs: null };
  }
  const days = Number(range.preset);
  if (!Number.isFinite(days) || days <= 0) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { fromTs: todayStart - (days - 1) * DAY_MS, toTs: null };
}

/** Filter rows on a calendar date field. No active range = passthrough. */
export function filterByDateRange(rows, range, field = 'referral_date') {
  const bounds = dateRangeBounds(range);
  if (!bounds) return rows;
  return (rows || []).filter((row) => {
    const ts = parseRowDate(row?.[field]);
    if (ts == null) return false;
    if (bounds.fromTs != null && ts < bounds.fromTs) return false;
    if (bounds.toTs != null && ts > bounds.toTs) return false;
    return true;
  });
}

export function isDateRangeActive(range) {
  return dateRangeBounds(range) != null;
}

const chipStyle = (active) => ({
  padding: '3px 10px',
  borderRadius: 20,
  border: 'none',
  fontSize: 11.5,
  fontWeight: 650,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  background: active
    ? hexToRgba(palette.primaryMagenta.hex, 0.16)
    : hexToRgba(palette.backgroundDark.hex, 0.06),
  color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
  transition: 'background 0.15s, color 0.15s',
});

const dateInputStyle = {
  fontSize: 11.5,
  padding: '3px 6px',
  borderRadius: 7,
  border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
  background: palette.backgroundLight.hex,
  color: palette.backgroundDark.hex,
};

/**
 * @param {{ value: object, onChange: function, label?: string, style?: object }} props
 */
export default function DateRangeFilter({ value, onChange, label = 'Date range', style }) {
  const range = value || DEFAULT_DATE_RANGE;
  const setPreset = (preset) => onChange({ ...range, preset });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
        {label}
      </span>
      {DATE_RANGE_PRESETS.map((p) => (
        <button key={p.id} onClick={() => setPreset(p.id)} style={chipStyle(range.preset === p.id)}>
          {p.label}
        </button>
      ))}
      {range.preset === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="date"
            value={range.from || ''}
            max={range.to || undefined}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
            style={dateInputStyle}
            aria-label="From date"
          />
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>to</span>
          <input
            type="date"
            value={range.to || ''}
            min={range.from || undefined}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
            style={dateInputStyle}
            aria-label="To date"
          />
        </span>
      )}
    </div>
  );
}
