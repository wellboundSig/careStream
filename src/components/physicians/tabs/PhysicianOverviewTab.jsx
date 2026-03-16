import { useState, useEffect } from 'react';
import { updatePhysician } from '../../../api/physicians.js';
import { updatePhysicianInCache } from '../../../hooks/usePhysicians.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: color || (value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.3)) }}>{value || '—'}</span>
    </div>
  );
}

function StatusPill({ enrolled, label }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: enrolled ? hexToRgba(palette.accentGreen.hex, 0.15) : hexToRgba(palette.primaryMagenta.hex, 0.1), color: enrolled ? palette.accentGreen.hex : palette.primaryMagenta.hex }}>
      {label}: {enrolled ? 'Enrolled' : 'Not Enrolled'}
    </span>
  );
}

function TinyBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '3px 9px',
        borderRadius: 6,
        border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
        background: 'transparent',
        fontSize: 11,
        fontWeight: 600,
        color: hexToRgba(palette.backgroundDark.hex, 0.5),
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
      }}
    >
      {children}
    </button>
  );
}

export default function PhysicianOverviewTab({ physician, onUpdated }) {
  const [local, setLocal] = useState(() => physician ? {
    is_pecos_enrolled:  physician.is_pecos_enrolled === true || physician.is_pecos_enrolled === 'true',
    is_opra_enrolled:   physician.is_opra_enrolled  === true || physician.is_opra_enrolled  === 'true',
    pecos_last_checked: physician.pecos_last_checked || null,
  } : { is_pecos_enrolled: false, is_opra_enrolled: false, pecos_last_checked: null });
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!physician) return;
    setLocal({
      is_pecos_enrolled:  physician.is_pecos_enrolled === true || physician.is_pecos_enrolled === 'true',
      is_opra_enrolled:   physician.is_opra_enrolled  === true || physician.is_opra_enrolled  === 'true',
      pecos_last_checked: physician.pecos_last_checked || null,
    });
  }, [physician?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!physician) return null;

  const addr = [physician.address_street, physician.address_city, physician.address_state, physician.address_zip]
    .filter(Boolean).join(', ');

  const pecosCheckedDisplay = local.pecos_last_checked
    ? new Date(local.pecos_last_checked).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  async function toggle(field, key) {
    const next = !local[field];
    setSaving(key);
    setSaveError(null);
    try {
      // Airtable checkbox fields: send `true` to check, `null` to uncheck.
      // Sending `false` is silently ignored by Airtable for checkbox type fields.
      const airtableValue = next ? true : null;
      await updatePhysician(physician._id, { [field]: airtableValue });
      // Patch local tab state and drawer header
      setLocal((prev) => ({ ...prev, [field]: next }));
      onUpdated?.({ [field]: next });
      // Patch the shared in-memory + sessionStorage cache so the Physicians list
      // page reflects the change without a full 3000-record re-fetch.
      updatePhysicianInCache(physician._id, { [field]: airtableValue });
    } catch (err) {
      setSaveError(`Failed to update ${key.toUpperCase()} status.`);
      console.error('updatePhysician error:', err);
    } finally {
      setSaving(null);
    }
  }

  async function markPecosCheckedToday() {
    const today = new Date().toISOString().split('T')[0];
    setSaving('checked');
    setSaveError(null);
    try {
      await updatePhysician(physician._id, { pecos_last_checked: today });
      setLocal((prev) => ({ ...prev, pecos_last_checked: today }));
      onUpdated?.({ pecos_last_checked: today });
    } catch {
      setSaveError('Failed to update PECOS last checked date.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ padding: '20px 22px 40px' }}>

      {/* ── Enrollment pills (display) ────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatusPill enrolled={local.is_pecos_enrolled} label="PECOS" />
        <StatusPill enrolled={local.is_opra_enrolled}  label="OPRA"  />
      </div>

      {/* ── Contact details ───────────────────────────────── */}
      <Row label="NPI"     value={physician.npi?.toString()} />
      <Row label="Phone"   value={physician.phone} />
      <Row label="Fax"     value={physician.fax} />
      <Row label="Address" value={addr || null} />
      {physician.facility_id && <Row label="Affiliated Facility" value={physician.facility_id} />}

      {/* ── Enrollment edit ───────────────────────────────── */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}` }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.3), marginBottom: 10 }}>
          Update Enrollment
        </p>

        {/* PECOS row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
          <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>PECOS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {pecosCheckedDisplay && (
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>
                checked {pecosCheckedDisplay}
              </span>
            )}
            <TinyBtn onClick={markPecosCheckedToday} disabled={saving === 'checked'}>
              {saving === 'checked' ? 'Saving…' : 'Mark checked today'}
            </TinyBtn>
            <TinyBtn onClick={() => toggle('is_pecos_enrolled', 'pecos')} disabled={saving === 'pecos'}>
              {saving === 'pecos' ? 'Saving…' : local.is_pecos_enrolled ? 'Mark not enrolled' : 'Mark enrolled'}
            </TinyBtn>
          </div>
        </div>

        {/* OPRA row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' }}>
          <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>OPRA</span>
          <TinyBtn onClick={() => toggle('is_opra_enrolled', 'opra')} disabled={saving === 'opra'}>
            {saving === 'opra' ? 'Saving…' : local.is_opra_enrolled ? 'Mark not enrolled' : 'Mark enrolled'}
          </TinyBtn>
        </div>

        {saveError && (
          <p style={{ fontSize: 11.5, color: palette.primaryMagenta.hex, marginTop: 8 }}>{saveError}</p>
        )}
      </div>
    </div>
  );
}
