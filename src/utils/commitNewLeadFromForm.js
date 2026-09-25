import { createPatient, updatePatient } from '../api/patients.js';
import { createReferral } from '../api/referrals.js';
import { createNoteOptimistic } from '../store/mutations.js';
import { syncPatientInsurances } from '../api/syncPatientInsurances.js';
import { serializeUrgentCareTypes } from './urgentCare.js';
import { openCaseForReferral } from '../store/opwddOrchestration.js';
import { mergeEntities } from '../store/careStore.js';
import { defaultLeadStage } from './clinicalLeadPreCheck.js';
import { DEFAULT_LANGUAGE_CODE } from '../data/languages.js';
import { createReferralSource } from '../api/referralSources.js';
import {
  sanitizeSourceName,
  isSourceBusinessId,
  isPlausibleSourceLabel,
  UNKNOWN_SOURCE_ID,
} from './sourceName.js';
import {
  normalizePersonNameFields,
  normalizeContactName,
} from './personName.js';
import { savePatientContactSlot } from './knownGuardians.js';
import { splitContactNameAndRelationship } from '../data/guardianRelationships.js';
import { normalizeEpisodeType } from './episodeType.js';

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create patient + referral from a New Lead form snapshot.
 * `at` stamps created_at / referral_date (go-live time for scheduled leads).
 */
