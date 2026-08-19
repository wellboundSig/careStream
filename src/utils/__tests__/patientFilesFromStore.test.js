import { describe, it, expect } from 'vitest';
import {
  filesForPatientFromStore,
  mergeFileLists,
  normalizeFileRecord,
  collectIdentities,
  resolveStoreRecord,
} from '../patientFilesFromStore.js';

const patient = { id: 'pat_hogan', _id: 'rec_p1' };
const referral = { id: 'ref_hogan', _id: 'rec_r1' };

describe('filesForPatientFromStore', () => {
  it('finds files by patient id even when the business file id is missing', () => {
    const store = {
      rec_a: { _id: 'rec_a', id: null, patient_id: 'pat_hogan', file_name: 'HOGAN.pdf', created_at: '2026-08-10' },
      rec_b: { _id: 'rec_b', patient_id: 'pat_other', file_name: 'OTHER.pdf' },
    };
    const rows = filesForPatientFromStore(store, patient, referral);
    expect(rows.map((f) => f.file_name)).toEqual(['HOGAN.pdf']);
  });

  it('also matches referral_id', () => {
    const store = {
      rec_a: { _id: 'rec_a', referral_id: 'ref_hogan', file_name: 'enc.pdf' },
    };
    expect(filesForPatientFromStore(store, patient, referral).map((f) => f.file_name)).toEqual(['enc.pdf']);
  });

  it('matches when files store the patient rec_id and the drawer only has the business id', () => {
    const storePatients = {
      rec_p1: { _id: 'rec_p1', id: 'pat_hogan' },
    };
    const stubPatient = { id: 'pat_hogan', _id: 'pat_hogan' };
    const store = {
      rec_a: { _id: 'rec_a', id: null, patient_id: 'rec_p1', file_name: 'CHHA.pdf' },
    };
    const rows = filesForPatientFromStore(store, stubPatient, referral, { patients: storePatients });
    expect(rows.map((f) => f.file_name)).toEqual(['CHHA.pdf']);
  });

  it('matches Airtable-style array links', () => {
    const store = {
      rec_a: { _id: 'rec_a', patient_id: ['pat_hogan'], file_name: 'array.pdf' },
    };
    expect(filesForPatientFromStore(store, patient, referral).map((f) => f.file_name)).toEqual(['array.pdf']);
  });
});

describe('collectIdentities', () => {
  it('adds the rec_id from the patients store when the drawer snapshot is a stub', () => {
    const ids = collectIdentities(
      { id: 'pat_hogan', _id: 'pat_hogan' },
      { rec_p1: { _id: 'rec_p1', id: 'pat_hogan' } },
    );
    expect([...ids].sort()).toEqual(['pat_hogan', 'rec_p1']);
  });
});

describe('resolveStoreRecord', () => {
  it('finds the hydrated patient when the drawer only has the business id', () => {
    const map = { rec_p1: { _id: 'rec_p1', id: 'pat_hogan', first_name: 'Melford' } };
    const live = resolveStoreRecord(map, { id: 'pat_hogan', _id: 'pat_hogan' });
    expect(live.first_name).toBe('Melford');
    expect(live._id).toBe('rec_p1');
  });
});

describe('normalizeFileRecord', () => {
  it('unwraps the { id, fields } wire shape and keeps rec_id when fields.id is null', () => {
    const f = normalizeFileRecord({
      id: 'rec_x',
      fields: { id: null, file_name: 'a.pdf', patient_id: 'pat_hogan' },
    });
    expect(f._id).toBe('rec_x');
    expect(f.file_name).toBe('a.pdf');
  });
});

describe('mergeFileLists', () => {
  it('keeps a side-preview file that the list fetch missed', () => {
    const merged = mergeFileLists(
      [],
      [{ _id: 'rec_open', file_name: 'open.pdf', r2_key: 'k' }],
    );
    expect(merged.map((f) => f.file_name)).toEqual(['open.pdf']);
  });
});
