/**
 * Org-wide AppSettings keys and defaults.
 *
 * Values are stored as text ('true' / 'false') so a false toggle is never
 * dropped by the checkbox wire (omitted empty → fall back to these defaults).
 */

export const APP_SETTING_KEYS = Object.freeze({
  REQUIRE_CLINICAL_PRECHECK_ALF: 'require_clinical_precheck_alf',
  REQUIRE_CLINICAL_PRECHECK_SN: 'require_clinical_precheck_sn',
});

/** Default: ALF on, Special Needs off. */
export const DEFAULT_CLINICAL_PRECHECK = Object.freeze({
  alf: true,
  sn: false,
});

export function parseSettingFlag(value, fallback) {
  if (value === true || value === 'true' || value === 't' || value === 'TRUE' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 'f' || value === 'FALSE' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
}

function settingRow(mapOrList, key) {
  const rows = Array.isArray(mapOrList)
    ? mapOrList
    : Object.values(mapOrList || {});
  return rows.find((r) => r?.key === key) || null;
}

/**
 * @param {Record<string, object>|object[]} [appSettings] store slice
 * @returns {{ alf: boolean, sn: boolean }}
 */
export function resolveClinicalPreCheckRequirements(appSettings) {
  const alfRow = settingRow(appSettings, APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_ALF);
  const snRow = settingRow(appSettings, APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_SN);
  return {
    alf: parseSettingFlag(alfRow?.value, DEFAULT_CLINICAL_PRECHECK.alf),
    sn: parseSettingFlag(snRow?.value, DEFAULT_CLINICAL_PRECHECK.sn),
  };
}

export function requiresClinicalPreCheck(division, requirements = DEFAULT_CLINICAL_PRECHECK) {
  if (division === 'Special Needs') return !!requirements.sn;
  return !!requirements.alf;
}
