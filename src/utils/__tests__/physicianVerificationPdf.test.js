import { describe, it, expect } from 'vitest';
import { buildPhysicianVerificationPdfBytes } from '../physicianVerificationPdf.js';

const verifiedPhysician = {
  id: 'phy_001',
  first_name: 'Jane',
  last_name: 'Smith',
  title: 'MD',
  npi: '1234567890',
  phone: '555-0100',
  npi_status: 'active',
  npi_checked_at: '2026-09-20T14:00:00Z',
  npi_provider_name: 'JANE SMITH MD',
  npi_details: JSON.stringify({
    enumeration_date: '2005-06-15',
    last_updated: '2024-01-10',
    credential: 'MD',
    gender: 'F',
    sole_proprietor: 'NO',
    status: 'A',
  }),
  is_pecos_enrolled: true,
  pecos_last_checked: '2026-09-20T14:00:00Z',
  is_opra_enrolled: true,
  opra_last_checked: '2026-09-20T14:00:00Z',
  order_refer_flags: JSON.stringify({ PARTB: true, DME: false, HHA: true, HOSPICE: false, PMD: false }),
  verification_last_run_at: '2026-09-20T14:00:00Z',
  verification_checked_by_id: 'usr_001',
};

describe('buildPhysicianVerificationPdfBytes', () => {
  it('produces a non-empty PDF for a fully verified physician', () => {
    const bytes = buildPhysicianVerificationPdfBytes({
      physician: verifiedPhysician,
      patient: { first_name: 'Pat', last_name: 'Ient' },
      referral: { id: 'ref_1', division: 'Special Needs' },
      checkedByName: 'Test User',
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // PDF magic bytes
    const head = new Uint8Array(bytes.slice(0, 5));
    expect(String.fromCharCode(...head)).toBe('%PDF-');
  });

  it('does not throw for an unverified physician (renders not-checked states)', () => {
    const bytes = buildPhysicianVerificationPdfBytes({
      physician: { id: 'phy_002', first_name: 'New', last_name: 'Doc', npi: '9999999999' },
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('tolerates malformed stored JSON', () => {
    const bytes = buildPhysicianVerificationPdfBytes({
      physician: { ...verifiedPhysician, npi_details: '{not json', order_refer_flags: null },
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
