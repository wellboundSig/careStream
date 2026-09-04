import { describe, it, expect } from 'vitest';
import {
  classifyAssignment,
  primaryMarketerIdForFacility,
  cocNurseIdsForFacility,
  buildFacilityReconciliation,
  applyReconciliationDecisions,
  unresolvedDecisionKeys,
  rowNeedsDecision,
} from '../facilityReconciliation.js';

describe('classifyAssignment', () => {
  it('classifies match, conflict, keep-only, adopt-only, and none', () => {
    expect(classifyAssignment('mkt_1', 'mkt_1')).toBe('match');
    expect(classifyAssignment('mkt_1', 'mkt_2')).toBe('conflict');
    expect(classifyAssignment('mkt_1', '')).toBe('keep_only');
    expect(classifyAssignment('', 'mkt_2')).toBe('adopt_only');
    expect(classifyAssignment('', '')).toBe('none');
  });
});

describe('primaryMarketerIdForFacility', () => {
  it('prefers the primary marketer link', () => {
    const links = {
      a: { facility_id: 'fac_1', marketer_id: 'mkt_a', is_primary: false },
      b: { facility_id: 'fac_1', marketer_id: 'mkt_b', is_primary: true },
    };
    expect(primaryMarketerIdForFacility('fac_1', links, null)).toBe('mkt_b');
  });

  it('falls back to a network facility marketer_id when no links exist', () => {
    expect(primaryMarketerIdForFacility('fac_1', {}, { marketer_id: 'mkt_net' })).toBe('mkt_net');
  });
});

describe('cocNurseIdsForFacility', () => {
  it('returns unique COC nurse user ids for the facility', () => {
    const rows = {
      a: { facility_id: 'fac_1', user_id: 'usr_a' },
      b: { facility_id: 'fac_1', user_id: 'usr_b' },
      c: { facility_id: 'fac_2', user_id: 'usr_c' },
      d: { facility_id: 'fac_1', user_id: 'usr_a' },
    };
    expect(cocNurseIdsForFacility('fac_1', rows)).toEqual(['usr_a', 'usr_b']);
  });
});

describe('buildFacilityReconciliation', () => {
  const newFacility = {
    id: 'fac_new',
    name: 'Sunrise ALF',
    entity_id: 'ent_wb',
    address_street: '10 Main St',
    zipcode: '10001',
    address_city: 'New York',
    address_state: 'NY',
    marketer_id: 'mkt_new',
  };

  it('flags marketer, COC, entity, and address conflicts and requires a decision', () => {
    const preview = buildFacilityReconciliation({
      referral: {
        facility_id: 'fac_old',
        marketer_id: 'mkt_old',
        coc_nurse_id: 'usr_old',
        entity_id: 'ent_old',
      },
      patient: {
        address_street: '99 Other Ave',
        address_zip: '11201',
        address_city: 'Brooklyn',
        address_state: 'NY',
      },
      newFacility,
      marketerFacilities: {},
      cocNurseFacilities: { c1: { facility_id: 'fac_new', user_id: 'usr_new' } },
    });

    expect(preview.sameFacility).toBe(false);
    expect(preview.rows.find((r) => r.key === 'marketer').status).toBe('conflict');
    expect(preview.rows.find((r) => r.key === 'coc_nurse').status).toBe('conflict');
    expect(preview.rows.find((r) => r.key === 'entity').status).toBe('conflict');
    expect(preview.rows.find((r) => r.key === 'address').status).toBe('conflict');
    expect(unresolvedDecisionKeys(preview, {})).toEqual(
      expect.arrayContaining(['marketer', 'coc_nurse', 'entity', 'address']),
    );
  });

  it('does not require a decision when assignments already match', () => {
    const preview = buildFacilityReconciliation({
      referral: {
        facility_id: 'fac_old',
        marketer_id: 'mkt_new',
        coc_nurse_id: 'usr_new',
        entity_id: 'ent_wb',
      },
      patient: {
        address_street: '10 Main St',
        address_zip: '10001',
        address_city: 'New York',
        address_state: 'NY',
      },
      newFacility,
      marketerFacilities: {},
      cocNurseFacilities: { c1: { facility_id: 'fac_new', user_id: 'usr_new' } },
    });

    expect(preview.rows.every((r) => r.status === 'match' || !rowNeedsDecision(r))).toBe(true);
    expect(unresolvedDecisionKeys(preview, {})).toEqual([]);
  });

  it('treats multiple COC nurses as a pick when the current nurse is not on the new facility', () => {
    const preview = buildFacilityReconciliation({
      referral: { facility_id: 'fac_old', coc_nurse_id: 'usr_old' },
      newFacility: { id: 'fac_new', name: 'B' },
      cocNurseFacilities: {
        a: { facility_id: 'fac_new', user_id: 'usr_a' },
        b: { facility_id: 'fac_new', user_id: 'usr_b' },
      },
    });
    const coc = preview.rows.find((r) => r.key === 'coc_nurse');
    expect(coc.status).toBe('pick');
    expect(rowNeedsDecision(coc)).toBe(true);
  });
});

describe('applyReconciliationDecisions', () => {
  it('writes only the fields the actor chose to change', () => {
    const preview = {
      newFacilityId: 'fac_new',
      rows: [
        { key: 'marketer', field: 'marketer_id', label: 'Primary marketer', currentValue: 'mkt_old', suggestedValue: 'mkt_new', status: 'conflict' },
        { key: 'coc_nurse', field: 'coc_nurse_id', label: 'COC nurse', currentValue: 'usr_old', suggestedValue: 'usr_new', status: 'conflict' },
        { key: 'entity', field: 'entity_id', label: 'Entity', currentValue: 'ent_old', suggestedValue: 'ent_wb', status: 'conflict' },
        {
          key: 'address',
          field: 'address',
          label: 'Patient address',
          currentValue: '99 Other Ave',
          suggestedValue: '10 Main St',
          status: 'conflict',
          suggestedAddress: { street: '10 Main St', zip: '10001', city: 'New York', state: 'NY', label: '10 Main St, New York, NY, 10001' },
        },
      ],
    };

    const { referralFields, patientFields, summary } = applyReconciliationDecisions(preview, {
      marketer: { action: 'adopt' },
      coc_nurse: { action: 'keep' },
      entity: { action: 'adopt' },
      address: { action: 'keep' },
    });

    expect(referralFields.facility_id).toBe('fac_new');
    expect(referralFields.marketer_id).toBe('mkt_new');
    expect(referralFields).not.toHaveProperty('coc_nurse_id');
    expect(referralFields.entity_id).toBe('ent_wb');
    expect(patientFields).toBe(null);
    expect(summary.some((line) => line.includes('Primary marketer'))).toBe(true);
  });

  it('adopts the facility address when chosen', () => {
    const preview = {
      newFacilityId: 'fac_new',
      rows: [{
        key: 'address',
        field: 'address',
        label: 'Patient address',
        currentValue: 'old',
        suggestedValue: 'new',
        status: 'conflict',
        suggestedAddress: { street: '10 Main St', zip: '10001', city: 'New York', state: 'NY', label: '10 Main St' },
      }],
    };
    const { patientFields } = applyReconciliationDecisions(preview, { address: { action: 'adopt' } });
    expect(patientFields).toEqual({
      address_street: '10 Main St',
      address_zip: '10001',
      address_city: 'New York',
      address_state: 'NY',
    });
  });
});
