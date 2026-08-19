import { describe, it, expect } from 'vitest';
import { hchbBody, hchbCaseLines, hchbTitle, hchbTone } from '../hchbDupResult.js';

describe('hchbTone', () => {
  it('flags an active strong match', () => {
    expect(hchbTone({
      ok: true,
      confidence: 'strong',
      duplicate: true,
      hchb_case: { case_status: 'active', episode_status: 'CURRENT', has_active_episode: true },
    })).toBe('strong');
  });

  it('flags a discharged strong match as former', () => {
    expect(hchbTone({
      ok: true,
      confidence: 'strong',
      former_patient: true,
      duplicate: false,
      hchb_case: {
        case_status: 'discharged',
        episode_status: 'DISCHARGED',
        discharged_on: '2024-06-01',
        has_active_episode: false,
      },
    })).toBe('former');
  });

  it('keeps name-only hits soft even when the latest episode is discharged', () => {
    expect(hchbTone({
      ok: true,
      confidence: 'soft',
      possible_match: true,
      hchb_case: { case_status: 'discharged', episode_status: 'DISCHARGED', has_active_episode: false },
    })).toBe('soft');
  });

  it('treats no match as clear', () => {
    expect(hchbTone({ ok: true, confidence: null, possible_match: false })).toBe('clear');
  });
});

describe('hchbCaseLines', () => {
  it('describes an active episode with start date', () => {
    const lines = hchbCaseLines({
      hchb_case: {
        case_status: 'active',
        episode_status: 'CURRENT',
        episode_start: '2024-01-15',
        has_active_episode: true,
        episode_count: 2,
      },
    });
    expect(lines[0]).toMatch(/Latest episode: CURRENT/);
    expect(lines[0]).toMatch(/Jan 15, 2024/);
    expect(lines[1]).toBe('2 episodes on file');
  });

  it('describes a discharge date', () => {
    const lines = hchbCaseLines({
      hchb_case: {
        case_status: 'discharged',
        episode_status: 'DISCHARGED',
        discharged_on: '2024-06-01',
        episode_start: '2023-12-01',
        has_active_episode: false,
      },
    });
    expect(lines[0]).toMatch(/Discharged Jun 1, 2024/);
    expect(lines[0]).toMatch(/Dec 1, 2023/);
  });
});

describe('hchb copy', () => {
  it('uses discharged wording for former patients', () => {
    expect(hchbTitle('former')).toMatch(/discharged/i);
    expect(hchbBody('former', { display: 'Jane Doe' })).toMatch(/not currently active/);
  });

  it('uses not-in-HCHB wording when clear', () => {
    expect(hchbTitle('clear', { display: 'Jane Doe' })).toBe('Jane Doe is not in HCHB');
  });
});
