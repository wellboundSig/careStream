import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Unit tests for DRAWER_TABS definition (no mocking needed) ───────────────

import { DRAWER_TABS } from '../PatientDrawer.jsx';

describe('DRAWER_TABS definition', () => {
  it('has "Demographics" as the first tab', () => {
    expect(DRAWER_TABS[0].id).toBe('demographics');
    expect(DRAWER_TABS[0].label).toBe('Demographics');
  });

  it('has "Overview" as the second tab (for referral info)', () => {
    expect(DRAWER_TABS[1].id).toBe('overview');
    expect(DRAWER_TABS[1].label).toBe('Overview');
  });

  it('contains 11 tabs total (including Clinical Review)', () => {
    expect(DRAWER_TABS.length).toBe(11);
  });

  it('has all expected tab IDs', () => {
    const ids = DRAWER_TABS.map((t) => t.id);
    expect(ids).toContain('demographics');
    expect(ids).toContain('overview');
    expect(ids).toContain('eligibility');
    expect(ids).toContain('triage');
    expect(ids).toContain('notes');
    expect(ids).toContain('timeline');
    expect(ids).toContain('files');
    expect(ids).toContain('tasks');
    expect(ids).toContain('authorizations');
    expect(ids).toContain('conflicts');
  });

  it('the old "overview" (now demographics) comes before the new "overview"', () => {
    const demoIdx = DRAWER_TABS.findIndex((t) => t.id === 'demographics');
    const overIdx = DRAWER_TABS.findIndex((t) => t.id === 'overview');
    expect(demoIdx).toBeLessThan(overIdx);
  });

  it('does not have any tab still labeled just "Overview" as first tab', () => {
    expect(DRAWER_TABS[0].label).not.toBe('Overview');
  });
});
