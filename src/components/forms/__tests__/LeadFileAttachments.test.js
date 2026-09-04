import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  stageFilesFromList,
  stagedFilesNeedF2fDate,
  uploadStagedLeadFiles,
} from '../LeadFileAttachments.jsx';

vi.mock('../../../utils/r2Upload.js', () => ({
  uploadToR2: vi.fn().mockResolvedValue({ r2Key: 'k', r2Url: 'u' }),
}));

vi.mock('../../../api/patientFiles.js', () => ({
  createFile: vi.fn().mockResolvedValue({ id: 'rec_f', fields: { id: 'file_1' } }),
}));

vi.mock('../../../api/referrals.js', () => ({
  updateReferral: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../store/careStore.js', () => ({
  mergeEntities: vi.fn(),
}));

vi.mock('../../physicians/PhysicianPicker.jsx', () => ({
  default: () => null,
}));

const { uploadToR2 } = await import('../../../utils/r2Upload.js');
const { createFile } = await import('../../../api/patientFiles.js');
const { updateReferral } = await import('../../../api/referrals.js');

describe('stageFilesFromList', () => {
  it('appends File objects with default category Other', () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const next = stageFilesFromList([file], []);
    expect(next).toHaveLength(1);
    expect(next[0].file).toBe(file);
    expect(next[0].category).toBe('Other');
    expect(next[0].physician).toBe(null);
    expect(next[0].f2fDate).toBe('');
  });
});

describe('stagedFilesNeedF2fDate', () => {
  it('is true only when an F2F file has no visit date', () => {
    expect(stagedFilesNeedF2fDate([{ category: 'Other', f2fDate: '' }])).toBe(false);
    expect(stagedFilesNeedF2fDate([{ category: 'F2F', f2fDate: '2026-08-01' }])).toBe(false);
    expect(stagedFilesNeedF2fDate([{ category: 'F2F', f2fDate: '' }])).toBe(true);
  });
});

describe('uploadStagedLeadFiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes category, uploader, and optional physician onto the Files row', async () => {
    const file = new File(['x'], 'orders.pdf', { type: 'application/pdf' });
    const failures = await uploadStagedLeadFiles({
      stagedFiles: [{
        file,
        category: 'MD Orders',
        physician: { id: 'phy_9' },
        f2fDate: '',
      }],
      patientId: 'pat_1',
      referralId: 'ref_1',
      referralRecId: 'rec_ref1',
      appUserId: 'usr_1',
    });

    expect(failures).toEqual([]);
    expect(uploadToR2).toHaveBeenCalledWith(file, 'pat_1');
    expect(createFile).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'pat_1',
      referral_id: 'ref_1',
      file_name: 'orders.pdf',
      category: 'MD Orders',
      physician_id: 'phy_9',
      uploaded_by_id: 'usr_1',
    }));
    expect(updateReferral).not.toHaveBeenCalled();
  });

  it('stamps F2F visit date onto the referral', async () => {
    const file = new File(['x'], 'f2f.pdf', { type: 'application/pdf' });
    await uploadStagedLeadFiles({
      stagedFiles: [{ file, category: 'F2F', physician: null, f2fDate: '2026-08-10' }],
      patientId: 'pat_1',
      referralId: 'ref_1',
      referralRecId: 'rec_ref1',
      appUserId: 'usr_1',
    });

    expect(createFile).toHaveBeenCalledWith(expect.objectContaining({
      category: 'F2F',
      f2f_visit_date: '2026-08-10',
    }));
    expect(updateReferral).toHaveBeenCalledWith('rec_ref1', expect.objectContaining({
      f2f_date: '2026-08-10',
      f2f_expiration: '2026-11-08',
    }));
  });

  it('collects per-file failures without throwing', async () => {
    uploadToR2.mockRejectedValueOnce(new Error('network'));
    const failures = await uploadStagedLeadFiles({
      stagedFiles: [{ file: new File(['x'], 'bad.pdf'), category: 'Other' }],
      patientId: 'pat_1',
      referralId: 'ref_1',
      referralRecId: 'rec_ref1',
      appUserId: 'usr_1',
    });
    expect(failures).toEqual([{ name: 'bad.pdf', message: 'network' }]);
    expect(createFile).not.toHaveBeenCalled();
  });
});
