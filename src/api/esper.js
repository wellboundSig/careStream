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

// Esper returns a deeply nested device object. Field shape varies between
// device generations / API versions, so every lookup is null-safe: anything
// the API doesn't populate is simply left undefined and rendered as "—" in
// the UI.
function pickDeviceInfo(dev) {
  const hw = dev.hardware_info || dev.hardwareInfo || {};
  const sw = dev.software_info || dev.softwareInfo || {};
  const net = dev.network_info  || dev.networkInfo  || {};
  const state = dev.device_state || dev.deviceState || dev.device_status || {};
  const policy = dev.current_device_policy || dev.policy_compliance || {};
  const groups = Array.isArray(dev.groups) ? dev.groups : [];

  // Battery + plugged state can appear in several shapes depending on plan.
  const battery = state.battery_level
    ?? state.batteryLevel
    ?? dev.battery_level
    ?? dev.batteryLevel
    ?? null;
  const plugged = state.plugged_state
    ?? state.pluggedState
    ?? dev.plugged_state
    ?? dev.pluggedState
    ?? null;

  return {
    deviceName:   dev.device_name || dev.alias_name || dev.deviceName || dev.id,
    aliasName:    dev.alias_name || dev.aliasName || '',
    state:        dev.state || dev.device_state_string || null,
    statusCode:   dev.status ?? null,
    isActive:     dev.is_active ?? dev.isActive ?? null,
    enrollmentTime: dev.enrollment_time || dev.enrollmentTime || dev.provisioned_on || null,
    lastSeen:     dev.last_seen || dev.lastSeen || dev.last_connect_event_time || null,
    suid:         dev.suid || null,

    hardware: {
      model:        hw.model || dev.model || null,
      brand:        hw.brand || dev.brand || null,
      manufacturer: hw.manufacturer || dev.manufacturer || null,
      serial:       hw.serial_number || hw.serialNumber || dev.serial_number || null,
      imei:         hw.imei || hw.imei1 || dev.imei || null,
      imei2:        hw.imei2 || null,
      memoryKb:     hw.total_memory_kb || hw.totalMemoryKb || dev.total_memory_kb || null,
      storageBytes: hw.total_internal_storage || hw.total_storage || dev.total_storage || null,
    },
    software: {
      osVersion:    sw.os_version || sw.osVersion || dev.os_version || null,
      androidVersion: sw.android_version || sw.androidVersion || null,
      apiLevel:     sw.api_level ?? sw.apiLevel ?? dev.api_level ?? null,
      buildNumber:  sw.build_number || sw.buildNumber || dev.build_number || null,
      kernelVersion: sw.kernel_version || sw.kernelVersion || null,
      securityPatch: sw.security_patch_level || sw.securityPatchLevel || null,
      bootloader:   sw.bootloader || null,
    },
    network: {
      ipAddress:    net.ip_address || net.ipAddress || dev.ip_address || null,
      macAddress:   net.network_mac_address || net.mac_address || net.macAddress || dev.mac_address || null,
      wifiSsid:     net.wifi_ssid || net.wifiSsid || null,
      signal:       net.signal_strength ?? net.signalStrength ?? null,
      carrier:      net.carrier || net.network_operator || null,
      type:         net.network_type || net.networkType || null,
    },
    power: {
      batteryLevel: battery !== null ? Number(battery) : null,
      pluggedState: plugged,
    },
    policy: {
      name:         policy.name || dev.policy_name || null,
      complianceState: policy.compliance_state || policy.complianceState || null,
    },
    groups:         groups.map((g) => g.name || g),
    country:        dev.country || null,
    locale:         dev.locale || null,
    timezone:       dev.timezone || null,
  };
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
      const device = pickDeviceInfo(dev);
      all.push({
        id: dev.id,
        deviceName: device.deviceName,
        name,
        discipline,
        workerId,
        zip,
        online: dev.status === 1,
        tags: Array.isArray(dev.tags) ? [...dev.tags] : [],
        device,
      });
    }

    const fetched = (data.results || []).length;
    offset += fetched;
    hasMore = !!data.next && fetched === limit;
  }
  return all;
}
