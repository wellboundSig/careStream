/**
 * CareStream duplicate merge: plan + execute.
 * Survivor keeps farther-ahead stage and its ref_/pat_ ids.
 * Loser is discarded as Duplicate referral; patient deactivated.
 */

import { getFilesByPatient, updateFile } from '../api/patientFiles.js';
import { getNotesByPatient, updateNote } from '../api/notes.js';
import { getInsurancesByPatient, updatePatientInsurance } from '../api/patientInsurances.js';
import { getPatientGuardians, updatePatientGuardian } from '../api/knownGuardians.js';
import { getTriageAdult, getTriagePediatric } from '../api/triage.js';
import { getTasksByPatient, updateTask } from '../api/tasks.js';
import { getConflictsByPatient, updateConflict } from '../api/conflicts.js';
import { getAuthorizationsByReferral, updateAuthorization } from '../api/authorizations.js';
import {
  getVerificationsByPatient,
  updateEligibilityVerification,
} from '../api/eligibilityVerifications.js';
import { getChecksByPatient } from '../api/insuranceChecks.js';
import { updatePatient } from '../api/patients.js';
import { updateReferral } from '../api/referrals.js';
import { recordActivity } from '../api/activityLog.js';
import { createNoteOptimistic } from '../store/mutations.js';
import { discardReferral } from './discardReferral.js';
import { syncPatientInsurances } from '../api/syncPatientInsurances.js';
import {
  getInsurancePlans,
  getInsuranceDetailsMap,
  memberIdFromDetail,
} from './insuranceDetails.js';

/** Farther ahead = higher index. Hold/Conflict mid-pipeline. Terminals unmergeable. */
export const PIPELINE_STAGE_RANK = [
  'Clinical Lead Pre-Check',
  'Lead Entry',
  'Intake',
  'Eligibility Verification',
  'OPWDD Enrollment',
  'Disenrollment Required',
  'F2F/MD Orders Pending',
  'Clinical Intake RN Review',
  'Authorization Pending',
  'Conflict',
  'Hold',
  'EMR Onboarding',
  'Staffing Feasibility',
  'Admin Confirmation',
  'Pre-SOC',
  'SOC Scheduled',
  'SOC Completed',
  'Post Visit Intake',
  'Post Visit Clinical Review',
  'Completed',
];

const UNMERGEABLE = new Set(['Discarded Leads', 'NTUC']);

export const PATIENT_MERGE_FIELDS = [
  { key: 'first_name', label: 'First name', entity: 'patient' },
  { key: 'last_name', label: 'Last name', entity: 'patient' },
  { key: 'dob', label: 'Date of birth', entity: 'patient' },
  { key: 'phone_primary', label: 'Primary phone', entity: 'patient' },
  { key: 'phone_secondary', label: 'Secondary phone', entity: 'patient' },
  { key: 'email', label: 'Email', entity: 'patient' },
  { key: 'address_street', label: 'Street', entity: 'patient' },
  { key: 'address_city', label: 'City', entity: 'patient' },
  { key: 'address_state', label: 'State', entity: 'patient' },
  { key: 'address_zip', label: 'ZIP', entity: 'patient' },
  { key: 'gender', label: 'Gender', entity: 'patient' },
  { key: 'language_code', label: 'Language', entity: 'patient' },
  { key: 'primary_contact_name', label: 'Primary contact name', entity: 'patient' },
  { key: 'primary_contact_phone', label: 'Primary contact phone', entity: 'patient' },
  { key: 'primary_contact_relationship', label: 'Primary contact relationship', entity: 'patient' },
  { key: 'emergency_contact_name', label: 'Emergency contact name', entity: 'patient' },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', entity: 'patient' },
  { key: 'emergency_contact_relationship', label: 'Emergency contact relationship', entity: 'patient' },
  { key: 'emergency_contact_email', label: 'Emergency contact email', entity: 'patient' },
];

