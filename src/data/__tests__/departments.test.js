import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_CATEGORIES } from '../permissionKeys.js';

describe('Department permission keys', () => {
  it('defines ADMIN_DEPARTMENTS', () => {
    expect(PERMISSION_KEYS.ADMIN_DEPARTMENTS).toBe('admin.departments');
  });

  it('has a catalog entry for ADMIN_DEPARTMENTS', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.ADMIN_DEPARTMENTS);
    expect(entry).toBeTruthy();
    expect(entry.category).toBe('Departments');
  });

  it('has "Departments" in PERMISSION_CATEGORIES', () => {
    expect(PERMISSION_CATEGORIES).toContain('Departments');
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
