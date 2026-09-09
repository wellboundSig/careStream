import { useState } from 'react';
import { useCareStore, mergeEntities, updateEntity } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  APP_SETTING_KEYS,
  resolveClinicalPreCheckRequirements,
} from '../../data/appSettings.js';
import { createAppSetting, updateAppSetting } from '../../api/appSettings.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        background: checked ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.18),
        transition: 'background 0.2s',
        flexShrink: 0,
        padding: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: palette.backgroundLight.hex,
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  );
}

function SettingRow({ label, hint, last, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '14px 0',
        borderBottom: last ? 'none' : '1px solid var(--color-border)',
      }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, margin: 0 }}>{label}</p>
        {hint && (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '3px 0 0', lineHeight: 1.4 }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export default function LeadViabilitySettings() {
  const { can } = usePermissions();
  const { appUser } = useCurrentAppUser();
  const appSettings = useCareStore((s) => s.appSettings);
  const requirements = resolveClinicalPreCheckRequirements(appSettings);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  if (!can(PERMISSION_KEYS.ADMIN_SETTINGS)) {
    return <AccessDenied message="You need Global Configuration permission to change lead viability settings." />;
  }

  async function setFlag(settingKey, next) {
    if (saving) return;
    setError(null);
    const value = next ? 'true' : 'false';
    const now = new Date().toISOString();
    const actorId = appUser?.id || '';
    const existing = Object.values(appSettings || {}).find((row) => row.key === settingKey);
    setSaving(settingKey);
    try {
      if (existing?._id) {
        const prev = existing.value;
        updateEntity('appSettings', existing._id, { value, updated_at: now, updated_by_id: actorId });
        try {
          await updateAppSetting(existing._id, { value, updated_at: now, updated_by_id: actorId });
        } catch (err) {
          updateEntity('appSettings', existing._id, { value: prev });
          throw err;
        }
      } else {
        const fields = {
          id: `setting_${settingKey}`,
          key: settingKey,
          value,
          updated_by_id: actorId,
          created_at: now,
          updated_at: now,
        };
        const rec = await createAppSetting(fields);
        mergeEntities('appSettings', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
    } catch (err) {
      console.error('[LeadViabilitySettings] save failed:', err);
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px' }}>
        Require clinical pre-check to mark lead viability
      </h2>
      <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '0 0 18px', lineHeight: 1.45 }}>
        When on, new leads in that division start in Clinical Lead Pre-Check (Clinical Review + Leads) until Clinical marks them viable.
        When off, they go straight to Lead Entry. Special Needs without Code 95 still starts in OPWDD Enrollment either way.
      </p>

      <div
        style={{
          background: palette.backgroundLight.hex,
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '4px 22px 8px',
        }}
      >
        <SettingRow
          label="ALF"
          hint="Adult Living Facilities. Default: on."
        >
          <Toggle
            checked={requirements.alf}
            disabled={saving === APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_ALF}
            onChange={() => setFlag(APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_ALF, !requirements.alf)}
          />
        </SettingRow>
        <SettingRow
          label="Special Needs"
          hint="Default: off. Leads go to Lead Entry unless this is turned on."
          last
        >
          <Toggle
            checked={requirements.sn}
            disabled={saving === APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_SN}
            onChange={() => setFlag(APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_SN, !requirements.sn)}
          />
        </SettingRow>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: palette.primaryMagenta.hex, marginTop: 14 }}>
          {error}
        </p>
      )}
    </div>
  );
}