export const REFERRAL_MERGE_FIELDS = [
  { key: 'division', label: 'Division', entity: 'referral' },
  { key: 'referral_source_id', label: 'Referral source', entity: 'referral' },
  { key: 'referral_method', label: 'Referral method', entity: 'referral' },
  { key: 'facility_id', label: 'Facility', entity: 'referral' },
  { key: 'physician_id', label: 'Physician', entity: 'referral' },
  { key: 'marketer_id', label: 'Marketer', entity: 'referral' },
  { key: 'intake_owner_id', label: 'Intake owner', entity: 'referral' },
  { key: 'entity_id', label: 'Entity / licence', entity: 'referral' },
  { key: 'services', label: 'Services', entity: 'referral' },
];

export function stageRank(stage) {
  if (!stage) return -1;
  if (UNMERGEABLE.has(stage)) return -100;
  const i = PIPELINE_STAGE_RANK.indexOf(stage);
  return i >= 0 ? i : 0;
}

export function isMergeableReferral(r) {
  if (!r?._id || !r.patient_id) return false;
  if (UNMERGEABLE.has(r.current_stage)) return false;
  if (r.emr_onboarded_at || r.emr_initial_onboarded_at) return false;
  return stageRank(r.current_stage) >= 0
    && stageRank(r.current_stage) < stageRank('EMR Onboarding');
}

export function normalizeFieldValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(', ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim();
}

function valuesDiffer(a, b) {
  return normalizeFieldValue(a).toLowerCase() !== normalizeFieldValue(b).toLowerCase();
}

function isFilled(v) {
  return normalizeFieldValue(v).length > 0;
}

function referralCreatedMs(r) {
  return Date.parse(r?.created_at || r?.updated_at || r?.referral_date || '') || 0;
}

function richnessScore(r, ctx) {
  let n = 0;
  if (r.emr_onboarded_at || r.emr_initial_onboarded_at) n += 100;
  if (ctx) {
    n += (ctx.files || 0) * 3;
    n += (ctx.notes || 0) * 2;
    n += (ctx.insurances || 0) * 2;
    n += ctx.hasTriage ? 5 : 0;
  }
  if (r.clinical_review_completed_at) n += 4;
  if (r.eligibility_completed_at) n += 3;
  return n;
}

/**
 * Pick survivor (farther ahead). Tie-break: richer work, then oldest.
 * @returns {{ survivor: object, loser: object }}
 */
export function pickSurvivor(a, b, contextByPatientId = {}) {
  const rankA = stageRank(a.current_stage);
  const rankB = stageRank(b.current_stage);
  if (rankA !== rankB) {
    return rankA > rankB
      ? { survivor: a, loser: b }
      : { survivor: b, loser: a };
  }
  const richA = richnessScore(a, contextByPatientId[a.patient_id]);
  const richB = richnessScore(b, contextByPatientId[b.patient_id]);
  if (richA !== richB) {
    return richA > richB
      ? { survivor: a, loser: b }
      : { survivor: b, loser: a };
  }
  const tA = referralCreatedMs(a);
  const tB = referralCreatedMs(b);
  return tA <= tB
    ? { survivor: a, loser: b }
    : { survivor: b, loser: a };
}

function fieldSide(referral, field) {
  if (field.entity === 'patient') return referral?.patient?.[field.key];
  return referral?.[field.key];
}

function classifyPair(aVal, bVal) {
  const aFilled = isFilled(aVal);
  const bFilled = isFilled(bVal);
  if (!aFilled && !bFilled) return 'empty';
  if (aFilled && bFilled && valuesDiffer(aVal, bVal)) return 'conflict';
  if (aFilled && bFilled) return 'same';
  return 'auto'; // one side only
}

/**
 * Pure plan from two referral+patient snapshots (no network).
 */
