// Shared formatters for Esper-sourced clinician data. Pulled out so the page,
// drawer, and tab components all render the same way.

export function titleCase(str) {
  if (!str) return '';
  return String(str).toLowerCase().split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function initials(name = '') {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

const TIME_BUCKETS = [
  { sec: 60,            label: 'just now',     div: 1 },
  { sec: 60 * 60,       label: 'min',          div: 60 },
  { sec: 60 * 60 * 24,  label: 'hr',           div: 3600 },
  { sec: 60 * 60 * 24 * 30, label: 'd',         div: 86400 },
  { sec: 60 * 60 * 24 * 365, label: 'mo',       div: 60 * 60 * 24 * 30 },
];

export function timeAgo(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const diff = Math.max(0, (Date.now() - ms) / 1000);
  if (diff < 30) return 'just now';
  for (const b of TIME_BUCKETS) {
    if (diff < b.sec) {
      const n = Math.floor(diff / b.div);
      if (b.label === 'just now') return 'just now';
      return `${n} ${b.label}${n === 1 || b.label === 'just now' ? '' : ''} ago`;
    }
  }
  const years = Math.floor(diff / (60 * 60 * 24 * 365));
  return `${years}y ago`;
}

export function fmtDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtBytes(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return null;
  const n = Number(bytes);
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

export function fmtMemoryKb(kb) {
  if (kb == null) return null;
  return fmtBytes(Number(kb) * 1024);
}

export function fmtCoords(loc) {
  if (!loc?.lat || !loc?.lon) return null;
  return `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`;
}

export function googleMapsUrl(loc) {
  if (!loc?.lat || !loc?.lon) return null;
  return `https://www.google.com/maps?q=${loc.lat},${loc.lon}`;
}

// Esper "plugged" state strings vary slightly by SDK version. Surface a
// human-readable label.
export function pluggedLabel(plugged) {
  if (!plugged) return null;
  const s = String(plugged).toLowerCase();
  if (s.includes('ac') || s === '1')      return 'AC';
  if (s.includes('usb') || s === '2')     return 'USB';
  if (s.includes('wireless') || s === '4') return 'Wireless';
  if (s.includes('unplugged') || s === '0' || s === 'discharging') return 'Unplugged';
  return String(plugged);
}

export function osLabel(software) {
  if (!software) return null;
  if (software.androidVersion && software.osVersion) {
    return `Android ${software.androidVersion} (${software.osVersion})`;
  }
  return software.androidVersion ? `Android ${software.androidVersion}` : software.osVersion || null;
}

export function modelLabel(hardware) {
  if (!hardware) return null;
  const brand = hardware.brand || hardware.manufacturer;
  if (brand && hardware.model) return `${titleCase(brand)} ${hardware.model}`;
  return hardware.model || brand || null;
}
