import InfoRow, { SectionTitle } from './InfoRow.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function signalLabel(n) {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (v >= -55) return `${v} dBm (excellent)`;
  if (v >= -70) return `${v} dBm (good)`;
  if (v >= -85) return `${v} dBm (fair)`;
  return `${v} dBm (weak)`;
}

export default function ClinicianNetworkTab({ clinician }) {
  const net = clinician.device?.network || {};
  const hasAny = !!(net.ipAddress || net.macAddress || net.wifiSsid || net.signal || net.carrier || net.type);

  return (
    <div style={{ padding: '20px 22px' }}>
      <SectionTitle>Connectivity</SectionTitle>
      {!hasAny && (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', padding: '12px 0 4px' }}>
          No network info reported by this device.
        </p>
      )}
      <InfoRow label="IP address" value={net.ipAddress} mono copyable />
      <InfoRow label="MAC address" value={net.macAddress} mono copyable />
      <InfoRow label="Network type" value={net.type} />
      <InfoRow label="Wi-Fi SSID" value={net.wifiSsid} />
      <InfoRow label="Signal strength" value={signalLabel(net.signal)} />
      <InfoRow label="Carrier" value={net.carrier} />
    </div>
  );
}
