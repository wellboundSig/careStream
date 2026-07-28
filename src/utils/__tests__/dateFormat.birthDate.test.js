import { describe, it, expect } from 'vitest';
import { parseFlexibleBirthDate } from '../dateFormat.js';

describe('parseFlexibleBirthDate', () => {
  it('parses ISO and US numeric formats', () => {
    expect(parseFlexibleBirthDate('1990-03-05')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('3/5/1990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('03-05-1990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('03.05.1990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('03051990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('19900305')).toBe('1990-03-05');
  });

  it('parses month names', () => {
    expect(parseFlexibleBirthDate('March 5, 1990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('Mar 5 1990')).toBe('1990-03-05');
    expect(parseFlexibleBirthDate('5 March 1990')).toBe('1990-03-05');
  });

  it('strips time from ISO pastes', () => {
    expect(parseFlexibleBirthDate('1990-03-05T00:00:00.000Z')).toBe('1990-03-05');
  });

  it('rejects impossible dates', () => {
    expect(parseFlexibleBirthDate('2/31/1990')).toBe('');
    expect(parseFlexibleBirthDate('not a date')).toBe('');
    expect(parseFlexibleBirthDate('')).toBe('');
  });
});
