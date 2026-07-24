import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/physicianName.js', () => ({
  normalizePhysicianTitle: (raw) => String(raw || '').replace(/\./g, '').toUpperCase(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('buildPhysicianSeedFromNpi', () => {
  it('maps NPPES + Order/Refer into form + verification fields', async () => {
    const npiBody = {
      result_count: 1,
      results: [{
        number: '1407163306',
        enumeration_type: 'NPI-1',
        basic: {
          first_name: 'NEIDRA',
          last_name: 'WALKER',
          credential: 'N.P.',
          status: 'A',
        },
        addresses: [{
          address_purpose: 'LOCATION',
          address_1: '123 MAIN ST',
          city: 'BROOKLYN',
          state: 'NY',
          postal_code: '11201',
          telephone_number: '718-555-1212',
          fax_number: '718-555-3434',
        }],
        taxonomies: [{ primary: true, desc: 'Nurse Practitioner' }],
      }],
    };
    const orRows = [{ NPI: '1407163306', PARTB: 'Y', DME: 'N', HHA: 'Y', HOSPICE: 'N', PMD: 'N' }];

    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/npi/')) {
        return { ok: true, json: async () => npiBody };
      }
      if (u.includes('/data/dataset/')) {
        return { ok: true, json: async () => orRows };
      }
      throw new Error(`unexpected fetch ${u}`);
    });

    const { buildPhysicianSeedFromNpi } = await import('../cms.js');
    const seed = await buildPhysicianSeedFromNpi('1407163306');

    expect(seed.form.first_name).toBe('Neidra');
    expect(seed.form.last_name).toBe('Walker');
    expect(seed.form.title).toBe('NP');
    expect(seed.form.npi).toBe('1407163306');
    expect(seed.form.phone).toBe('7185551212');
    expect(seed.form.fax).toBe('7185553434');
    expect(seed.form.address_city).toBe('Brooklyn');
    expect(seed.form.address_state).toBe('NY');
    expect(seed.form.is_pecos_enrolled).toBe(true);
    expect(seed.form.is_opra_enrolled).toBe(true);
    expect(seed.verification.npi_status).toBe('active');
    expect(seed.meta.taxonomy).toBe('Nurse Practitioner');
  });
});
