import { describe, it, expect, vi } from 'vitest';

import { DRAWER_TABS } from '../PatientDrawer.jsx';

describe('DRAWER_TABS definition', () => {
  it('has "Referral" as the first tab', () => {
    expect(DRAWER_TABS[0].id).toBe('overview');
    expect(DRAWER_TABS[0].label).toBe('Referral');
  });

  it('has "Demographics" as the second tab', () => {
    expect(DRAWER_TABS[1].id).toBe('demographics');
    expect(DRAWER_TABS[1].label).toBe('Demographics');
  });

  it('contains 12 tabs total (including F2F and Clinical Review)', () => {
    expect(DRAWER_TABS.length).toBe(12);
  });

  it('has all expected tab IDs', () => {
    const ids = DRAWER_TABS.map((t) => t.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('demographics');
    expect(ids).toContain('triage');
    expect(ids).toContain('f2f');
    expect(ids).toContain('eligibility');
    expect(ids).toContain('notes');
    expect(ids).toContain('timeline');
    expect(ids).toContain('files');
    expect(ids).toContain('tasks');
    expect(ids).toContain('clinical_review');
    expect(ids).toContain('authorizations');
    expect(ids).toContain('conflicts');
  });

  it('tab order: Referral, Demographics, Triage, F2F, then the rest', () => {
    expect(DRAWER_TABS[0].id).toBe('overview');
    expect(DRAWER_TABS[1].id).toBe('demographics');
    expect(DRAWER_TABS[2].id).toBe('triage');
    expect(DRAWER_TABS[3].id).toBe('f2f');
  });

  it('does not have any tab labeled just "Overview"', () => {
    const labels = DRAWER_TABS.map((t) => t.label);
    expect(labels).not.toContain('Overview');
  });
});
