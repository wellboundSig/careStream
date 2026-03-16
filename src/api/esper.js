// In development, requests go through Vite's proxy (/esper-proxy → ricct-api.esper.cloud)
// In production, requests go through the Cloudflare Worker (VITE_ESPER_BASE = worker URL)
// The worker handles auth — no API key is sent from the browser.
const BASE = import.meta.env.DEV
  ? '/esper-proxy/api'
  : import.meta.env.VITE_ESPER_BASE;

const EID = import.meta.env.VITE_ESPER_ENTERPRISE_ID;

const DISCIPLINES = ['PT','OT','PTA','OTA','RN','LPN','HHA','SLP','ST','ABA','LCSW','MSW','NP','PA','MD','CHHA','OTR','CNA'];

function parseTags(tags) {
  const safeTags = Array.isArray(tags) ? tags : [];
  let name = '', discipline = '', workerId = '', zip = '';
  for (const tag of safeTags) {
    const t = (tag || '').trim();
    if (!t) continue;
    if (t.toLowerCase().startsWith('zip:')) { zip = t.slice(4).trim(); continue; }
    if (/^\d{5}$/.test(t)) { workerId = t; continue; }
    if (DISCIPLINES.includes(t.toUpperCase())) { discipline = t.toUpperCase(); continue; }
    if (/^[A-Za-z\s'-]+$/.test(t) && t.length > 1) { name = t; continue; }
    if (!workerId) workerId = t;
  }
  return { name, discipline, workerId, zip };
}

// Dev uses the Vite proxy (which adds no auth header — Esper allows this in dev).
// Prod uses the worker (which adds the Bearer token server-side).
function fetchHeaders() {
  if (import.meta.env.DEV) {
    const key = import.meta.env.VITE_ESPER_API_KEY;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }
  return {};
}

export async function getDeviceLocations() {
  const locationMap = {};
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${BASE}/v1/enterprise/${EID}/report/location/?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: fetchHeaders() });
    if (!res.ok) break;
    const data = await res.json();

    for (const loc of data.results || []) {
      if (!loc.latitude || !loc.longitude) continue;
      const match = (loc.device || '').match(/device\/([^/]+)\//);
      if (!match) continue;
      const deviceId = match[1];
      if (!locationMap[deviceId] || new Date(loc.last_updated_on) > new Date(locationMap[deviceId].lastSeen)) {
        locationMap[deviceId] = {
          lat: parseFloat(loc.latitude),
          lon: parseFloat(loc.longitude),
          lastSeen: loc.last_updated_on,
        };
      }
    }

    const fetched = (data.results || []).length;
    offset += fetched;
    hasMore = !!data.next && fetched === limit;
  }
  return locationMap;
}

export async function getEsperClinicians() {
  const all = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${BASE}/enterprise/${EID}/device/?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: fetchHeaders() });
    if (!res.ok) throw new Error(`Esper API ${res.status}`);
    const data = await res.json();

    for (const dev of data.results || []) {
      const { name, discipline, workerId, zip } = parseTags(dev.tags);
      if (!name) continue;
      all.push({
        id: dev.id,
        deviceName: dev.device_name || dev.alias_name || dev.id,
        name,
        discipline,
        workerId,
        zip,
        online: dev.status === 1,
      });
    }

    const fetched = (data.results || []).length;
    offset += fetched;
    hasMore = !!data.next && fetched === limit;
  }
  return all;
}
