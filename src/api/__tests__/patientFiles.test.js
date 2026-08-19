import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../airtable.js', () => ({
  default: {
    fetchAll: vi.fn(),
  },
}));

import airtable from '../airtable.js';
import { fetchFilesForChart } from '../patientFiles.js';

describe('fetchFilesForChart', () => {
  beforeEach(() => {
    vi.mocked(airtable.fetchAll).mockReset();
  });

  it('queries both patient identities and the referral', async () => {
    airtable.fetchAll.mockResolvedValue([{ id: 'rec_a', fields: { file_name: 'a.pdf' } }]);
    const rows = await fetchFilesForChart(
      { id: 'pat_hogan', _id: 'rec_p1' },
      { id: 'ref_hogan', _id: 'rec_r1' },
    );
    const formulas = airtable.fetchAll.mock.calls.map((c) => c[1].filterByFormula);
    expect(formulas.some((f) => f.includes('pat_hogan'))).toBe(true);
    expect(formulas.some((f) => f.includes('rec_p1'))).toBe(true);
    expect(formulas.some((f) => f.includes('ref_hogan'))).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('throws when every lookup fails', async () => {
    airtable.fetchAll.mockRejectedValue(new Error('429'));
    await expect(fetchFilesForChart({ id: 'pat_x' }, null)).rejects.toThrow('429');
  });

  it('returns rows from the lookups that succeeded', async () => {
    airtable.fetchAll
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([{ id: 'rec_ok', fields: { file_name: 'saved.pdf' } }]);
    const rows = await fetchFilesForChart({ id: 'pat_hogan', _id: 'rec_p1' }, null);
    expect(rows.map((r) => r.fields.file_name)).toEqual(['saved.pdf']);
  });
});
