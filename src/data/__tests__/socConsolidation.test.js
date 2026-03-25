import { describe, it, expect } from 'vitest';
import { STAGE_SLUGS, STAGE_META, ROLE_MODES, ALL_STAGES } from '../stageConfig.js';
import StageRules from '../StageRules.json';
import { PANE_NAV } from '../paneRoutes.js';

describe('SOC consolidation — DB stage values preserved', () => {
  it('Pre-SOC exists as a DB stage', () => {
    expect(STAGE_SLUGS['Pre-SOC']).toBe('pre-soc');
    expect(StageRules.stages['Pre-SOC']).toBeTruthy();
    expect(StageRules.stages['Pre-SOC'].terminal).toBe(false);
  });

  it('SOC Scheduled exists as a DB stage (not removed)', () => {
    expect(STAGE_SLUGS['SOC Scheduled']).toBe('soc-scheduled');
    expect(StageRules.stages['SOC Scheduled']).toBeTruthy();
    expect(StageRules.stages['SOC Scheduled'].terminal).toBe(false);
  });

  it('SOC Completed exists as a DB stage and is terminal', () => {
    expect(STAGE_SLUGS['SOC Completed']).toBe('soc-completed');
    expect(StageRules.stages['SOC Completed']).toBeTruthy();
    expect(StageRules.stages['SOC Completed'].terminal).toBe(true);
  });

  it('all three SOC stages are in ALL_STAGES', () => {
    expect(ALL_STAGES).toContain('Pre-SOC');
    expect(ALL_STAGES).toContain('SOC Scheduled');
    expect(ALL_STAGES).toContain('SOC Completed');
  });

  it('StageRules transition paths are intact (Pre-SOC → SOC Scheduled allowed)', () => {
    expect(StageRules.stages['Pre-SOC'].canMoveTo).toContain('SOC Scheduled');
  });

  it('StageRules transition paths are intact (SOC Scheduled → SOC Completed allowed)', () => {
    expect(StageRules.stages['SOC Scheduled'].canMoveTo).toContain('SOC Completed');
  });
});

describe('SOC consolidation — UI changes', () => {
  it('Pre-SOC STAGE_META has consolidatedStages covering Pre-SOC + SOC Scheduled', () => {
    const meta = STAGE_META['Pre-SOC'];
    expect(meta.consolidatedStages).toEqual(['Pre-SOC', 'SOC Scheduled']);
  });

  it('SOC Scheduled STAGE_META is marked hiddenFromNav', () => {
    expect(STAGE_META['SOC Scheduled'].hiddenFromNav).toBe(true);
  });

  it('SOC Completed displayName is "Completed"', () => {
    expect(STAGE_META['SOC Completed'].displayName).toBe('Completed');
  });

  it('scheduler role mode shows Pre-SOC and SOC Completed but NOT SOC Scheduled', () => {
    const schedulerMode = ROLE_MODES.find((m) => m.id === 'scheduler');
    expect(schedulerMode.stages).toContain('Pre-SOC');
    expect(schedulerMode.stages).toContain('SOC Completed');
    expect(schedulerMode.stages).not.toContain('SOC Scheduled');
  });

  it('pane nav shows Pre-SOC and Completed but NOT SOC Scheduled', () => {
    const moduleItems = PANE_NAV.find((g) => g.group === 'Modules').items;
    const paths = moduleItems.map((i) => i.path);
    expect(paths).toContain('/modules/pre-soc');
    expect(paths).toContain('/modules/soc-completed');
    expect(paths).not.toContain('/modules/soc-scheduled');
  });

  it('pane nav labels SOC Completed as "Completed"', () => {
    const moduleItems = PANE_NAV.find((g) => g.group === 'Modules').items;
    const completedItem = moduleItems.find((i) => i.path === '/modules/soc-completed');
    expect(completedItem.label).toBe('Completed');
  });
});

describe('SOC consolidation — metrics compatibility', () => {
  it('raw DB values Pre-SOC, SOC Scheduled, SOC Completed are unchanged strings', () => {
    expect(Object.keys(StageRules.stages)).toContain('Pre-SOC');
    expect(Object.keys(StageRules.stages)).toContain('SOC Scheduled');
    expect(Object.keys(StageRules.stages)).toContain('SOC Completed');
  });

  it('SOC Completed is still the only terminal stage in the SOC group', () => {
    expect(StageRules.stages['Pre-SOC'].terminal).toBe(false);
    expect(StageRules.stages['SOC Scheduled'].terminal).toBe(false);
    expect(StageRules.stages['SOC Completed'].terminal).toBe(true);
  });
});
