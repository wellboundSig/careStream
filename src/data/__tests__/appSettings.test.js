import { describe, it, expect } from 'vitest';
import {
  APP_SETTING_KEYS,
  DEFAULT_CLINICAL_PRECHECK,
  parseSettingFlag,
  resolveClinicalPreCheckRequirements,
  requiresClinicalPreCheck,
} from '../appSettings.js';
import { PERMISSION_KEYS, GLOBAL_CONFIGURATION_PERMISSIONS } from '../permissionKeys.js';

describe('clinical pre-check setting defaults', () => {
  it('defaults ALF on and Special Needs off', () => {
    expect(DEFAULT_CLINICAL_PRECHECK).toEqual({ alf: true, sn: false });
    expect(resolveClinicalPreCheckRequirements({})).toEqual({ alf: true, sn: false });
    expect(requiresClinicalPreCheck('ALF')).toBe(true);
    expect(requiresClinicalPreCheck('Special Needs')).toBe(false);
  });

  it('reads stored text flags without treating omitted false as default-on', () => {
    const settings = {
      a: { key: APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_ALF, value: 'false' },
      b: { key: APP_SETTING_KEYS.REQUIRE_CLINICAL_PRECHECK_SN, value: 'true' },
    };
    expect(resolveClinicalPreCheckRequirements(settings)).toEqual({ alf: false, sn: true });
    expect(requiresClinicalPreCheck('ALF', { alf: false, sn: true })).toBe(false);
    expect(requiresClinicalPreCheck('Special Needs', { alf: false, sn: true })).toBe(true);
  });

  it('parses true/false text, booleans, and unknown as fallback', () => {
    expect(parseSettingFlag('true', false)).toBe(true);
    expect(parseSettingFlag('false', true)).toBe(false);
    expect(parseSettingFlag(undefined, true)).toBe(true);
    expect(parseSettingFlag('', false)).toBe(false);
  });
});

describe('global configuration permissions', () => {
  it('shows Configuration for any of the existing child-page keys', () => {
    expect(GLOBAL_CONFIGURATION_PERMISSIONS).toEqual([
      PERMISSION_KEYS.ADMIN_SETTINGS,
      PERMISSION_KEYS.ADMIN_PERMISSIONS,
      PERMISSION_KEYS.CONFLICT_MANAGE_CATEGORIES,
      PERMISSION_KEYS.ADMIN_DEPARTMENTS,
    ]);
  });

  it('sidebar consolidates the three admin pages under Configuration', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../components/layout/Sidebar.jsx'),
      'utf-8',
    );
    expect(content).toContain("label: 'Configuration'");
    expect(content).toContain("path: '/admin/configuration'");
    expect(content).not.toContain("path: '/admin/permissions'");
    expect(content).not.toContain("path: '/admin/departments'");
    expect(content).not.toContain("path: '/admin/conflict-categories'");
  });
});
