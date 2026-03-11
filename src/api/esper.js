// In development, requests go through Vite's proxy (/esper-proxy → ricct-api.esper.cloud)
// In production, use the direct URL (requires a server-side proxy or Worker)
const BASE = import.meta.env.DEV
  ? '/esper-proxy/api'
  : import.meta.env.VITE_ESPER_BASE;
const KEY  = import.meta.env.VITE_ESPER_API_KEY;
const EID  = import.meta.env.VITE_ESPER_ENTERPRISE_ID;

const DISCIPLINES = ['PT','OT','PTA','OTA','RN','LPN','HHA','SLP','ST','ABA','LCSW','MSW','NP','PA','MD','CHHA','OTR','CNA'];

function parseTags(tags) {
  const safeTags = Array.isArray(tags) ? tags : [];
  let name = '', discipline = '', workerId = '', zip = '';
  for (const tag of safeTags) {
    const t = (tag || '').trim();
    if (!t) continue;
    // A zip tag would be exactly 5 digits AND labelled "zip:" prefix, or we could detect it if a 6th tag is added
    // Currently known tags: Name, Discipline, Worker ID (5-digit number)
    // Future: add a "zip:XXXXX" tag in Esper for home base zip
    if (t.toLowerCase().startsWith('zip:')) { zip = t.slice(4).trim(); continue; }
    if (/^\d{5}$/.test(t)) { workerId = t; continue; }   // 5-digit = worker ID
    if (DISCIPLINES.includes(t.toUpperCase())) { discipline = t.toUpperCase(); continue; }
    if (/^[A-Za-z\s'-]+$/.test(t) && t.length > 1) { name = t; continue; }
    if (!workerId) workerId = t; // fallback: anything else could be worker ID
  }
  return { name, discipline, workerId, zip };
}

// Fetch all device location records — lat/lon keyed by device ID
export async function getDeviceLocations() {
  const locationMap = {}; // device_id → { lat, lon, lastSeen }
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${BASE}/v1/enterprise/${EID}/report/location/?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!res.ok) break;
    const data = await res.json();

    for (const loc of data.results || []) {
      if (!loc.latitude || !loc.longitude) continue;
      // Extract device ID from the device URL
      const match = (loc.device || '').match(/device\/([^/]+)\//);
      if (!match) continue;
      const deviceId = match[1];
      // Keep the most recent entry per device
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
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
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
        zip,          // populated if a "zip:XXXXX" tag is added in Esper
        online: dev.status === 1,
      });
    }

    const fetched = (data.results || []).length;
    offset += fetched;
    hasMore = !!data.next && fetched === limit;
  }
  return all;
}
