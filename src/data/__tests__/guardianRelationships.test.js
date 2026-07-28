import { describe, it, expect } from 'vitest';
import {
  normalizeGuardianRelationship,
  splitContactNameAndRelationship,
} from '../guardianRelationships.js';

describe('normalizeGuardianRelationship', () => {
  it('maps aliases', () => {
    expect(normalizeGuardianRelationship('Mom')).toBe('Mother');
    expect(normalizeGuardianRelationship('dad')).toBe('Father');
    expect(normalizeGuardianRelationship('Legal Gaurdian')).toBe('Legal Guardian');
  });

  it('keeps catalog values', () => {
    expect(normalizeGuardianRelationship('Spouse')).toBe('Spouse');
  });
});

describe('splitContactNameAndRelationship', () => {
  it('extracts trailing parenthetical relationship', () => {
    expect(splitContactNameAndRelationship('John Smith (Father)')).toEqual({
      cleanName: 'John Smith',
      relationship: 'Father',
    });
  });

  it('extracts Mom alias', () => {
    expect(splitContactNameAndRelationship('Chivaughn Martin (Mom)')).toEqual({
      cleanName: 'Chivaughn Martin',
      relationship: 'Mother',
    });
  });

  it('leaves facility-style names alone when paren is not a relationship', () => {
    const r = splitContactNameAndRelationship('Amin ACS');
    expect(r.cleanName).toBe('Amin ACS');
    expect(r.relationship).toBe('');
  });

  it('does not invent a relationship', () => {
    expect(splitContactNameAndRelationship('Jane Doe').relationship).toBe('');
  });
});
