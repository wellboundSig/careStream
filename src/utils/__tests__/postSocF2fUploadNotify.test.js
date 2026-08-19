import { describe, it, expect, vi, beforeEach } from 'vitest';

const createNoteOptimistic = vi.fn(async () => ({}));
const createNotification = vi.fn(async () => ({}));
const getStore = vi.fn(() => ({ users: {}, roles: {}, cocNurseFacilities: {} }));

vi.mock('../../store/mutations.js', () => ({
  createNoteOptimistic: (...args) => createNoteOptimistic(...args),
}));

vi.mock('../../api/notifications.js', () => ({
  createNotification: (...args) => createNotification(...args),
}));

vi.mock('../../store/careStore.js', () => ({
  getStore: (...args) => getStore(...args),
}));

const {
  postSocF2fUploadNoteText,
  listNurseUsers,
  notifyPostSocF2fUploaded,
  POST_SOC_F2F_UPLOAD_TYPE,
} = await import('../postSocF2fUploadNotify.js');

describe('postSocF2fUploadNoteText', () => {
  it('fills the uploader and calendar date', () => {
    expect(postSocF2fUploadNoteText('Vanessa Villa', '2026-08-19'))
      .toBe('Vanessa Villa uploaded a face to face file on Aug 19, 2026.');
  });

  it('falls back when the name is missing', () => {
    expect(postSocF2fUploadNoteText('', '2026-08-19'))
      .toBe('Someone uploaded a face to face file on Aug 19, 2026.');
  });
});

describe('listNurseUsers', () => {
  it('includes Clinical RN, Field Nurse, and COC-linked staff', () => {
    const list = listNurseUsers({
      users: {
        a: { id: 'usr_rn', first_name: 'Irina', last_name: 'P', status: 'Active', role_id: 'role_clin' },
        b: { id: 'usr_field', first_name: 'Pat', last_name: 'Field', status: 'Active', role_id: 'role_fn' },
        c: { id: 'usr_mkt', first_name: 'Max', last_name: 'Mkt', status: 'Active', role_id: 'role_mkt' },
        d: { id: 'usr_coc', first_name: 'Cara', last_name: 'Coc', status: 'Active', role_id: 'role_other' },
      },
      roles: {
        r1: { id: 'role_clin', name: 'Clinical RN' },
        r2: { id: 'role_fn', name: 'Field Nurse' },
        r3: { id: 'role_mkt', name: 'Marketer' },
        r4: { id: 'role_other', name: 'Staff' },
      },
      cocNurseFacilities: { l1: { user_id: 'usr_coc' } },
    });
    expect(list.map((u) => u.id).sort()).toEqual(['usr_coc', 'usr_field', 'usr_rn']);
  });
});

describe('notifyPostSocF2fUploaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStore.mockReturnValue({
      users: {
        rn: { id: 'usr_rn', status: 'Active', role_id: 'role_clin', first_name: 'Irina', last_name: 'P' },
        me: { id: 'usr_intake', status: 'Active', role_id: 'role_intake', first_name: 'Vanessa', last_name: 'V' },
      },
      roles: {
        r1: { id: 'role_clin', name: 'Clinical RN' },
        r2: { id: 'role_intake', name: 'Intake Specialist' },
      },
      cocNurseFacilities: {},
    });
  });

  it('no-ops when the case is not post-SOC docs', async () => {
    const result = await notifyPostSocF2fUploaded({
      referral: { _id: 'r1', id: 'ref_1', patient_id: 'pat_1' },
      actorUserId: 'usr_intake',
      actorName: 'Vanessa Villa',
    });
    expect(result.ok).toBe(false);
    expect(createNoteOptimistic).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('writes the note and notifies every nurse except the uploader', async () => {
    const result = await notifyPostSocF2fUploaded({
      referral: {
        _id: 'r1',
        id: 'ref_1',
        patient_id: 'pat_1',
        documentation_deferred: true,
      },
      patient: { first_name: 'Melford', last_name: 'Hogan' },
      actorUserId: 'usr_intake',
      actorName: 'Vanessa Villa',
      uploadedOn: '2026-08-19',
    });
    expect(result.ok).toBe(true);
    expect(createNoteOptimistic).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'pat_1',
      referral_id: 'ref_1',
      author_id: 'usr_intake',
      content: 'Vanessa Villa uploaded a face to face file on Aug 19, 2026.',
    }));
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_rn',
      type: POST_SOC_F2F_UPLOAD_TYPE,
      title: 'Vanessa Villa uploaded a face to face file on Aug 19, 2026.',
      body: 'Melford Hogan',
    }));
  });
});
