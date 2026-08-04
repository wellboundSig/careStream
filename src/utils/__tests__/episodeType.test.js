import { describe, it, expect } from 'vitest';
import {
  normalizeEpisodeType,
  isRoc,
  scheduleVerb,
  markCompletedVerb,
  episodeDateLabel,
} from '../episodeType.js';

describe('episodeType', () => {
  it('defaults missing/blank to SOC', () => {
    expect(normalizeEpisodeType(null)).toBe('SOC');
    expect(normalizeEpisodeType({})).toBe('SOC');
    expect(normalizeEpisodeType({ episode_type: '' })).toBe('SOC');
  });

  it('normalizes ROC case-insensitively', () => {
    expect(normalizeEpisodeType('roc')).toBe('ROC');
    expect(normalizeEpisodeType({ episode_type: 'ROC' })).toBe('ROC');
    expect(isRoc({ episode_type: 'ROC' })).toBe(true);
  });

  it('uses ROC verbs for ROC referrals', () => {
    const r = { episode_type: 'ROC' };
    expect(scheduleVerb(r)).toBe('Schedule ROC');
    expect(markCompletedVerb(r)).toBe('Mark ROC Completed');
    expect(episodeDateLabel(r)).toBe('ROC Date');
  });

  it('uses SOC verbs for SOC referrals', () => {
    const r = { episode_type: 'SOC' };
    expect(scheduleVerb(r)).toBe('Schedule SOC');
    expect(markCompletedVerb(r)).toBe('Mark SOC Completed');
    expect(episodeDateLabel(r)).toBe('SOC Date');
  });
});
