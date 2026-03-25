import { describe, it, expect } from 'vitest';
import {
  CLINICAL_CHECKLIST,
  ALL_CHECKLIST_ITEMS,
  REQUIRED_ITEMS,
  isChecklistComplete,
  CLINICAL_DECISIONS,
} from '../clinicalChecklist.js';
import { PERMISSION_KEYS, PERMISSION_CATALOG } from '../permissionKeys.js';

describe('Clinical checklist config', () => {
  it('has multiple sections', () => {
    expect(CLINICAL_CHECKLIST.length).toBeGreaterThanOrEqual(6);
  });

  it('every section has a name and items array', () => {
    CLINICAL_CHECKLIST.forEach((g) => {
      expect(typeof g.section).toBe('string');
      expect(Array.isArray(g.items)).toBe(true);
      expect(g.items.length).toBeGreaterThan(0);
    });
  });

  it('every item has a unique key', () => {
    const keys = ALL_CHECKLIST_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has required items that must be completed', () => {
    expect(REQUIRED_ITEMS.length).toBeGreaterThan(0);
  });

  it('includes Clinical Appropriateness section', () => {
    expect(CLINICAL_CHECKLIST.find((g) => g.section === 'Clinical Appropriateness')).toBeTruthy();
  });

  it('includes SOC Planning section', () => {
    expect(CLINICAL_CHECKLIST.find((g) => g.section === 'SOC Planning')).toBeTruthy();
  });
});

describe('isChecklistComplete', () => {
  it('returns false with empty checked map', () => {
    expect(isChecklistComplete({})).toBe(false);
  });

  it('returns false when only some required items are checked', () => {
    const partial = {};
    REQUIRED_ITEMS.slice(0, 2).forEach((i) => { partial[i.key] = true; });
    expect(isChecklistComplete(partial)).toBe(false);
  });

  it('returns true when all required items are checked', () => {
    const all = {};
    REQUIRED_ITEMS.forEach((i) => { all[i.key] = true; });
    expect(isChecklistComplete(all)).toBe(true);
  });

  it('ignores non-required items for completion', () => {
    const all = {};
    REQUIRED_ITEMS.forEach((i) => { all[i.key] = true; });
    expect(isChecklistComplete(all)).toBe(true);
  });
});

describe('Clinical decisions', () => {
  it('has 3 decision options', () => {
    expect(CLINICAL_DECISIONS.length).toBe(3);
  });

  it('includes accept, conditional, decline', () => {
    const keys = CLINICAL_DECISIONS.map((d) => d.key);
    expect(keys).toContain('accept');
    expect(keys).toContain('conditional');
    expect(keys).toContain('decline');
  });
});

describe('CLINICAL_APPROVED_SERVICES permission', () => {
  it('exists in PERMISSION_KEYS', () => {
    expect(PERMISSION_KEYS.CLINICAL_APPROVED_SERVICES).toBe('clinical.approved_services');
  });

  it('has a catalog entry', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.CLINICAL_APPROVED_SERVICES);
    expect(entry).toBeTruthy();
    expect(entry.category).toBe('Clinical');
  });
});

describe('PatientDrawer tabs include Clinical Review', () => {
  it('DRAWER_TABS has clinical_review tab', async () => {
    const { DRAWER_TABS } = await import('../../components/patient/PatientDrawer.jsx');
    expect(DRAWER_TABS.find((t) => t.id === 'clinical_review')).toBeTruthy();
    expect(DRAWER_TABS.find((t) => t.id === 'clinical_review').label).toBe('Clinical Review');
  });
});