export function buildMergePlan(referralA, referralB, options = {}) {
  if (!referralA?._id || !referralB?._id) {
    throw new Error('Both referrals are required');
  }
  if (referralA.patient_id === referralB.patient_id) {
    throw new Error('Referrals already share the same patient');
  }
  if (!isMergeableReferral(referralA) || !isMergeableReferral(referralB)) {
    throw new Error('One or both charts are not eligible to merge');
  }

  const contextByPatientId = options.contextByPatientId || {};
  const { survivor, loser } = pickSurvivor(referralA, referralB, contextByPatientId);

  const conflicts = [];
  const autoFills = [];
  const same = [];

  for (const field of [...PATIENT_MERGE_FIELDS, ...REFERRAL_MERGE_FIELDS]) {
    const sVal = fieldSide(survivor, field);
    const lVal = fieldSide(loser, field);
    const kind = classifyPair(sVal, lVal);
    const row = {
      key: field.key,
      label: field.label,
      entity: field.entity,
      survivorValue: sVal,
      loserValue: lVal,
      kind,
    };
    if (kind === 'conflict') conflicts.push(row);
    else if (kind === 'auto') {
      autoFills.push({
        ...row,
        takeFrom: isFilled(sVal) ? 'survivor' : 'loser',
        value: isFilled(sVal) ? sVal : lVal,
      });
    } else if (kind === 'same') same.push(row);
  }

  // Insurance CIN conflicts (per plan name)
  const sPlans = getInsurancePlans(survivor.patient || {});
  const lPlans = getInsurancePlans(loser.patient || {});
  const sDetails = getInsuranceDetailsMap(survivor.patient || {});
  const lDetails = getInsuranceDetailsMap(loser.patient || {});
  const allPlans = [...new Set([...sPlans, ...lPlans])];
  const insuranceConflicts = [];
  const insuranceAuto = [];
  for (const plan of allPlans) {
    const sMid = memberIdFromDetail(sDetails[plan]);
    const lMid = memberIdFromDetail(lDetails[plan]);
    if (sMid && lMid && sMid.toLowerCase() !== lMid.toLowerCase()) {
      insuranceConflicts.push({
        key: `insurance:${plan}`,
        label: `${plan} member ID`,
        entity: 'insurance',
        plan,
        survivorValue: sMid,
        loserValue: lMid,
        kind: 'conflict',
      });
    } else if ((!sMid && lMid) || (sMid && !lMid) || (sMid && lMid)) {
      insuranceAuto.push({
        plan,
        memberId: sMid || lMid,
        takeFrom: sMid ? 'survivor' : 'loser',
      });
    } else if (!sPlans.includes(plan) && lPlans.includes(plan)) {
      insuranceAuto.push({ plan, memberId: lMid, takeFrom: 'loser' });
    }
  }

  const sCtx = contextByPatientId[survivor.patient_id] || {};
  const lCtx = contextByPatientId[loser.patient_id] || {};

  const unions = [
    {
      key: 'files',
      label: 'Files',
      survivorCount: sCtx.files || 0,
      loserCount: lCtx.files || 0,
      combined: (sCtx.files || 0) + (lCtx.files || 0),
    },
    {
      key: 'notes',
      label: 'Notes',
      survivorCount: sCtx.notes || 0,
      loserCount: lCtx.notes || 0,
      combined: (sCtx.notes || 0) + (lCtx.notes || 0),
    },
    {
      key: 'insurances',
      label: 'Insurance plans',
      survivorCount: sCtx.insurances || Math.max(sPlans.length, 0),
      loserCount: lCtx.insurances || Math.max(lPlans.length, 0),
      combined: allPlans.length,
    },
  ];

  return {
    survivor,
    loser,
    survivorStage: survivor.current_stage,
    conflicts: [...conflicts, ...insuranceConflicts],
    autoFills,
    same,
    insuranceAuto,
    unions,
    triage: {
      survivorHas: !!sCtx.hasTriage,
      loserHas: !!lCtx.hasTriage,
    },
  };
}