export async function commitNewLeadFromForm({
  form,
  appUserId,
  sources = [],
  forceStage = null,
  selectedPhysician = null,
  at = null,
  orphanPatient = null,
}) {
  const referralDate = at || new Date().toISOString();
  const patientCustomId = orphanPatient?.businessId || generateId('pat');
  const referralCustomId = generateId('ref');

  const insurancePrimary = form.insurance_plans?.[0] || '';
  const allInsuranceJson = form.insurance_plans?.length > 0 ? JSON.stringify(form.insurance_plans) : '';
  const planDetailsJson = Object.keys(form.insurance_plan_details || {}).length > 0
    ? JSON.stringify(form.insurance_plan_details)
    : '';

  const named = normalizePersonNameFields({
    first_name: form.first_name,
    last_name: form.last_name,
  });

  const resolvedPrimaryPhone = form.emergency_contact_phone || form.phone_primary || form.phone_secondary || '';
  const resolvedPrimaryEmail = (form.emergency_contact_email || '').trim();
  const resolvedPrimaryName = form.emergency_contact_name || form.primary_contact_name || '';
  const resolvedPrimaryRel = form.emergency_contact_relationship || form.primary_contact_relationship || '';
  const primaryParsed = splitContactNameAndRelationship(resolvedPrimaryName);
  const emergencyParsed = primaryParsed;
  const emergencyPhone = resolvedPrimaryPhone;
  const emergencyEmail = resolvedPrimaryEmail;
  const emergencyRel = resolvedPrimaryRel;

  const patientFields = {
    id: patientCustomId,
    first_name: named.first_name,
    last_name: named.last_name,
    phone_primary: (form.phone_primary || '').trim(),
    insurance_plan: insurancePrimary,
    division: form.division,
    is_active: 'TRUE',
    created_at: referralDate,
    updated_at: referralDate,
    ...(allInsuranceJson && { insurance_plans: allInsuranceJson }),
    ...(planDetailsJson && { insurance_plan_details: planDetailsJson }),
    ...(form.county && { county: form.county }),
    ...(form.dob && { dob: form.dob }),
    ...(form.gender && { gender: form.gender }),
    preferred_language: form.preferred_language || DEFAULT_LANGUAGE_CODE,
    ...(form.phone_secondary && { phone_secondary: form.phone_secondary }),
    ...(form.email && { email: form.email }),
    ...(form.address_street && { address_street: form.address_street }),
    ...(form.address_city && { address_city: form.address_city }),
    ...(form.address_state && { address_state: form.address_state }),
    ...(form.address_zip && { address_zip: form.address_zip }),
    ...(primaryParsed.cleanName && {
      primary_contact_name: normalizeContactName(primaryParsed.cleanName),
    }),
    ...(resolvedPrimaryPhone && { primary_contact_phone: resolvedPrimaryPhone }),
    ...(resolvedPrimaryEmail && { primary_contact_email: resolvedPrimaryEmail }),
    ...((resolvedPrimaryRel || primaryParsed.relationship) && {
      primary_contact_relationship: resolvedPrimaryRel || primaryParsed.relationship,
    }),
    ...(emergencyParsed.cleanName && {
      emergency_contact_name: normalizeContactName(emergencyParsed.cleanName),
    }),
    ...(emergencyPhone && { emergency_contact_phone: emergencyPhone }),
    ...(emergencyEmail && { emergency_contact_email: emergencyEmail }),
    ...((emergencyRel || emergencyParsed.relationship) && {
      emergency_contact_relationship: emergencyRel || emergencyParsed.relationship,
    }),
  };

  let patientRecord;
  if (orphanPatient?.recId) {
    const updated = await updatePatient(orphanPatient.recId, patientFields);
    patientRecord = updated?.id
      ? updated
      : { id: orphanPatient.recId, fields: { ...orphanPatient.fields, ...patientFields } };
  } else {
    patientRecord = await createPatient(patientFields);
  }
  const createdPatientId = patientRecord.fields?.id || patientCustomId;
  const nextOrphan = {
    recId: patientRecord.id,
    businessId: createdPatientId,
    fields: patientRecord.fields || patientFields,
  };

  const primaryName = primaryParsed.cleanName || resolvedPrimaryName;
  const primaryPhone = resolvedPrimaryPhone;
  if (primaryName || primaryPhone) {
    savePatientContactSlot({
      patientBusinessId: createdPatientId,
      patientRecordId: patientRecord.id,
      slot: 'primary',
      name: primaryName,
      phone: primaryPhone,
      email: resolvedPrimaryEmail,
      relationship: resolvedPrimaryRel || primaryParsed.relationship || '',
      source: 'new_referral',
    }).catch((err) => console.warn('New referral: primary guardian sync failed', err));
  }
  const emergencyName = form.emergency_same_as_primary
    ? (primaryName || form.emergency_contact_name)
    : form.emergency_contact_name;
  const emergencyPhoneForSync = form.emergency_same_as_primary
    ? (primaryPhone || form.emergency_contact_phone)
    : form.emergency_contact_phone;
  if (emergencyName || emergencyPhoneForSync) {
    savePatientContactSlot({
      patientBusinessId: createdPatientId,
      patientRecordId: patientRecord.id,
      slot: 'emergency',
      name: emergencyName,
      phone: emergencyPhoneForSync,
      email: form.emergency_same_as_primary
        ? resolvedPrimaryEmail
        : form.emergency_contact_email,
      relationship: form.emergency_same_as_primary
        ? (form.emergency_contact_relationship || resolvedPrimaryRel || primaryParsed.relationship)
        : form.emergency_contact_relationship,
      source: 'new_referral',
    }).catch((err) => console.warn('New referral: emergency guardian sync failed', err));
  }

  if (form.insurance_plans?.length > 0) {
    try {
      const syncResult = await syncPatientInsurances({
        patientRecordId: patientRecord.id,
        patientBusinessId: createdPatientId,
        plans: form.insurance_plans,
        details: form.insurance_plan_details,
        enteredFrom: 'referral',
      });
      if (!syncResult?.synced) {
        console.warn('New referral: PatientInsurances sync incomplete', syncResult);
      }
    } catch (err) {
      console.warn('New referral: PatientInsurances sync failed', err);
    }
  }

  const resolvedMarketer = form.marketer_id === 'other'
    ? (form.marketer_other || '').trim()
    : form.marketer_id;

  let resolvedSource = form.referral_source_id;
  let otherSourceNote = '';
  if (form.referral_source_id === 'other') {
    const rawOther = (form.referral_source_other || '').trim();
    const safeName = sanitizeSourceName(rawOther);
    if (!safeName) throw new Error('Invalid referral source name');
    if (isPlausibleSourceLabel(safeName)) {
      const srcId = `src_${Date.now().toString(36)}`;
      const srcRec = await createReferralSource({
        id: srcId,
        name: safeName,
        type: 'Other',
        is_active: true,
        created_at: referralDate,
        updated_at: referralDate,
      });
      resolvedSource = srcRec.fields?.id || srcId;
      try {
        mergeEntities('referralSources', {
          [srcRec.id]: { _id: srcRec.id, ...srcRec.fields, id: resolvedSource },
        });
      } catch { /* non-fatal */ }
      if (rawOther !== safeName) {
        otherSourceNote = `Original "Other" source text: ${rawOther}`;
      }
    } else {
      resolvedSource = UNKNOWN_SOURCE_ID;
      otherSourceNote = `Referral source details (Other): ${rawOther}`;
    }
  } else if (!isSourceBusinessId(resolvedSource)
    && !sources.some((s) => s.id === resolvedSource)) {
    throw new Error('Referral source must be selected from the directory');
  }

  let stage = defaultLeadStage({ division: form.division, code_95: form.code_95 });
  if (forceStage === 'Lead Entry' || forceStage === 'Intake') {
    if (!(form.division === 'Special Needs' && form.code_95 === 'no')) {
      stage = forceStage === 'Lead Entry'
        ? defaultLeadStage({ division: form.division, code_95: form.code_95 })
        : forceStage;
    }
  }
  const physician = selectedPhysician || form._physician || null;
  const referralFields = {
    id: referralCustomId,
    patient_id: createdPatientId,
    marketer_id: typeof resolvedMarketer === 'string' ? resolvedMarketer.trim() : resolvedMarketer,
    // Write-once attribution anchor: incentive credit always follows the
    // ORIGINALLY assigned marketer, even if marketer_id is later reassigned.
    original_marketer_id: typeof resolvedMarketer === 'string' ? resolvedMarketer.trim() : resolvedMarketer,
    referral_source_id: resolvedSource,
    ...(form.referral_method ? { referral_method: form.referral_method } : {}),
    current_stage: stage,
    division: form.division,
    episode_type: normalizeEpisodeType(form.episode_type),
    priority: form.requires_urgent_care ? 'High' : 'Normal',
    referral_date: referralDate,
    created_at: referralDate,
    updated_at: referralDate,
    ...(appUserId && { lead_created_by_id: appUserId }),
    ...(form.services_requested?.length && { services_requested: form.services_requested }),
    ...(form.facility_id && { facility_id: form.facility_id }),
    ...(form.coc_nurse_id && { coc_nurse_id: form.coc_nurse_id }),
    ...(appUserId && stage === 'Intake' && {
      intake_owner_id: appUserId,
      intake_owner_changed_at: referralDate,
      intake_owner_changed_by_id: appUserId,
    }),
    ...(physician?.id && { physician_id: physician.id }),
    ...(form.sn_age_group && { sn_age_group: form.sn_age_group }),
    ...(form.entity_id && { entity_id: form.entity_id }),
    ...(form.code_95 && { code_95: form.code_95 }),
    ...(form.requires_urgent_care ? {
      requires_urgent_care: true,
      urgent_care_type: serializeUrgentCareTypes(form.urgent_care_types),
      urgent_care_marked_at: referralDate,
      ...(appUserId && { urgent_care_marked_by_id: appUserId }),
    } : {}),
  };

  const referralRecord = await createReferral(referralFields);

  mergeEntities('patients', { [patientRecord.id]: { _id: patientRecord.id, ...patientRecord.fields } });
  mergeEntities('referrals', { [referralRecord.id]: { _id: referralRecord.id, ...referralRecord.fields } });

  if (referralFields.current_stage === 'OPWDD Enrollment') {
    openCaseForReferral({
      referral: { id: referralCustomId, _id: referralRecord.id },
      patientId: createdPatientId,
      actorUserId: appUserId,
      assignedSpecialistId: appUserId,
    }).catch((err) => console.warn('Auto-open OPWDD case failed:', err));
  }

  const noteStamp = Date.now();
  const persistLeadNote = async (content, suffix = '') => {
    const text = String(content || '').trim();
    if (!text || !createdPatientId) return;
    const now = new Date().toISOString();
    try {
      await createNoteOptimistic({
        id: `note_${noteStamp}${suffix}_${Math.random().toString(36).slice(2, 6)}`,
        patient_id: createdPatientId,
        referral_id: referralCustomId,
        ...(appUserId ? { author_id: appUserId } : {}),
        content: text,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[commitNewLeadFromForm] Could not save note:', err);
    }
  };
  await persistLeadNote(form.initial_notes);
  await persistLeadNote(otherSourceNote, '_src');

  return {
    patientRecord,
    referralRecord,
    createdPatientId,
    referralCustomId,
    orphanPatient: null,
    nextOrphan,
  };
}
