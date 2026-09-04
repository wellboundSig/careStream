import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_CATEGORIES, DENY_BY_DEFAULT_PERMISSIONS } from '../permissionKeys.js';

describe('Department permission keys', () => {
  it('defines ADMIN_DEPARTMENTS', () => {
    expect(PERMISSION_KEYS.ADMIN_DEPARTMENTS).toBe('admin.departments');
  });

  it('has a catalog entry for ADMIN_DEPARTMENTS', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.ADMIN_DEPARTMENTS);
    expect(entry).toBeTruthy();
    // Department management now lives under the consolidated Administration group.
    expect(entry.category).toBe('Administration');
  });

  it('has "Administration" in PERMISSION_CATEGORIES', () => {
    expect(PERMISSION_CATEGORIES).toContain('Administration');
  });

  it('hides User Management and Departments unless explicitly granted', () => {
    expect(DENY_BY_DEFAULT_PERMISSIONS.has(PERMISSION_KEYS.ADMIN_USER_MANAGEMENT)).toBe(true);
    expect(DENY_BY_DEFAULT_PERMISSIONS.has(PERMISSION_KEYS.ADMIN_DEPARTMENTS)).toBe(true);
  });

  it('hides Conflict Categories and Developer Tools unless explicitly granted', () => {
    expect(DENY_BY_DEFAULT_PERMISSIONS.has(PERMISSION_KEYS.CONFLICT_MANAGE_CATEGORIES)).toBe(true);
    expect(DENY_BY_DEFAULT_PERMISSIONS.has(PERMISSION_KEYS.DEVELOPER_TOOLS)).toBe(true);
  });
});

describe('Department data model assumptions', () => {
  it('hydration includes departments, departmentScopes, and activityLog tables', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../store/hydrate.js'),
      'utf-8'
    );
    expect(content).toContain("'Departments'");
    expect(content).toContain("'DepartmentScopes'");
    expect(content).toContain("'ActivityLog'");
  });
});
