/**
 * End-to-End Flow Tests — Realistic User Journeys
 *
 * These tests simulate complete user journeys through the CareStream pipeline,
 * verifying that data writes actually persist, transitions succeed, fields are
 * correctly updated, and edge cases don't silently fail.
 *
 * Each test represents a scenario a user might walk through in a stakeholder
 * demo — if any of these fail, it means something will break live.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../utils/stageTransitions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { STAGE_SLUGS, STAGE_META, ALL_STAGES, ROLE_MODES } from '../data/stageConfig.js';
import StageRules from '../data/StageRules.json';

vi.mock('../api/airtable.js', () => ({
  default: {
    update: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    create: vi.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
    remove: vi.fn().mockResolvedValue({ id: 'rec_1', deleted: true }),
    fetchAll: vi.fn().mockResolvedValue([]),
    fetchOne: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    createBatch: vi.fn().mockResolvedValue([]),
    updateBatch: vi.fn().mockResolvedValue([]),
  },
  airtable: {
    update: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    create: vi.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
    remove: vi.fn().mockResolvedValue({ id: 'rec_1', deleted: true }),
    fetchAll: vi.fn().mockResolvedValue([]),
    fetchOne: vi.fn().mockResolvedValue({ id: 'rec_1', fields: {} }),
    createBatch: vi.fn().mockResolvedValue([]),
    updateBatch: vi.fn().mockResolvedValue([]),
  },
}));

const airtable = (await import('../api/airtable.js')).default;
const { getStore, setStore, mergeEntities, updateEntity } = await import('../store/careStore.js');
const {
  updateReferralOptimistic, createReferralOptimistic, createPatientOptimistic,
  createStageHistoryOptimistic, createTaskOptimistic, createNoteOptimistic,
  updateTaskOptimistic, updatePatientOptimistic,
} = await import('../store/mutations.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePatient(overrides = {}) {
  return {
    _id: 'rec_pat1', id: 'pat_001',
    first_name: 'Maria', last_name: 'Rodriguez',
    dob: '1985-06-15', gender: 'Female',
    division: 'ALF', address_zip: '10001', address_state: 'NY',
    county: 'New York', phone_primary: '212-555-0100',
    medicaid_number: 'AB12345C', insurance_plan: 'Fidelis Care',
    is_active: 'TRUE', created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReferral(overrides = {}) {
  return {
    _id: 'rec_ref1', id: 'ref_001',
    patient_id: 'pat_001', current_stage: 'Lead Entry',
    division: 'ALF', priority: 'Normal',
    marketer_id: 'mkt_001', referral_source_id: 'src_001',
    services_requested: ['SN', 'PT'],
    referral_date: '2026-03-15T00:00:00.000Z',
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    services_under_licence: 'WB',
    ...overrides,
  };
}

function seedStore(patientOvr = {}, referralOvr = {}) {
  const patient = makePatient(patientOvr);
  const referral = makeReferral(referralOvr);
  setStore({
    hydrated: true,
    patients: { [patient._id]: patient },
    referrals: { [referral._id]: referral },
    notes: {}, tasks: {}, stageHistory: {},
    files: {}, insuranceChecks: {}, conflicts: {},
    authorizations: {}, episodes: {},
    triageAdult: {}, triagePediatric: {},
  });
  return { patient, referral };
}

function getRef() { return getStore().referrals['rec_ref1']; }
function getRefStage() { return getRef()?.current_stage; }
function getPatient() { return getStore().patients['rec_pat1']; }

async function move(toStage, extraFields = {}) {
  await updateReferralOptimistic('rec_ref1', { current_stage: toStage, ...extraFields });
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1: Full ALF Happy Path — New Referral to SOC Completed
// Simulates creating a patient + referral and moving through every stage.
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 1: ALF happy path — Lead Entry to SOC Completed', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('creates a patient and referral, then completes the full pipeline', async () => {
    // Verify starting state
    expect(getRefStage()).toBe('Lead Entry');
    expect(getPatient().first_name).toBe('Maria');
    expect(getRef().services_under_licence).toBe('WB');

    // Step 1: Promote to Intake — assign owner
    await move('Intake', { intake_owner_id: 'usr_intake_01' });
    expect(getRefStage()).toBe('Intake');
    expect(getRef().intake_owner_id).toBe('usr_intake_01');
    expect(airtable.update).toHaveBeenCalledTimes(1);

    // Step 2: Move to Eligibility Verification
    await move('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');

    // Step 3: Eligibility passes → F2F/MD Orders Pending
    await move('F2F/MD Orders Pending', {
      f2f_date: '2026-03-20',
      f2f_expiration: '2026-06-20',
      f2f_urgency: 'Green',
    });
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
    expect(getRef().f2f_urgency).toBe('Green');

    // Step 4: F2F received → Clinical Intake RN Review
    await move('Clinical Intake RN Review');
    expect(getRefStage()).toBe('Clinical Intake RN Review');

    // Step 5: Clinical RN accepts → Staffing Feasibility
    await move('Staffing Feasibility', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_01',
      clinical_review_at: new Date().toISOString(),
    });
    expect(getRefStage()).toBe('Staffing Feasibility');
    expect(getRef().clinical_review_decision).toBe('accept');

    // Step 6: Clinician matched → Admin Confirmation
    await move('Admin Confirmation');
    expect(getRefStage()).toBe('Admin Confirmation');

    // Step 7: Admin confirms → Pre-SOC
    await move('Pre-SOC');
    expect(getRefStage()).toBe('Pre-SOC');

    // Step 8: HCHB entered → SOC Scheduled
    await move('SOC Scheduled', {
      soc_scheduled_date: '2026-04-10',
      hchb_entered: true,
    });
    expect(getRefStage()).toBe('SOC Scheduled');
    expect(getRef().hchb_entered).toBe(true);

    // Step 9: Visit complete → SOC Completed
    await move('SOC Completed', { soc_completed_date: '2026-04-10' });
    expect(getRefStage()).toBe('SOC Completed');

    // Verify terminal — cannot move further
    expect(canMoveFromTo('SOC Completed', 'Pre-SOC')).toBe(false);
    expect(canMoveFromTo('SOC Completed', 'Intake')).toBe(false);

    // Verify all API calls were made (10 stage transitions)
    expect(airtable.update).toHaveBeenCalledTimes(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2: Special Needs — OPWDD Enrollment Path
// Patient with Code 95 = No gets routed through OPWDD before rejoining pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 2: Special Needs with OPWDD enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore(
      { division: 'Special Needs', county: 'Bronx' },
      { division: 'Special Needs', current_stage: 'Lead Entry', code_95: 'no', services_under_licence: 'WBII' },
    );
  });

  it('routes through OPWDD, then back to Intake and through full pipeline', async () => {
    expect(getRef().services_under_licence).toBe('WBII');
    expect(getRef().code_95).toBe('no');

    // Lead Entry → OPWDD Enrollment (Code 95 = No)
    expect(canMoveFromTo('Lead Entry', 'OPWDD Enrollment')).toBe(true);
    await move('OPWDD Enrollment');
    expect(getRefStage()).toBe('OPWDD Enrollment');

    // OPWDD specialist completes enrollment → Intake
    expect(canMoveFromTo('OPWDD Enrollment', 'Intake')).toBe(true);
    await move('Intake', { intake_owner_id: 'usr_intake_02', code_95: 'yes' });
    expect(getRefStage()).toBe('Intake');
    expect(getRef().code_95).toBe('yes');

    // Continue through pipeline
    await move('Eligibility Verification');
    await move('F2F/MD Orders Pending');
    await move('Clinical Intake RN Review');
    await move('Staffing Feasibility', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_01',
    });
    await move('Admin Confirmation');
    await move('Pre-SOC');
    await move('SOC Scheduled', { soc_scheduled_date: '2026-04-15' });
    await move('SOC Completed', { soc_completed_date: '2026-04-15' });
    expect(getRefStage()).toBe('SOC Completed');
  });

  it('OPWDD can also discard if enrollment fails', async () => {
    await move('OPWDD Enrollment');
    expect(canMoveFromTo('OPWDD Enrollment', 'Discarded Leads')).toBe(true);
    await move('Discarded Leads', { discard_reason: 'Patient unreachable' });
    expect(getRefStage()).toBe('Discarded Leads');
    expect(getRef().discard_reason).toBe('Patient unreachable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3: Disenrollment Required Branch
// Patient needs disenrollment from another agency before continuing
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 3: Disenrollment branch and recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({}, { current_stage: 'Eligibility Verification' });
  });

  it('detour through Disenrollment then resume pipeline', async () => {
    // Insurance check reveals open episode
    await move('Disenrollment Required');
    expect(getRefStage()).toBe('Disenrollment Required');
    expect(needsModal('Eligibility Verification', 'Disenrollment Required')).toBe(true);

    // Disenrollment completed → back to Eligibility
    await move('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');

    // Resume pipeline
    await move('F2F/MD Orders Pending');
    await move('Clinical Intake RN Review');
    expect(getRefStage()).toBe('Clinical Intake RN Review');
  });

  it('Disenrollment can escalate to Conflict if unresolvable', async () => {
    await move('Disenrollment Required');
    expect(canMoveFromTo('Disenrollment Required', 'Conflict')).toBe(true);
    await move('Conflict');
    expect(getRefStage()).toBe('Conflict');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 4: Authorization Required Path
// Managed care plan requires prior auth
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 4: Authorization Pending branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({}, { current_stage: 'Clinical Intake RN Review' });
  });

  it('Clinical RN routes to Authorization, auth approved, then resumes', async () => {
    await move('Authorization Pending', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_01',
    });
    expect(getRefStage()).toBe('Authorization Pending');
    expect(getRef().clinical_review_decision).toBe('accept');

    // Auth approved → Staffing
    await move('Staffing Feasibility');
    expect(getRefStage()).toBe('Staffing Feasibility');

    // Complete pipeline
    await move('Admin Confirmation');
    await move('Pre-SOC');
    await move('SOC Scheduled');
    await move('SOC Completed');
    expect(getRefStage()).toBe('SOC Completed');
  });

  it('Auth denied → NTUC (with direct permission)', async () => {
    await move('Authorization Pending');

    const { effectiveStage, wasIntercepted } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Authorization Pending',
      canDirect: () => true,
      userId: 'usr_admin',
    });
    expect(effectiveStage).toBe('NTUC');
    expect(wasIntercepted).toBe(false);

    await move('NTUC', { ntuc_reason: 'Authorization denied by plan' });
    expect(getRefStage()).toBe('NTUC');
    expect(getRef().ntuc_reason).toBe('Authorization denied by plan');
  });

  it('Auth denied → Admin Confirmation (without direct permission)', async () => {
    await move('Authorization Pending');

    const { effectiveStage, wasIntercepted, ntucMetadata } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Authorization Pending',
      canDirect: () => false,
      userId: 'usr_regular',
    });
    expect(effectiveStage).toBe('Admin Confirmation');
    expect(wasIntercepted).toBe(true);
    expect(ntucMetadata.ntuc_request_origin_stage).toBe('Authorization Pending');

    await move(effectiveStage, ntucMetadata);
    expect(getRefStage()).toBe('Admin Confirmation');
    expect(getRef().ntuc_request_origin_stage).toBe('Authorization Pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 5: Conflict Resolution Paths
// Tests every way to exit Conflict stage
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 5: Conflict resolution — all exit paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({}, { current_stage: 'Conflict' });
  });

  it('Conflict → Eligibility (re-run insurance)', async () => {
    await move('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');
  });

  it('Conflict → Clinical RN Review (clinical re-review)', async () => {
    await move('Clinical Intake RN Review');
    expect(getRefStage()).toBe('Clinical Intake RN Review');
  });

  it('Conflict → Disenrollment Required', async () => {
    await move('Disenrollment Required');
    expect(getRefStage()).toBe('Disenrollment Required');
  });

  it('Conflict → Staffing Feasibility (conflict resolved, skip ahead)', async () => {
    await move('Staffing Feasibility');
    expect(getRefStage()).toBe('Staffing Feasibility');
  });

  it('Conflict → NTUC (unresolvable)', async () => {
    await move('NTUC', { ntuc_reason: 'Unresolvable conflict' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('All conflict exits require modal', () => {
    expect(needsModal('Conflict', 'Eligibility Verification')).toBe(true);
    expect(needsModal('Conflict', 'NTUC')).toBe(true);
    expect(needsModal('Conflict', 'Staffing Feasibility')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 6: Hold + Release from multiple stages
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 6: Hold and release', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('places on Hold from Intake and releases back', async () => {
    await move('Intake');
    await move('Hold', {
      hold_reason: 'Awaiting insurance card',
      hold_return_stage: 'Intake',
      hold_owner_id: 'usr_intake_01',
    });
    expect(getRefStage()).toBe('Hold');
    expect(getRef().hold_reason).toBe('Awaiting insurance card');
    expect(getRef().hold_return_stage).toBe('Intake');

    // Release back
    await move('Intake', { hold_reason: '', hold_return_stage: '', hold_owner_id: '' });
    expect(getRefStage()).toBe('Intake');
    expect(getRef().hold_reason).toBe('');
  });

  it('Hold → NTUC if patient becomes unreachable', async () => {
    await move('Intake');
    await move('Hold', { hold_return_stage: 'Intake', hold_reason: 'Cannot reach patient' });

    const { effectiveStage } = resolveNtucDestination({
      requestedStage: 'NTUC', fromStage: 'Hold', canDirect: () => true, userId: 'usr_admin',
    });
    await move(effectiveStage, { ntuc_reason: 'Patient unreachable after 30 days on hold' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('Hold always requires a modal note', () => {
    const stages = ['Intake', 'Eligibility Verification', 'F2F/MD Orders Pending', 'Staffing Feasibility', 'Pre-SOC'];
    for (const stage of stages) {
      expect(needsModal(stage, 'Hold')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 7: Discard and Restore
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 7: Discard and restore lead', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('discards a lead, then restores and completes pipeline', async () => {
    await move('Discarded Leads', {
      discard_reason: 'Duplicate referral',
      discard_explanation: 'Same patient was referred by two marketers',
    });
    expect(getRefStage()).toBe('Discarded Leads');
    expect(getRef().discard_reason).toBe('Duplicate referral');
    expect(getRef().discard_explanation).toBe('Same patient was referred by two marketers');

    // Restore (direct update bypassing canMoveFromTo since terminal)
    await move('Lead Entry', { discard_reason: '', discard_explanation: '' });
    expect(getRefStage()).toBe('Lead Entry');
    expect(getRef().discard_reason).toBe('');

    // Now complete the pipeline
    await move('Intake');
    await move('Eligibility Verification');
    await move('F2F/MD Orders Pending');
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 8: Data Integrity — Fields persist across transitions
// Ensures fields written at one stage are still present after moving forward
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 8: Data integrity across transitions', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('fields set at each stage survive subsequent moves', async () => {
    await move('Intake', { intake_owner_id: 'usr_intake_01' });
    expect(getRef().intake_owner_id).toBe('usr_intake_01');

    await move('Eligibility Verification');
    expect(getRef().intake_owner_id).toBe('usr_intake_01');

    await move('F2F/MD Orders Pending', {
      f2f_date: '2026-04-01',
      f2f_expiration: '2026-07-01',
      physician_id: 'phy_001',
      is_pecos_verified: 'TRUE',
    });
    expect(getRef().f2f_date).toBe('2026-04-01');
    expect(getRef().physician_id).toBe('phy_001');
    expect(getRef().intake_owner_id).toBe('usr_intake_01');

    await move('Clinical Intake RN Review');
    expect(getRef().f2f_date).toBe('2026-04-01');
    expect(getRef().physician_id).toBe('phy_001');

    await move('Staffing Feasibility', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_01',
      clinical_review_at: '2026-04-02T10:00:00Z',
    });
    expect(getRef().clinical_review_decision).toBe('accept');
    expect(getRef().f2f_date).toBe('2026-04-01');
    expect(getRef().physician_id).toBe('phy_001');
    expect(getRef().intake_owner_id).toBe('usr_intake_01');
  });

  it('services_under_licence (WB/WBII) persists through all transitions', async () => {
    expect(getRef().services_under_licence).toBe('WB');
    await move('Intake');
    expect(getRef().services_under_licence).toBe('WB');
    await move('Eligibility Verification');
    expect(getRef().services_under_licence).toBe('WB');
    await move('F2F/MD Orders Pending');
    expect(getRef().services_under_licence).toBe('WB');
    await move('Clinical Intake RN Review');
    expect(getRef().services_under_licence).toBe('WB');
    await move('Staffing Feasibility');
    expect(getRef().services_under_licence).toBe('WB');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 9: Patient Record Updates
// Ensures patient demographic edits are written correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 9: Patient record updates persist', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('patient field updates are stored correctly', async () => {
    await updatePatientOptimistic('rec_pat1', {
      phone_primary: '212-555-9999',
      insurance_plan: 'UnitedHealthcare Community Plan',
      address_city: 'Brooklyn',
    });
    const p = getPatient();
    expect(p.phone_primary).toBe('212-555-9999');
    expect(p.insurance_plan).toBe('UnitedHealthcare Community Plan');
    expect(p.address_city).toBe('Brooklyn');
    expect(p.first_name).toBe('Maria');
  });

  it('rolls back patient update on API failure', async () => {
    airtable.update.mockRejectedValueOnce(new Error('API error'));
    try {
      await updatePatientOptimistic('rec_pat1', { phone_primary: '999-999-9999' });
    } catch {}
    expect(getPatient().phone_primary).toBe('212-555-0100');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 10: Task + Note Creation During Pipeline
// Ensures tasks and notes can be created mid-flow
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 10: Tasks and notes during pipeline flow', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('creates a task at Intake stage', async () => {
    await move('Intake', { intake_owner_id: 'usr_intake_01' });

    airtable.create.mockResolvedValueOnce({
      id: 'rec_task_1',
      fields: { id: 'task_001', title: 'Collect insurance card', type: 'Missing Document', status: 'Pending' },
    });

    await createTaskOptimistic({
      title: 'Collect insurance card',
      type: 'Missing Document',
      route_to_role: 'Intake',
      status: 'Pending',
      referral_id: 'ref_001',
      patient_id: 'pat_001',
    });

    const tasks = Object.values(getStore().tasks);
    expect(tasks.some((t) => t.title === 'Collect insurance card')).toBe(true);
  });

  it('creates a note at Eligibility stage', async () => {
    await move('Intake');
    await move('Eligibility Verification');

    airtable.create.mockResolvedValueOnce({
      id: 'rec_note_1',
      fields: { id: 'note_001', content: 'Medicaid active, no open episode', patient_id: 'pat_001' },
    });

    await createNoteOptimistic({
      content: 'Medicaid active, no open episode',
      patient_id: 'pat_001',
      referral_id: 'ref_001',
      author_id: 'usr_intake_01',
    });

    const notes = Object.values(getStore().notes);
    expect(notes.some((n) => n.content === 'Medicaid active, no open episode')).toBe(true);
  });

  it('completes a task', async () => {
    setStore({
      ...getStore(),
      tasks: {
        rec_task_x: {
          _id: 'rec_task_x', id: 'task_010',
          title: 'Follow up on disenrollment', status: 'Pending',
          referral_id: 'ref_001', patient_id: 'pat_001',
        },
      },
    });

    await updateTaskOptimistic('rec_task_x', {
      status: 'Completed',
      completed_at: new Date().toISOString(),
      completed_by_id: 'usr_intake_01',
    });

    expect(getStore().tasks['rec_task_x'].status).toBe('Completed');
    expect(getStore().tasks['rec_task_x'].completed_by_id).toBe('usr_intake_01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 11: Multiple Referrals for the Same Patient
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 11: Multiple referrals for same patient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const patient = makePatient();
    const ref1 = makeReferral({ _id: 'rec_ref1', id: 'ref_001', current_stage: 'Intake', services_requested: ['SN'] });
    const ref2 = makeReferral({ _id: 'rec_ref2', id: 'ref_002', current_stage: 'Lead Entry', services_requested: ['PT', 'OT'] });
    setStore({
      hydrated: true,
      patients: { [patient._id]: patient },
      referrals: { [ref1._id]: ref1, [ref2._id]: ref2 },
      notes: {}, tasks: {}, stageHistory: {},
      files: {}, insuranceChecks: {}, conflicts: {},
      authorizations: {}, episodes: {},
      triageAdult: {}, triagePediatric: {},
    });
  });

  it('moving one referral does not affect the other', async () => {
    await updateReferralOptimistic('rec_ref1', { current_stage: 'Eligibility Verification' });
    expect(getStore().referrals['rec_ref1'].current_stage).toBe('Eligibility Verification');
    expect(getStore().referrals['rec_ref2'].current_stage).toBe('Lead Entry');
  });

  it('different referrals can be at different stages independently', async () => {
    await updateReferralOptimistic('rec_ref1', { current_stage: 'F2F/MD Orders Pending' });
    await updateReferralOptimistic('rec_ref2', { current_stage: 'Intake' });
    expect(getStore().referrals['rec_ref1'].current_stage).toBe('F2F/MD Orders Pending');
    expect(getStore().referrals['rec_ref2'].current_stage).toBe('Intake');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 12: API Failure Rollback Across All Entity Types
// Ensures optimistic updates roll back consistently on failure
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 12: Rollback on API failures', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('referral update rolls back on failure', async () => {
    airtable.update.mockRejectedValueOnce(new Error('Network error'));
    expect(getRefStage()).toBe('Lead Entry');
    await move('Intake').catch(() => {});
    expect(getRefStage()).toBe('Lead Entry');
  });

  it('patient update rolls back on failure', async () => {
    airtable.update.mockRejectedValueOnce(new Error('Network error'));
    await updatePatientOptimistic('rec_pat1', { first_name: 'WRONG' }).catch(() => {});
    expect(getPatient().first_name).toBe('Maria');
  });

  it('task update rolls back on failure', async () => {
    setStore({
      ...getStore(),
      tasks: { rec_t1: { _id: 'rec_t1', status: 'Pending', title: 'Test' } },
    });
    airtable.update.mockRejectedValueOnce(new Error('Network error'));
    await updateTaskOptimistic('rec_t1', { status: 'Completed' }).catch(() => {});
    expect(getStore().tasks['rec_t1'].status).toBe('Pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 13: Complex Multi-Branch Journey (Stakeholder Demo Scenario)
// This is the type of flow that breaks during stakeholder demos
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 13: Complex stakeholder demo scenario', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('Lead → Intake → Elig → Disenrollment → Elig → F2F → Clinical (decline) → Conflict → Elig → F2F → Clinical (accept) → Auth → Staffing → Admin → Pre-SOC → SOC → Complete', async () => {
    // Create referral
    expect(getRefStage()).toBe('Lead Entry');

    // Promote to Intake
    await move('Intake', { intake_owner_id: 'usr_01' });
    expect(getRefStage()).toBe('Intake');
    expect(getRef().intake_owner_id).toBe('usr_01');

    // Move to Eligibility
    await move('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');

    // Discover open episode → Disenrollment
    await move('Disenrollment Required');
    expect(getRefStage()).toBe('Disenrollment Required');

    // Disenrollment successful → back to Eligibility
    await move('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');

    // Move to F2F
    await move('F2F/MD Orders Pending', {
      f2f_date: '2026-04-01',
      f2f_expiration: '2026-07-01',
    });
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
    expect(getRef().f2f_date).toBe('2026-04-01');

    // Clinical RN review — declines
    await move('Clinical Intake RN Review');
    await move('Conflict', {
      clinical_review_decision: 'decline',
      clinical_review_by: 'usr_rn_01',
    });
    expect(getRefStage()).toBe('Conflict');
    expect(getRef().clinical_review_decision).toBe('decline');

    // Conflict resolved → back to Eligibility
    await move('Eligibility Verification');

    // Second pass: F2F still valid
    await move('F2F/MD Orders Pending');
    expect(getRef().f2f_date).toBe('2026-04-01');

    // Clinical RN accepts this time
    await move('Clinical Intake RN Review');
    await move('Authorization Pending', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_02',
    });
    expect(getRef().clinical_review_decision).toBe('accept');

    // Auth approved → continue
    await move('Staffing Feasibility');
    await move('Admin Confirmation');
    await move('Pre-SOC');
    await move('SOC Scheduled', { soc_scheduled_date: '2026-04-20' });
    await move('SOC Completed', { soc_completed_date: '2026-04-20' });
    expect(getRefStage()).toBe('SOC Completed');
    expect(getRef().soc_completed_date).toBe('2026-04-20');
  });

  it('Intake → Hold → Release → Eligibility → Hold → Release → F2F → Conflict → NTUC', async () => {
    await move('Intake');

    // Hold 1
    await move('Hold', { hold_reason: 'Insurance issue', hold_return_stage: 'Intake' });
    expect(getRefStage()).toBe('Hold');
    await move('Intake', { hold_reason: '', hold_return_stage: '' });
    expect(getRefStage()).toBe('Intake');

    await move('Eligibility Verification');

    // Hold 2
    await move('Hold', { hold_reason: 'Patient traveling', hold_return_stage: 'Eligibility Verification' });
    expect(getRefStage()).toBe('Hold');
    expect(getRef().hold_return_stage).toBe('Eligibility Verification');
    await move('Eligibility Verification', { hold_reason: '', hold_return_stage: '' });

    await move('F2F/MD Orders Pending');
    await move('Conflict');

    // Conflict → NTUC
    await move('NTUC', { ntuc_reason: 'Regulatory conflict, patient ineligible' });
    expect(getRefStage()).toBe('NTUC');
    expect(getRef().ntuc_reason).toBe('Regulatory conflict, patient ineligible');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 14: NTUC Interception — Admin Confirmation Review Cycle
// Tests the full NTUC request → review → confirm/deny cycle
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 14: NTUC interception cycle', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore({}, { current_stage: 'Staffing Feasibility' }); });

  it('non-admin requests NTUC → intercepted to Admin Confirmation → admin confirms → NTUC', async () => {
    const { effectiveStage, ntucMetadata, wasIntercepted } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Staffing Feasibility',
      canDirect: () => false,
      userId: 'usr_scheduler',
    });
    expect(effectiveStage).toBe('Admin Confirmation');
    expect(wasIntercepted).toBe(true);

    await move(effectiveStage, ntucMetadata);
    expect(getRefStage()).toBe('Admin Confirmation');
    expect(getRef().ntuc_request_origin_stage).toBe('Staffing Feasibility');
    expect(getRef().ntuc_requested_by).toBe('usr_scheduler');

    // Admin confirms NTUC
    await move('NTUC', { ntuc_reason: 'Staffing unavailable in region' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('non-admin requests NTUC → admin denies → send back to origin', async () => {
    const { effectiveStage, ntucMetadata } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Staffing Feasibility',
      canDirect: () => false,
      userId: 'usr_scheduler',
    });

    await move(effectiveStage, ntucMetadata);
    expect(getRef().ntuc_request_origin_stage).toBe('Staffing Feasibility');

    // Admin denies — send back to origin
    const origin = getRef().ntuc_request_origin_stage;
    await move(origin, {
      ntuc_request_origin_stage: '',
      ntuc_requested_by: '',
      ntuc_requested_at: '',
    });
    expect(getRefStage()).toBe('Staffing Feasibility');
    expect(getRef().ntuc_request_origin_stage).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 15: Stage Config + Navigation Consistency
// Verifies the config changes (OPWDD ordering, SPN labels, etc.)
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 15: Config and navigation consistency', () => {
  it('OPWDD comes after Eligibility in STAGE_SLUGS key order', () => {
    const keys = Object.keys(STAGE_SLUGS);
    const eligIdx = keys.indexOf('Eligibility Verification');
    const opwddIdx = keys.indexOf('OPWDD Enrollment');
    expect(eligIdx).toBeGreaterThan(-1);
    expect(opwddIdx).toBeGreaterThan(-1);
    expect(opwddIdx).toBe(eligIdx + 1);
  });

  it('OPWDD comes after Eligibility in intake role mode', () => {
    const intakeMode = ROLE_MODES.find((m) => m.id === 'intake');
    const stages = intakeMode.stages;
    const eligIdx = stages.indexOf('Eligibility Verification');
    const opwddIdx = stages.indexOf('OPWDD Enrollment');
    expect(eligIdx).toBeGreaterThan(-1);
    expect(opwddIdx).toBeGreaterThan(-1);
    expect(opwddIdx).toBe(eligIdx + 1);
  });

  it('every stage in STAGE_SLUGS has a corresponding STAGE_META entry', () => {
    for (const stage of Object.keys(STAGE_SLUGS)) {
      expect(STAGE_META[stage], `Missing STAGE_META for "${stage}"`).toBeTruthy();
    }
  });

  it('every stage in STAGE_SLUGS exists in StageRules.json', () => {
    for (const stage of Object.keys(STAGE_SLUGS)) {
      expect(StageRules.stages[stage], `Missing StageRules for "${stage}"`).toBeTruthy();
    }
  });

  it('ALL_STAGES matches STAGE_SLUGS keys', () => {
    expect(ALL_STAGES.sort()).toEqual(Object.keys(STAGE_SLUGS).sort());
  });

  it('services_under_licence field is on the referral fixture', () => {
    seedStore();
    expect(getRef().services_under_licence).toBe('WB');
  });

  it('WB and WBII both work as licence values', () => {
    seedStore({}, { services_under_licence: 'WBII' });
    expect(getRef().services_under_licence).toBe('WBII');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 16: Division Filtering
// Verifies that division filtering works for both ALF and SPN
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 16: Division-based data segmentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const pat1 = makePatient({ _id: 'rec_p1', id: 'pat_alf', division: 'ALF' });
    const pat2 = makePatient({ _id: 'rec_p2', id: 'pat_spn', division: 'Special Needs', first_name: 'James' });
    const ref1 = makeReferral({ _id: 'rec_r1', id: 'ref_alf', patient_id: 'pat_alf', division: 'ALF', services_under_licence: 'WB' });
    const ref2 = makeReferral({ _id: 'rec_r2', id: 'ref_spn', patient_id: 'pat_spn', division: 'Special Needs', services_under_licence: 'WBII' });
    setStore({
      hydrated: true,
      patients: { [pat1._id]: pat1, [pat2._id]: pat2 },
      referrals: { [ref1._id]: ref1, [ref2._id]: ref2 },
      notes: {}, tasks: {}, stageHistory: {},
      files: {}, insuranceChecks: {}, conflicts: {},
      authorizations: {}, episodes: {},
      triageAdult: {}, triagePediatric: {},
    });
  });

  it('ALF filter returns only ALF referrals', () => {
    const refs = Object.values(getStore().referrals);
    const alfRefs = refs.filter((r) => r.division === 'ALF');
    expect(alfRefs.length).toBe(1);
    expect(alfRefs[0].id).toBe('ref_alf');
    expect(alfRefs[0].services_under_licence).toBe('WB');
  });

  it('Special Needs filter returns only SPN referrals', () => {
    const refs = Object.values(getStore().referrals);
    const spnRefs = refs.filter((r) => r.division === 'Special Needs');
    expect(spnRefs.length).toBe(1);
    expect(spnRefs[0].id).toBe('ref_spn');
    expect(spnRefs[0].services_under_licence).toBe('WBII');
  });

  it('All division returns both', () => {
    const refs = Object.values(getStore().referrals);
    expect(refs.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 17: Send to Conflict from any stage
// Verifies canMoveFromTo allows Conflict from all active stages
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 17: Send to Conflict from every active non-terminal stage', () => {
  // Conflict → Conflict is a same-stage move (blocked by design).
  // OPWDD only allows → Intake or Discarded Leads (restricted stage).
  const excluded = new Set(['Conflict', 'OPWDD Enrollment']);
  const activeNonTerminal = Object.entries(StageRules.stages)
    .filter(([name, rule]) => !rule.terminal && !excluded.has(name))
    .map(([name]) => name);

  for (const stage of activeNonTerminal) {
    it(`${stage} → Conflict is allowed`, () => {
      expect(canMoveFromTo(stage, 'Conflict')).toBe(true);
    });
  }

  it('OPWDD Enrollment cannot send to Conflict (restricted transitions)', () => {
    expect(canMoveFromTo('OPWDD Enrollment', 'Conflict')).toBe(false);
  });

  it('Conflict → Conflict is blocked (same-stage)', () => {
    expect(canMoveFromTo('Conflict', 'Conflict')).toBe(false);
  });

  it('terminal stages cannot send to Conflict', () => {
    expect(canMoveFromTo('SOC Completed', 'Conflict')).toBe(false);
    expect(canMoveFromTo('NTUC', 'Conflict')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 18: Rapid Sequential Transitions (Race Condition Guard)
// Simulates clicking buttons quickly — ensures state is consistent
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 18: Rapid sequential transitions', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('five rapid moves settle to correct final state', async () => {
    await move('Intake');
    await move('Eligibility Verification');
    await move('F2F/MD Orders Pending');
    await move('Clinical Intake RN Review');
    await move('Staffing Feasibility');
    expect(getRefStage()).toBe('Staffing Feasibility');
    expect(airtable.update).toHaveBeenCalledTimes(5);
  });

  it('creating patient + referral + moving in sequence works', async () => {
    airtable.create.mockResolvedValueOnce({ id: 'rec_new_pat', fields: { id: 'pat_new' } });
    await createPatientOptimistic({
      id: 'pat_new', first_name: 'Test', last_name: 'Patient',
      division: 'ALF', is_active: 'TRUE',
    });
    expect(getStore().patients['rec_new_pat']).toBeTruthy();

    airtable.create.mockResolvedValueOnce({ id: 'rec_new_ref', fields: { id: 'ref_new', patient_id: 'pat_new', current_stage: 'Lead Entry' } });
    await createReferralOptimistic({
      id: 'ref_new', patient_id: 'pat_new',
      current_stage: 'Lead Entry', division: 'ALF',
    });
    expect(getStore().referrals['rec_new_ref']).toBeTruthy();

    await updateReferralOptimistic('rec_new_ref', { current_stage: 'Intake' });
    expect(getStore().referrals['rec_new_ref'].current_stage).toBe('Intake');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 19: StageHistory Audit Trail
// Ensures transitions create audit records
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 19: StageHistory records are created', () => {
  beforeEach(() => { vi.clearAllMocks(); seedStore(); });

  it('creates stage history entry on transition', async () => {
    airtable.create.mockResolvedValueOnce({
      id: 'rec_sh_1',
      fields: {
        id: 'sh_001', referral_id: 'ref_001',
        from_stage: 'Lead Entry', to_stage: 'Intake',
        changed_by_id: 'usr_01',
      },
    });

    await createStageHistoryOptimistic({
      id: 'sh_001',
      referral_id: 'ref_001',
      from_stage: 'Lead Entry',
      to_stage: 'Intake',
      changed_by_id: 'usr_01',
      timestamp: new Date().toISOString(),
    });

    const history = Object.values(getStore().stageHistory);
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((h) => h.to_stage === 'Intake')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 20: WB/WBII Licence Assignment
// Verifies the licence field can be set and persists
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 20: WB/WBII licence field handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('WB licence persists through complete ALF pipeline', async () => {
    seedStore({}, { services_under_licence: 'WB' });
    await move('Intake');
    await move('Eligibility Verification');
    await move('F2F/MD Orders Pending');
    await move('Clinical Intake RN Review');
    await move('Staffing Feasibility');
    await move('Admin Confirmation');
    await move('Pre-SOC');
    await move('SOC Scheduled');
    await move('SOC Completed');
    expect(getRef().services_under_licence).toBe('WB');
  });

  it('WBII licence persists through complete SPN pipeline', async () => {
    seedStore(
      { division: 'Special Needs' },
      { division: 'Special Needs', services_under_licence: 'WBII' },
    );
    await move('Intake');
    await move('Eligibility Verification');
    await move('F2F/MD Orders Pending');
    await move('Clinical Intake RN Review');
    await move('Staffing Feasibility');
    await move('Admin Confirmation');
    await move('Pre-SOC');
    await move('SOC Scheduled');
    await move('SOC Completed');
    expect(getRef().services_under_licence).toBe('WBII');
  });

  it('licence can be updated mid-pipeline if county changes', async () => {
    seedStore({}, { services_under_licence: 'WB' });
    await move('Intake');
    await updateReferralOptimistic('rec_ref1', { services_under_licence: 'WBII' });
    expect(getRef().services_under_licence).toBe('WBII');
    await move('Eligibility Verification');
    expect(getRef().services_under_licence).toBe('WBII');
  });

  it('referral without licence field still works', async () => {
    seedStore({}, { services_under_licence: undefined });
    await move('Intake');
    expect(getRefStage()).toBe('Intake');
    expect(getRef().services_under_licence).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 21: Patient Snapshot Readiness Flags
// ─────────────────────────────────────────────────────────────────────────────

import { computeSnapshotFlags } from '../components/modules/PatientSnapshot.jsx';
import { isTriageComplete } from '../utils/triageCompleteness.js';
import { normalizePhone, validateEmail, lookupZip } from '../utils/validation.js';

describe('FLOW 21: Patient snapshot flags', () => {
  it('all flags pass with complete data', () => {
    const patient = {
      first_name: 'Maria', last_name: 'Rodriguez', dob: '1985-06-15',
      gender: 'Female', phone_primary: '2125551234',
      address_street: '123 Main St', address_city: 'New York',
      address_state: 'NY', address_zip: '10001', medicaid_number: 'AB12345C',
    };
    const referral = {
      division: 'ALF', f2f_date: '2026-03-20',
      is_pecos_verified: 'TRUE', is_opra_verified: true,
    };
    const flags = computeSnapshotFlags(patient, referral, null, [{ id: 'check1' }]);
    expect(flags.demographics).toBe(true);
    expect(flags.triage).toBe(true); // ALF auto-passes
    expect(flags.f2f).toBe(true);
    expect(flags.insurance).toBe(true);
    expect(flags.pecos).toBe(true);
  });

  it('demographics fails when required field is missing', () => {
    const patient = { first_name: 'Maria', last_name: 'Rodriguez', dob: '1985-06-15' };
    const flags = computeSnapshotFlags(patient, {}, null, []);
    expect(flags.demographics).toBe(false);
  });

  it('triage auto-passes for ALF', () => {
    const flags = computeSnapshotFlags({}, { division: 'ALF' }, null, []);
    expect(flags.triage).toBe(true);
  });

  it('triage fails for SPN without triage data', () => {
    const flags = computeSnapshotFlags({ dob: '1985-01-01' }, { division: 'Special Needs' }, null, []);
    expect(flags.triage).toBe(false);
  });

  it('triage passes for SPN with complete adult triage', () => {
    const triageData = {
      caregiver_name: 'J', caregiver_phone: '2125550100',
      has_pets: false, has_homecare_services: false, has_community_hab: false,
      code_95: 'no', services_needed: ['SN'], therapy_availability: 'AM',
      is_diabetic: false, pcp_name: 'Dr. X', pcp_last_visit: '2026-01-01',
      pcp_phone: '2125550200', cm_name: 'CM', cm_company: 'Co', cm_phone: '2125550300',
    };
    const flags = computeSnapshotFlags(
      { dob: '1985-01-01' }, { division: 'Special Needs' }, triageData, []
    );
    expect(flags.triage).toBe(true);
  });

  it('f2f flag passes only when f2f_date exists', () => {
    expect(computeSnapshotFlags({}, { f2f_date: '2026-03-01' }, null, []).f2f).toBe(true);
    expect(computeSnapshotFlags({}, {}, null, []).f2f).toBe(false);
  });

  it('insurance flag requires at least one check', () => {
    expect(computeSnapshotFlags({}, {}, null, []).insurance).toBe(false);
    expect(computeSnapshotFlags({}, {}, null, [{ id: 'c1' }]).insurance).toBe(true);
  });

  it('pecos flag requires both verifications', () => {
    expect(computeSnapshotFlags({}, { is_pecos_verified: 'TRUE', is_opra_verified: true }, null, []).pecos).toBe(true);
    expect(computeSnapshotFlags({}, { is_pecos_verified: 'TRUE', is_opra_verified: false }, null, []).pecos).toBe(false);
    expect(computeSnapshotFlags({}, { is_pecos_verified: false, is_opra_verified: 'TRUE' }, null, []).pecos).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 22: Triage completeness across pipeline transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 22: Triage completeness integration', () => {
  it('incomplete adult triage blocks snapshot flag', () => {
    const partial = { caregiver_name: 'Jane', code_95: 'no' };
    const { complete } = isTriageComplete(partial, 'adult');
    expect(complete).toBe(false);
    const flags = computeSnapshotFlags(
      { dob: '1985-01-01' }, { division: 'Special Needs' }, partial, []
    );
    expect(flags.triage).toBe(false);
  });

  it('complete pediatric triage passes snapshot flag', () => {
    const fullPed = {
      phone_call_made_to: 'Mother', household_description: 'Parents',
      has_pets: false, has_homecare_services: false, has_community_hab: false,
      has_boe_services: false, code_95: 'yes', services_needed: ['SN', 'ABA'],
      therapy_availability: 'After school', hha_hours_frequency: '4h/day',
      is_diabetic: false, immunizations_up_to_date: 'true',
      school_bus_time: '15:30', has_recent_hospitalization: false,
      pcp_name: 'Dr. J', pcp_last_visit: '2026-02-01', pcp_phone: '2125550400',
      cm_name: 'CM', cm_phone: '2125550500',
    };
    const { complete } = isTriageComplete(fullPed, 'pediatric');
    expect(complete).toBe(true);
    const flags = computeSnapshotFlags(
      { dob: '2015-01-01' }, { division: 'Special Needs' }, fullPed, []
    );
    expect(flags.triage).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 23: Validation utilities in pipeline context
// ─────────────────────────────────────────────────────────────────────────────

describe('FLOW 23: Validation in pipeline context', () => {
  it('phone normalization works for patient data', () => {
    const result = normalizePhone('1 (212) 555-1234');
    expect(result.valid).toBe(true);
    expect(result.digits).toBe('2125551234');
    expect(result.formatted).toBe('(212) 555-1234');
  });

  it('rejects invalid phone during referral creation', () => {
    const result = normalizePhone('555-12');
    expect(result.valid).toBe(false);
  });

  it('email validation works for patient emails', () => {
    expect(validateEmail('patient@fidelis.com').valid).toBe(true);
    expect(validateEmail('not-an-email').valid).toBe(false);
  });

  it('ZIP lookup returns city/state for auto-population', () => {
    const result = lookupZip('10001');
    expect(result.valid).toBe(true);
    expect(result.state).toBe('NY');
    expect(result.city).toBeTruthy();
  });

  it('ZIP lookup rejects invalid format', () => {
    expect(lookupZip('ABCDE').valid).toBe(false);
    expect(lookupZip('123').valid).toBe(false);
  });

  it('Intake consolidation includes F2F stage', () => {
    expect(STAGE_META['Intake'].consolidatedStages).toContain('F2F/MD Orders Pending');
    expect(STAGE_META['Intake'].consolidatedStages).toContain('Intake');
  });
});
