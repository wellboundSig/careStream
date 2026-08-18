import { describe, it, expect } from 'vitest';
import {
  isNamedLookupContact,
  isPhoneLikeContactLabel,
  facilityToLookupItem,
  buildContactLookupList,
} from '../knownGuardians.js';
import { normalizeGuardianRelationship } from '../../data/guardianRelationships.js';

describe('isNamedLookupContact', () => {
  it('rejects empty, dash, phone stubs, and role-only labels', () => {
    expect(isNamedLookupContact({ display_name: '' })).toBe(false);
    expect(isNamedLookupContact({ display_name: '—' })).toBe(false);
    expect(isNamedLookupContact({ first_name: '', last_name: '', phone: '6466963928' })).toBe(false);
    expect(isNamedLookupContact({ display_name: '917' })).toBe(false);
    expect(isNamedLookupContact({ display_name: '91724692' })).toBe(false);
    expect(isNamedLookupContact({ display_name: '6466963928' })).toBe(false);
    expect(isNamedLookupContact({ display_name: 'Mom' })).toBe(false);
  });

  it('keeps named people and entities', () => {
    expect(isNamedLookupContact({ display_name: 'Janet Byrd' })).toBe(true);
    expect(isNamedLookupContact({ first_name: 'Arturo', last_name: 'Martinez' })).toBe(true);
    expect(isNamedLookupContact({ display_name: 'Sunrise ALF' })).toBe(true);
  });
});

describe('isPhoneLikeContactLabel', () => {
  it('treats partial and formatted phones as junk names', () => {
    expect(isPhoneLikeContactLabel('917')).toBe(true);
    expect(isPhoneLikeContactLabel('(646) 696-3928')).toBe(true);
    expect(isPhoneLikeContactLabel('Janet')).toBe(false);
  });
});

describe('buildContactLookupList', () => {
  const guardians = [
    { id: 'g1', display_name: 'Maria Lopez', phone: '2125550100', is_active: true },
    { id: 'g2', display_name: '', phone: '6466963928', is_active: true },
    { id: 'g3', display_name: '917', phone: '917', is_active: true },
    { id: 'g4', display_name: 'Inactive Person', phone: '2125550199', is_active: false },
  ];
  const facilities = [
    { id: 'f1', name: 'Parkview ALF', phone: '7185550100' },
    { id: 'f2', name: '', phone: '7185550101' },
    { id: 'f3', name: 'Maria Lopez', phone: '2125550100' },
  ];

  it('shows only named people and named facilities, and dedupes by name', () => {
    const list = buildContactLookupList({ guardians, facilities, query: '' });
    const names = list.map((r) => r.display_name);
    expect(names).toContain('Maria Lopez');
    expect(names).toContain('Parkview ALF');
    expect(names).not.toContain('917');
    expect(names).not.toContain('Inactive Person');
    expect(list.filter((r) => r.display_name === 'Maria Lopez')).toHaveLength(1);
    expect(list.find((r) => r.display_name === 'Parkview ALF').kind).toBe('facility');
  });

  it('searches by name or phone', () => {
    const byName = buildContactLookupList({ guardians, facilities, query: 'park' });
    expect(byName.map((r) => r.display_name)).toEqual(['Parkview ALF']);
    const byPhone = buildContactLookupList({ guardians, facilities, query: '212555' });
    expect(byPhone.some((r) => r.display_name === 'Maria Lopez')).toBe(true);
  });
});

describe('facilityToLookupItem', () => {
  it('skips unnamed facilities', () => {
    expect(facilityToLookupItem({ id: 'x', name: '' })).toBeNull();
    expect(facilityToLookupItem({ id: 'y', name: 'Harbor Care', phone: '555' })?.display_name).toBe('Harbor Care');
  });
});

describe('Facility relationship', () => {
  it('maps facility aliases', () => {
    expect(normalizeGuardianRelationship('Facility')).toBe('Facility');
    expect(normalizeGuardianRelationship('ALF')).toBe('Facility');
  });
});
