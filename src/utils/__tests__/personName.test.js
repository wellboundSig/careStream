import { describe, it, expect } from 'vitest';
import {
  normalizePersonNamePart,
  normalizePersonNameFields,
  normalizeContactName,
} from '../personName.js';

describe('normalizePersonNamePart', () => {
  it('title-cases lower and upper input', () => {
    expect(normalizePersonNamePart('john')).toBe('John');
    expect(normalizePersonNamePart('JOHN')).toBe('John');
    expect(normalizePersonNamePart('jOhN')).toBe('John');
  });

  it('collapses whitespace', () => {
    expect(normalizePersonNamePart('  mary   ann  ')).toBe('Mary Ann');
  });

  it('preserves hyphenated names', () => {
    expect(normalizePersonNamePart('mary-jane')).toBe('Mary-Jane');
    expect(normalizePersonNamePart('MARY-JANE')).toBe('Mary-Jane');
  });

  it('handles O\' / apostrophe names', () => {
    expect(normalizePersonNamePart("o'brien")).toBe("O'Brien");
    expect(normalizePersonNamePart("O'BRIEN")).toBe("O'Brien");
  });

  it('handles Mc names', () => {
    expect(normalizePersonNamePart('mcdonald')).toBe('McDonald');
    expect(normalizePersonNamePart('MCBRIDE')).toBe('McBride');
  });

  it('normalizes suffixes', () => {
    expect(normalizePersonNamePart('smith jr')).toBe('Smith Jr');
    expect(normalizePersonNamePart('smith III')).toBe('Smith III');
  });

  it('returns empty for blank', () => {
    expect(normalizePersonNamePart('')).toBe('');
    expect(normalizePersonNamePart('   ')).toBe('');
    expect(normalizePersonNamePart(null)).toBe('');
  });
});

describe('normalizePersonNameFields', () => {
  it('normalizes first and last', () => {
    expect(normalizePersonNameFields({ first_name: 'jane', last_name: 'DOE' })).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
    });
  });
});

describe('normalizeContactName', () => {
  it('preserves short ALL-CAPS acronyms', () => {
    expect(normalizeContactName('ACPG Admin')).toBe('ACPG Admin');
    expect(normalizeContactName('ADMIN')).toBe('ADMIN');
  });

  it('title-cases person contacts and trims', () => {
    expect(normalizeContactName('Natasha Persaud ')).toBe('Natasha Persaud');
    expect(normalizeContactName('Chivaughn Martin (Mom)')).toBe('Chivaughn Martin (Mom)');
  });
});
