import { describe, it, expect } from 'vitest';
import { STAGE_SLUGS, SLUG_TO_STAGE, ALL_STAGES, STAGE_META, DISCARD_REASONS, ROLE_MODES } from '../stageConfig.js';
import StageRules from '../StageRules.json';
import { PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_CATEGORIES } from '../permissionKeys.js';

// ── Leads rename ────────────────────────────────────────────────────────────

describe('Leads rename (Lead Entry display name)', () => {
  it('STAGE_META.Lead Entry has displayName "Leads"', () => {
    expect(STAGE_META['Lead Entry'].displayName).toBe('Leads');
  });

  it('StageRules "Lead Entry" has displayName "Leads"', () => {
    expect(StageRules.stages['Lead Entry'].displayName).toBe('Leads');
  });

  it('STAGE_SLUGS maps "Lead Entry" to "lead-entry"', () => {
    expect(STAGE_SLUGS['Lead Entry']).toBe('lead-entry');
  });
});

// ── Discarded Leads stage ───────────────────────────────────────────────────

describe('Discarded Leads stage definition', () => {
  it('exists in STAGE_SLUGS', () => {
    expect(STAGE_SLUGS['Discarded Leads']).toBe('discarded-leads');
  });

  it('exists in SLUG_TO_STAGE reverse mapping', () => {
    expect(SLUG_TO_STAGE['discarded-leads']).toBe('Discarded Leads');
  });

  it('is included in ALL_STAGES', () => {
    expect(ALL_STAGES).toContain('Discarded Leads');
  });

  it('has STAGE_META with terminal flag', () => {
    const meta = STAGE_META['Discarded Leads'];
    expect(meta).toBeTruthy();
    expect(meta.isTerminal).toBe(true);
    expect(meta.displayName).toBe('Discarded');
  });

  it('exists in StageRules.json', () => {
    const rule = StageRules.stages['Discarded Leads'];
    expect(rule).toBeTruthy();
    expect(rule.terminal).toBe(true);
    expect(rule.requiresNote).toBe(true);
  });

  it('can only move back to Lead Entry from Discarded Leads', () => {
    const rule = StageRules.stages['Discarded Leads'];
    expect(rule.canMoveTo).toEqual(['Lead Entry']);
  });

  it('Lead Entry can move to Discarded Leads', () => {
    expect(StageRules.stages['Lead Entry'].canMoveTo).toContain('Discarded Leads');
  });

  it('is in the intake role mode stages for sidebar visibility', () => {
    const intakeMode = ROLE_MODES.find((m) => m.id === 'intake');
    expect(intakeMode.stages).toContain('Discarded Leads');
  });

  it('is NOT in the pipeline board ROW_GROUPS or STATUS_GROUP stages', () => {
    const allPipelineStages = [
      'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
      'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
      'Conflict', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC',
      'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC',
    ];
    expect(allPipelineStages).not.toContain('Discarded Leads');
  });
});

// ── Discard reasons placeholder ─────────────────────────────────────────────

describe('DISCARD_REASONS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(DISCARD_REASONS)).toBe(true);
    expect(DISCARD_REASONS.length).toBeGreaterThan(0);
    DISCARD_REASONS.forEach((r) => expect(typeof r).toBe('string'));
  });

  it('includes an "Other" option', () => {
    expect(DISCARD_REASONS).toContain('Other');
  });
});

// ── Permission keys ─────────────────────────────────────────────────────────

describe('Leads permission keys', () => {
  it('defines LEADS_PROMOTE_TO_INTAKE', () => {
    expect(PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE).toBe('leads.promote_to_intake');
  });

  it('defines LEADS_DISCARD', () => {
    expect(PERMISSION_KEYS.LEADS_DISCARD).toBe('leads.discard');
  });

  it('has catalog entries for both keys', () => {
    expect(PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE)).toBeTruthy();
    expect(PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.LEADS_DISCARD)).toBeTruthy();
  });

  it('has "Leads" in PERMISSION_CATEGORIES', () => {
    expect(PERMISSION_CATEGORIES).toContain('Leads');
  });

  it('promote permission description mentions supervisor', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE);
    expect(entry.description.toLowerCase()).toContain('supervisor');
  });
});
