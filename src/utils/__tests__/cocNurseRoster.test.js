import { describe, it, expect } from 'vitest';
import {
  isCocNurseRoleName,
  listCocNurseRoster,
} from '../cocNurseRoster.js';

describe('isCocNurseRoleName', () => {
  it('matches COC Nurse and ignores Clinical', () => {
    expect(isCocNurseRoleName('COC Nurse')).toBe(true);
    expect(isCocNurseRoleName('coc')).toBe(true);
    expect(isCocNurseRoleName('Clinical RN')).toBe(false);
    expect(isCocNurseRoleName('Intake Coordinator')).toBe(false);
  });
});

describe('listCocNurseRoster', () => {
  const roles = {
    r1: { id: 'rol_014', name: 'COC Nurse' },
    r2: { id: 'rol_005', name: 'Clinical RN' },
  };
  const users = {
    a: { _id: 'ua', id: 'usr_090', first_name: 'Martine', last_name: 'Benoit', email: 'm@x.com', status: 'Active', role_id: 'rol_014' },
    b: { _id: 'ub', id: 'usr_092', first_name: 'Kelliann', last_name: 'Smith', email: 'k@x.com', status: 'Active', role_id: 'rol_014' },
    c: { _id: 'uc', id: 'usr_rn', first_name: 'Irina', last_name: 'P', role_id: 'rol_005' },
  };
  const cocNurseFacilities = {
    l1: { user_id: 'usr_090', facility_id: 'fac_a' },
    l2: { user_id: 'usr_090', facility_id: 'fac_b' },
  };
  const resolveFacility = (id) => ({ fac_a: 'Sunrise ALF', fac_b: 'Parkview' }[id] || '—');

  it('lists only COC-role users, unassigned first, with facility names', () => {
    const rows = listCocNurseRoster({ users, roles, cocNurseFacilities, resolveFacility });
    expect(rows.map((r) => r.userId)).toEqual(['usr_092', 'usr_090']);
    expect(rows[0].assigned).toBe(false);
    expect(rows[0].facilities).toEqual([]);
    expect(rows[1].assigned).toBe(true);
    expect(rows[1].facilities.map((f) => f.name)).toEqual(['Parkview', 'Sunrise ALF']);
  });

  it('does not list Clinical RNs', () => {
    const rows = listCocNurseRoster({ users, roles, cocNurseFacilities, resolveFacility });
    expect(rows.some((r) => r.userId === 'usr_rn')).toBe(false);
  });
});