async function safeCount(fn) {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

async function hasTriage(referralId) {
  if (!referralId) return false;
  try {
    const [a, p] = await Promise.all([
      getTriageAdult(referralId),
      getTriagePediatric(referralId),
    ]);
    return (a?.length || 0) + (p?.length || 0) > 0;
  } catch {
    return false;
  }
}

/** Load file/note/insurance/triage counts for both patients. */
export async function loadMergeContext(referralA, referralB) {
  const ids = [referralA?.patient_id, referralB?.patient_id].filter(Boolean);
  const contextByPatientId = {};
  await Promise.all(ids.map(async (pid) => {
    const ref = pid === referralA.patient_id ? referralA : referralB;
    const [files, notes, insurances, triage] = await Promise.all([
      safeCount(() => getFilesByPatient(pid)),
      safeCount(() => getNotesByPatient(pid)),
      safeCount(() => getInsurancesByPatient(pid)),
      hasTriage(ref.id),
    ]);
    contextByPatientId[pid] = {
      files,
      notes,
      insurances,
      hasTriage: triage,
    };
  }));
  return contextByPatientId;
}

function noteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function buildPatientPatch(survivor, loser, choices) {
  const patch = {};
  for (const field of PATIENT_MERGE_FIELDS) {
    const sVal = survivor.patient?.[field.key];
    const lVal = loser.patient?.[field.key];
    const choice = choices[field.key];
    if (choice === 'loser') patch[field.key] = lVal;
    else if (choice === 'survivor') {
      if (isFilled(sVal)) patch[field.key] = sVal;
    } else if (!isFilled(sVal) && isFilled(lVal)) {
      patch[field.key] = lVal;
    }
  }
  return patch;
}

function buildReferralPatch(survivor, loser, choices) {
  const patch = {};
  for (const field of REFERRAL_MERGE_FIELDS) {
    const sVal = survivor[field.key];
    const lVal = loser[field.key];
    const choice = choices[field.key];
    if (choice === 'loser') patch[field.key] = lVal;
    else if (choice === 'survivor') {
      if (isFilled(sVal)) patch[field.key] = sVal;
    } else if (!isFilled(sVal) && isFilled(lVal)) {
      patch[field.key] = lVal;
    }
  }
  return patch;
}

function buildMergedInsurance(survivor, loser, choices) {
  const sPlans = getInsurancePlans(survivor.patient || {});
  const lPlans = getInsurancePlans(loser.patient || {});
  const sDetails = getInsuranceDetailsMap(survivor.patient || {});
  const lDetails = getInsuranceDetailsMap(loser.patient || {});
  const plans = [...new Set([...sPlans, ...lPlans])];
  const details = {};
  for (const plan of plans) {
    const key = `insurance:${plan}`;
    const choice = choices[key];
    const sMid = memberIdFromDetail(sDetails[plan]);
    const lMid = memberIdFromDetail(lDetails[plan]);
    if (choice === 'loser') details[plan] = lMid;
    else if (choice === 'survivor') details[plan] = sMid;
    else details[plan] = sMid || lMid;
  }
  return { plans, details, primary: plans[0] || '' };
}

async function repointRecords(list, updateFn, fieldsFn) {
  const results = { ok: 0, failed: 0 };
  for (const row of list) {
    const id = row._id || row.id;
    if (!id) continue;
    try {
      await updateFn(id, fieldsFn(row));
      results.ok += 1;
    } catch (err) {
      console.warn('[merge] re-point failed', id, err?.message || err);
      results.failed += 1;
    }
  }
  return results;
}

/**
 * Execute confirmed merge. Does not discard loser until re-points finish.
 */
export async function executeMerge({
  survivor: survivorIn,
  loser: loserIn,
  choices = {},
  actorUserId,
  onProgress,
} = {}) {
  const survivor = survivorIn;
  const loser = loserIn;
  if (!survivor?._id || !loser?._id) throw new Error('Survivor and loser required');
  if (!isMergeableReferral(survivor) || !isMergeableReferral(loser)) {
    throw new Error('Charts are not eligible to merge');
  }

  const progress = (step, detail) => {
    try { onProgress?.({ step, detail }); } catch { /* ignore */ }
  };

  const survivorPatientRecId = survivor.patient?._id;
  const loserPatientRecId = loser.patient?._id;
  const survivorPatBiz = survivor.patient_id;
  const loserPatBiz = loser.patient_id;
  const survivorRefBiz = survivor.id;
  const loserRefBiz = loser.id;

  if (!survivorPatientRecId || !loserPatientRecId) {
    throw new Error('Patient record ids missing. Open both charts once, then retry.');
  }

  progress('patient', 'Updating survivor demographics');
  const patientPatch = buildPatientPatch(survivor, loser, choices);
  const insurance = buildMergedInsurance(survivor, loser, choices);
  if (insurance.plans.length) {
    patientPatch.insurance_plans = JSON.stringify(insurance.plans);
    patientPatch.insurance_plan_details = JSON.stringify(insurance.details);
    patientPatch.insurance_plan = insurance.primary;
  }
  patientPatch.updated_at = new Date().toISOString();
  if (Object.keys(patientPatch).length > 1) {
    await updatePatient(survivorPatientRecId, patientPatch);
  }

  progress('referral', 'Updating survivor referral fields');
  const referralPatch = buildReferralPatch(survivor, loser, choices);
  referralPatch.updated_at = new Date().toISOString();
  if (Object.keys(referralPatch).length > 1) {
    await updateReferral(survivor._id, referralPatch);
  }

  progress('files', 'Moving files');
  let loserFiles = [];
  try {
    loserFiles = (await getFilesByPatient(loserPatBiz)).map((r) => ({ _id: r.id, ...r.fields }));
  } catch { /* empty */ }
  await repointRecords(loserFiles, updateFile, () => ({
    patient_id: survivorPatBiz,
    referral_id: survivorRefBiz,
  }));

  progress('notes', 'Moving notes');
  let loserNotes = [];
  try {
    loserNotes = (await getNotesByPatient(loserPatBiz)).map((r) => ({ _id: r.id, ...r.fields }));
  } catch { /* empty */ }
  await repointRecords(loserNotes, updateNote, () => ({
    patient_id: survivorPatBiz,
    referral_id: survivorRefBiz,
  }));

  progress('insurance', 'Combining insurance');
  try {
    await syncPatientInsurances({
      patientRecordId: survivorPatientRecId,
      patientBusinessId: survivorPatBiz,
      plans: insurance.plans,
      details: insurance.details,
      enteredFrom: 'merge',
    });
  } catch (err) {
    console.warn('[merge] insurance sync failed', err);
  }
  // Soft-retire loser insurance rows (stop showing under deactivated patient)
  try {
    const loserIns = (await getInsurancesByPatient(loserPatBiz, { includeInactive: true }))
      .map((r) => ({ _id: r.id, ...r.fields }));
    const today = new Date().toISOString().slice(0, 10);
    await repointRecords(loserIns, updatePatientInsurance, () => ({
      is_active_raw: false,
      termination_date: today,
      updated_at: new Date().toISOString(),
    }));
  } catch { /* non-fatal */ }

  progress('guardians', 'Moving contacts');
  try {
    const links = (await getPatientGuardians({
      filterByFormula: `{patient_id} = "${loserPatBiz}"`,
    })).map((r) => ({ _id: r.id, ...r.fields }));
    await repointRecords(links, updatePatientGuardian, () => ({
      patient_id: survivorPatBiz,
    }));
  } catch { /* non-fatal */ }

  progress('linked', 'Moving tasks and related records');
  try {
    const tasks = (await getTasksByPatient(loserPatBiz)).map((r) => ({ _id: r.id, ...r.fields }));
    await repointRecords(tasks, updateTask, () => ({
      patient_id: survivorPatBiz,
      referral_id: survivorRefBiz,
    }));
  } catch { /* non-fatal */ }
  try {
    const conflicts = (await getConflictsByPatient(loserPatBiz)).map((r) => ({ _id: r.id, ...r.fields }));
    await repointRecords(conflicts, updateConflict, () => ({
      patient_id: survivorPatientRecId,
      referral_id: survivorRefBiz,
    }));
  } catch { /* non-fatal */ }
  try {
    if (loserRefBiz) {
      const auths = (await getAuthorizationsByReferral(loserRefBiz)).map((r) => ({ _id: r.id, ...r.fields }));
      await repointRecords(auths, updateAuthorization, () => ({
        patient_id: survivorPatientRecId,
        referral_id: survivorRefBiz,
      }));
    }
  } catch { /* non-fatal */ }
  try {
    const vers = (await getVerificationsByPatient(loserPatBiz)).map((r) => ({ _id: r.id, ...r.fields }));
    await repointRecords(vers, updateEligibilityVerification, () => ({
      patient_id: survivorPatBiz,
    }));
  } catch { /* non-fatal */ }
  try {
    // InsuranceChecks may not expose update; best-effort skip
    await getChecksByPatient(loserPatBiz);
  } catch { /* ignore */ }

  // Triage: if only loser has it, leave on loser (audit) but note on survivor
  progress('triage', 'Checking triage');
  let triageNote = '';
  try {
    const [sA, sP, lA, lP] = await Promise.all([
      getTriageAdult(survivorRefBiz),
      getTriagePediatric(survivorRefBiz),
      getTriageAdult(loserRefBiz),
      getTriagePediatric(loserRefBiz),
    ]);
    const survivorTriage = (sA?.length || 0) + (sP?.length || 0) > 0;
    const loserTriage = (lA?.length || 0) + (lP?.length || 0) > 0;
    if (loserTriage && !survivorTriage) {
      triageNote = 'Loser chart had triage; open discarded chart if you need that form. Survivor had none.';
    } else if (loserTriage && survivorTriage) {
      triageNote = 'Both charts had triage. Survivor triage kept.';
    }
  } catch { /* ignore */ }

  progress('note', 'Writing merge summary');
  const choiceLines = Object.entries(choices)
    .filter(([, v]) => v === 'survivor' || v === 'loser')
    .map(([k, v]) => `${k}: kept ${v}`);
  const summary = [
    `Merged duplicate chart into this referral.`,
    `From: ${loserRefBiz || loser._id} / ${loserPatBiz}`,
    `Stage kept: ${survivor.current_stage}`,
    `Files moved: ${loserFiles.length}. Notes moved: ${loserNotes.length}.`,
    triageNote,
    choiceLines.length ? `Choices: ${choiceLines.join('; ')}` : 'No field conflicts.',
  ].filter(Boolean).join('\n');

  try {
    await createNoteOptimistic({
      id: noteId(),
      patient_id: survivorPatBiz,
      referral_id: survivorRefBiz,
      author_id: actorUserId || 'system',
      content: summary,
      created_at: new Date().toISOString(),
      is_pinned: true,
    });
  } catch (err) {
    console.warn('[merge] note failed', err);
  }

  try {
    await recordActivity({
      actorUserId: actorUserId || 'system',
      action: 'referral_merged',
      patientId: survivorPatBiz,
      referralId: survivorRefBiz,
      detail: `Merged ${loserRefBiz} into ${survivorRefBiz}`,
      metadata: {
        loserReferralId: loserRefBiz,
        loserPatientId: loserPatBiz,
        survivorReferralId: survivorRefBiz,
        survivorPatientId: survivorPatBiz,
        choices,
      },
    });
  } catch { /* non-fatal */ }

  progress('discard', 'Retiring duplicate chart');
  const discardResult = await discardReferral({
    referral: loser,
    reason: 'Duplicate referral',
    explanation: `Merged into ${survivorRefBiz} / ${survivorPatBiz}`,
    actorUserId,
  });
  if (!discardResult.ok) {
    throw new Error(discardResult.reason || 'Could not discard duplicate referral');
  }

  progress('deactivate', 'Deactivating duplicate patient');
  await updatePatient(loserPatientRecId, {
    is_active: 'FALSE',
    updated_at: new Date().toISOString(),
  });

  progress('done', 'Merge complete');
  return {
    survivor,
    loser,
    patientPatch,
    referralPatch,
    filesMoved: loserFiles.length,
    notesMoved: loserNotes.length,
  };
}

/** True when every conflict key has a choice of survivor|loser. */
export function allConflictsResolved(conflicts, choices) {
  if (!conflicts?.length) return true;
  return conflicts.every((c) => choices[c.key] === 'survivor' || choices[c.key] === 'loser');
}
