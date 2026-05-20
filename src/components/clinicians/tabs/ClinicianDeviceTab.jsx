import InfoRow, { SectionTitle } from './InfoRow.jsx';
import { modelLabel, osLabel, fmtBytes, fmtMemoryKb, pluggedLabel } from '../../../utils/clinicianInfo.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function BatteryBar({ level, plugged }) {
  if (level == null) {
    return <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>Battery level not reported.</p>;
  }
  const color = level <= 15 ? palette.primaryMagenta.hex : level <= 35 ? palette.accentOrange.hex : palette.accentGreen.hex;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6) }}>
          {level}% charged
          {plugged && plugged !== 'Unplugged' && (
            <span style={{ color: palette.accentGreen.hex, marginLeft: 6 }}>· charging ({plugged})</span>
          )}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 650, color }}>
          {level <= 15 ? 'Low' : level <= 35 ? 'Caution' : 'OK'}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${level}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

export default function ClinicianDeviceTab({ clinician }) {
  const d = clinician.device || {};
  const hw = d.hardware || {};
  const sw = d.software || {};
  const power = d.power || {};

  return (
    <div style={{ padding: '20px 22px' }}>
      <SectionTitle>Power</SectionTitle>
      <BatteryBar level={power.batteryLevel} plugged={pluggedLabel(power.pluggedState)} />

      <SectionTitle>Hardware</SectionTitle>
      <InfoRow label="Model" value={modelLabel(hw)} />
      <InfoRow label="Manufacturer" value={hw.manufacturer} />
      <InfoRow label="Brand" value={hw.brand} />
      <InfoRow label="Serial number" value={hw.serial} mono copyable />
      <InfoRow label="IMEI" value={hw.imei} mono copyable />
      {hw.imei2 && <InfoRow label="IMEI (2)" value={hw.imei2} mono copyable />}
      <InfoRow label="Storage" value={fmtBytes(hw.storageBytes)} />
      <InfoRow label="Memory" value={fmtMemoryKb(hw.memoryKb)} />

      <SectionTitle>Software</SectionTitle>
      <InfoRow label="OS" value={osLabel(sw)} />
      <InfoRow label="API level" value={sw.apiLevel} />
      <InfoRow label="Build number" value={sw.buildNumber} mono />
      <InfoRow label="Kernel" value={sw.kernelVersion} mono />
      <InfoRow label="Security patch" value={sw.securityPatch} />
      <InfoRow label="Bootloader" value={sw.bootloader} mono />

      {(d.policy?.name || d.groups?.length > 0) && (
        <>
          <SectionTitle>Policy &amp; groups</SectionTitle>
          <InfoRow label="Policy" value={d.policy?.name} />
          <InfoRow label="Compliance" value={d.policy?.complianceState} />
          {d.groups?.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {d.groups.map((g) => (
                  <span key={g} style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 12, background: hexToRgba(palette.primaryDeepPlum.hex, 0.08), color: palette.primaryDeepPlum.hex }}>
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
