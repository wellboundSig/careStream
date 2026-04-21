import { describe, it, expect } from 'vitest';
import { uiToDbFields, dbToUiFields } from '../cursoryReviews.js';
import { F2F_REVIEW_CHECKLIST, CURSORY_UI_TO_DB, CURSORY_DB_TO_UI } from '../../data/f2fChecklist.js';

describe('CursoryReview field mapping', () => {
  it('exposes one DB column per checklist item', () => {
    for (const item of F2F_REVIEW_CHECKLIST) {
      expect(item.dbField, `checklist item ${item.key} missing dbField`).toBeTruthy();
    }
    expect(Object.keys(CURSORY_UI_TO_DB)).toHaveLength(F2F_REVIEW_CHECKLIST.length);
    expect(Object.keys(CURSORY_DB_TO_UI)).toHaveLength(F2F_REVIEW_CHECKLIST.length);
  });

  it('maps UI keys to the exact Airtable column names pulled from schema', () => {
    // These are the column names pulled live on 2026-04-21 via
    // `npm run schema`. If any drift, this test fails with a clear pointer.
    expect(CURSORY_UI_TO_DB).toEqual({
      f2f_doc_present:    'face_to_face_document_present',
      md_orders_present:  'physician_certification_present',
      patient_name_match: 'patient_name_matches_referral',
      dates_valid:        'dates_valid_within_90_days',
      physician_signed:   'physician_signature_present',
      diagnosis_listed:   'diagnosis_icd_codes_listed',
      homebound_stated:   'homebound_status_documented',
      services_specified: 'services_disciplines_specified',
    });
  });

  it('round-trips via uiToDbFields -> dbToUiFields', () => {
    const ui = { f2f_doc_present: true, md_orders_present: false, patient_name_match: true, dates_valid: true };
    const db = uiToDbFields(ui);
    const back = dbToUiFields(db);
    // Only true values survive the round trip (checkbox semantics).
    expect(back).toEqual({ f2f_doc_present: true, patient_name_match: true, dates_valid: true });
    // Original false values are not carried forward — this matches how
    // Airtable omits unchecked boxes and what the UI expects (undefined === unchecked).
    expect(back.md_orders_present).toBeUndefined();
  });

  it('coerces "true" string from form state to boolean true', () => {
    const db = uiToDbFields({ f2f_doc_present: 'true', md_orders_present: true });
    expect(db.face_to_face_document_present).toBe(true);
    expect(db.physician_certification_present).toBe(true);
  });

  it('ignores unknown UI keys defensively', () => {
    const db = uiToDbFields({ f2f_doc_present: true, bogus_key: true });
    expect(db.face_to_face_document_present).toBe(true);
    expect(Object.keys(db)).toHaveLength(1);
  });

  it('uiToDbFields on empty/null input returns empty object', () => {
    expect(uiToDbFields()).toEqual({});
    expect(uiToDbFields(null)).toEqual({});
    expect(uiToDbFields({})).toEqual({});
  });

  it('dbToUiFields treats only explicit true as checked', () => {
    const out = dbToUiFields({
      face_to_face_document_present: true,
      physician_certification_present: false,
      patient_name_matches_referral: null,
    });
    expect(out).toEqual({ f2f_doc_present: true });
  });
});
