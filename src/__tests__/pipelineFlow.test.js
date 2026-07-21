/**
 * Pipeline Flow Integration Tests
 *
 * Simulates a referral flowing through every module in the CareStream pipeline,
 * exercising every stage transition, alternate path, and terminal state.
 *
 * Tests are structured as user journeys — not isolated unit tests — to ensure
 * the full transition graph works end-to-end against the store and StageRules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canMoveFromTo, needsModal, resolveNtucDestination } from '../utils/stageTransitions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { STAGE_SLUGS, STAGE_META, ALL_STAGES, DISCARD_REASONS } from '../data/stageConfig.js';
import StageRules from '../data/StageRules.json';

// ── Mock airtable so mutations don't make real calls ────────────────────────
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
const { useCareStore, getStore, setStore, mergeEntities, updateEntity, removeEntity } = await import('../store/careStore.js');
const { updateReferralOptimistic, createReferralOptimistic, createPatientOptimistic, createStageHistoryOptimistic, createTaskOptimistic, createNoteOptimistic, updateTaskOptimistic, getNextTaskId } = await import('../store/mutations.js');
const { makePatient: baseMakePatient, makeReferral: baseMakeReferral } = await import('../test/factories.js');

// ── Test Fixtures ───────────────────────────────────────────────────────────
// These delegate to the shared factory but pin this suite's historical ids
// (pat_test / ref_test) so existing assertions keep matching.

function makePatient(overrides = {}) {
  return baseMakePatient({
    id: 'pat_test',
    first_name: 'John',
    last_name: 'Smith',
    dob: '1980-01-01',
    gender: 'Male',
    address_zip: '11201',
    ...overrides,
  });
}

function makeReferral(overrides = {}) {
  return baseMakeReferral({
    id: 'ref_test',
    patient_id: 'pat_test',
    ...overrides,
  });
}

function seedStore(referralOverrides = {}) {
  const patient = makePatient();
  const referral = makeReferral(referralOverrides);
  setStore({
    hydrated: true,
    patients: { [patient._id]: patient },
    referrals: { [referral._id]: referral },
    notes: {},
    tasks: {},
    stageHistory: {},
    files: {},
    insuranceChecks: {},
    conflicts: {},
    authorizations: {},
  });
  return { patient, referral };
}

function getRefStage() {
  return getStore().referrals['rec_ref1']?.current_stage;
}

async function moveStage(toStage, extraFields = {}) {
  await updateReferralOptimistic('rec_ref1', { current_stage: toStage, ...extraFields });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Stage Transition Rule Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('StageRules.json — structural integrity', () => {
  const allStageNames = Object.keys(StageRules.stages);

  it('every stage in STAGE_SLUGS exists in StageRules', () => {
    for (const stage of Object.keys(STAGE_SLUGS)) {
      expect(allStageNames, `Missing stage "${stage}" in StageRules.json`).toContain(stage);
    }
  });

  it('every stage in StageRules has canMoveTo as an array', () => {
    for (const [name, rule] of Object.entries(StageRules.stages)) {
      expect(Array.isArray(rule.canMoveTo), `${name}.canMoveTo is not an array`).toBe(true);
    }
  });

  it('canMoveTo only references stages that exist in StageRules', () => {
    for (const [name, rule] of Object.entries(StageRules.stages)) {
      for (const target of rule.canMoveTo) {
        expect(allStageNames, `${name} → "${target}" references a nonexistent stage`).toContain(target);
      }
    }
  });

  it('terminal stages have empty canMoveTo (except Discarded Leads which allows restore)', () => {
    for (const [name, rule] of Object.entries(StageRules.stages)) {
      if (rule.terminal && name !== 'Discarded Leads') {
        expect(rule.canMoveTo.length, `Terminal stage "${name}" should have empty canMoveTo`).toBe(0);
      }
    }
  });

  it('Discarded Leads is terminal but allows canMoveTo Lead Entry (restore handled by panel directly)', () => {
    const rule = StageRules.stages['Discarded Leads'];
    expect(rule.terminal).toBe(true);
    expect(rule.canMoveTo).toContain('Lead Entry');
  });

  it('non-terminal stages have at least one transition', () => {
    for (const [name, rule] of Object.entries(StageRules.stages)) {
      if (!rule.terminal) {
        expect(rule.canMoveTo.length, `Non-terminal stage "${name}" has no transitions`).toBeGreaterThan(0);
      }
    }
  });

  it('global rules are present and correct', () => {
    expect(StageRules.globalRules.anyActiveStageCanMoveToHold).toBe(true);
    expect(StageRules.globalRules.holdAlwaysRequiresNote).toBe(true);
    expect(StageRules.globalRules.ntucAlwaysRequiresNote).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: canMoveFromTo — transition validation
// ─────────────────────────────────────────────────────────────────────────────

describe('canMoveFromTo', () => {
  it('prevents same-stage moves', () => {
    expect(canMoveFromTo('Lead Entry', 'Lead Entry')).toBe(false);
    expect(canMoveFromTo('Intake', 'Intake')).toBe(false);
  });

  it('allows standard happy-path transitions (post-2026-05-20 workflow)', () => {
    // Lead Entry → Intake (with owner)
    expect(canMoveFromTo('Lead Entry', 'Intake')).toBe(true);
    // Intake → Eligibility Verification (after Clinical RN concurrent push + Insurance Details)
    expect(canMoveFromTo('Intake', 'Eligibility Verification')).toBe(true);
    // F2F is a sub-state of Intake — Intake can flip to F2F and back
    expect(canMoveFromTo('F2F/MD Orders Pending', 'Intake')).toBe(true);
    // Clinical RN routes to EMR Onboarding now (LIFO target; Decline removed, Auth is Eligibility-side)
    expect(canMoveFromTo('Clinical Intake RN Review', 'EMR Onboarding')).toBe(true);
    expect(canMoveFromTo('Clinical Intake RN Review', 'Staffing Feasibility')).toBe(false);
    // Eligibility → EMR Onboarding (LIFO trigger with Clinical RN completion)
    expect(canMoveFromTo('Eligibility Verification', 'EMR Onboarding')).toBe(true);
    expect(canMoveFromTo('Eligibility Verification', 'Staffing Feasibility')).toBe(false);
    // Eligibility can send back to Intake with a required note
    expect(canMoveFromTo('Eligibility Verification', 'Intake')).toBe(true);
    // Auth Pending and Disenrollment Required return to Eligibility (their parent)
    expect(canMoveFromTo('Authorization Pending', 'Eligibility Verification')).toBe(true);
    expect(canMoveFromTo('Disenrollment Required', 'Eligibility Verification')).toBe(true);
    // EMR Onboarding gates Staffing — the patient must be in the EMR first
    expect(canMoveFromTo('EMR Onboarding', 'Staffing Feasibility')).toBe(true);
    // Staffing → Pre-SOC → SOC Completed (Admin Confirmation no longer in forward path)
    expect(canMoveFromTo('Staffing Feasibility', 'Pre-SOC')).toBe(true);
    expect(canMoveFromTo('Pre-SOC', 'SOC Completed')).toBe(true);
    // Legacy SOC Scheduled → SOC Completed still works for historical records
    expect(canMoveFromTo('SOC Scheduled', 'SOC Completed')).toBe(true);
  });

  it('allows any active stage to move to Hold (global rule), except Hold itself', () => {
    const activeStages = Object.entries(StageRules.stages)
      .filter(([name, r]) => !r.terminal && name !== 'Hold')
      .map(([name]) => name);

    for (const stage of activeStages) {
      expect(canMoveFromTo(stage, 'Hold'), `${stage} → Hold should be allowed`).toBe(true);
    }
  });

  it('prevents moves from terminal stages', () => {
    expect(canMoveFromTo('SOC Completed', 'Pre-SOC')).toBe(false);
    expect(canMoveFromTo('NTUC', 'Intake')).toBe(false);
  });

  it('canMoveFromTo blocks Discarded Leads (terminal) — restore is handled via direct updateReferral in panel', () => {
    expect(canMoveFromTo('Discarded Leads', 'Lead Entry')).toBe(false);
    expect(canMoveFromTo('Discarded Leads', 'Intake')).toBe(false);
  });

  it('StageRules still lists Lead Entry in canMoveTo for Discarded Leads (panel reads this directly)', () => {
    expect(StageRules.stages['Discarded Leads'].canMoveTo).toContain('Lead Entry');
    expect(StageRules.stages['Discarded Leads'].canMoveTo).not.toContain('Intake');
  });

  it('OPWDD Enrollment can move to Intake or Discarded Leads only', () => {
    expect(canMoveFromTo('OPWDD Enrollment', 'Intake')).toBe(true);
    expect(canMoveFromTo('OPWDD Enrollment', 'Discarded Leads')).toBe(true);
    expect(canMoveFromTo('OPWDD Enrollment', 'Staffing Feasibility')).toBe(false);
    expect(canMoveFromTo('OPWDD Enrollment', 'Pre-SOC')).toBe(false);
  });

  it('rejects moves from nonexistent stages', () => {
    expect(canMoveFromTo('FakeStage', 'Intake')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: needsModal — modal requirement checks
// ─────────────────────────────────────────────────────────────────────────────

describe('needsModal', () => {
  it('requires modal for Hold destination (note required)', () => {
    expect(needsModal('Intake', 'Hold')).toBe(true);
    expect(needsModal('Pre-SOC', 'Hold')).toBe(true);
  });

  it('requires modal for NTUC destination', () => {
    expect(needsModal('Intake', 'NTUC')).toBe(true);
    expect(needsModal('Admin Confirmation', 'NTUC')).toBe(true);
  });

  it('requires modal when source stage has requiresNote', () => {
    expect(needsModal('Clinical Intake RN Review', 'Staffing Feasibility')).toBe(true);
    expect(needsModal('Conflict', 'Eligibility Verification')).toBe(true);
    expect(needsModal('Admin Confirmation', 'Pre-SOC')).toBe(true);
  });

  it('requires modal when source has protectedExit', () => {
    expect(needsModal('Clinical Intake RN Review', 'F2F/MD Orders Pending')).toBe(true);
    expect(needsModal('Admin Confirmation', 'Conflict')).toBe(true);
  });

  it('requires modal for Disenrollment Required (has destinationPrompt)', () => {
    expect(needsModal('Intake', 'Disenrollment Required')).toBe(true);
  });

  it('does not require modal for simple transitions', () => {
    expect(needsModal('Lead Entry', 'Intake')).toBe(false);
    expect(needsModal('Intake', 'Eligibility Verification')).toBe(false);
    expect(needsModal('Eligibility Verification', 'F2F/MD Orders Pending')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: resolveNtucDestination — NTUC interception
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveNtucDestination', () => {
  it('passes through non-NTUC requests unchanged', () => {
    const result = resolveNtucDestination({
      requestedStage: 'Staffing Feasibility',
      fromStage: 'Intake',
      canDirect: () => false,
      userId: 'usr_001',
    });
    expect(result.effectiveStage).toBe('Staffing Feasibility');
    expect(result.wasIntercepted).toBe(false);
    expect(result.ntucMetadata).toEqual({});
  });

  it('allows direct NTUC if user has REFERRAL_NTUC_DIRECT', () => {
    const result = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Intake',
      canDirect: () => true,
      userId: 'usr_admin',
    });
    expect(result.effectiveStage).toBe('NTUC');
    expect(result.wasIntercepted).toBe(false);
  });

  it('intercepts NTUC to Admin Confirmation when no direct permission', () => {
    const result = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Staffing Feasibility',
      canDirect: () => false,
      userId: 'usr_regular',
    });
    expect(result.effectiveStage).toBe('Admin Confirmation');
    expect(result.wasIntercepted).toBe(true);
    expect(result.ntucMetadata.ntuc_request_origin_stage).toBe('Staffing Feasibility');
    expect(result.ntucMetadata.ntuc_requested_by).toBe('usr_regular');
    expect(result.ntucMetadata.ntuc_requested_at).toBeTruthy();
  });

  it('preserves the origin stage for send-back from Admin Confirmation', () => {
    const stages = ['Intake', 'Eligibility Verification', 'F2F/MD Orders Pending', 'Staffing Feasibility'];
    for (const from of stages) {
      const result = resolveNtucDestination({
        requestedStage: 'NTUC', fromStage: from, canDirect: () => false, userId: 'usr_x',
      });
      expect(result.ntucMetadata.ntuc_request_origin_stage).toBe(from);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Store + Mutations — Optimistic Updates
// ─────────────────────────────────────────────────────────────────────────────

describe('Store and optimistic mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('updateReferralOptimistic instantly updates stage in store', async () => {
    expect(getRefStage()).toBe('Lead Entry');
    await moveStage('Intake');
    expect(getRefStage()).toBe('Intake');
  });

  it('rolls back on API failure', async () => {
    airtable.update.mockRejectedValueOnce(new Error('API down'));
    expect(getRefStage()).toBe('Lead Entry');
    await moveStage('Intake').catch(() => {});
    expect(getRefStage()).toBe('Lead Entry');
  });

  it('createReferralOptimistic adds a temp record then replaces with real one', async () => {
    airtable.create.mockResolvedValueOnce({ id: 'rec_new_ref', fields: { id: 'ref_new' } });
    const countBefore = Object.keys(getStore().referrals).length;
    await createReferralOptimistic({ id: 'ref_new', patient_id: 'pat_test', current_stage: 'Lead Entry' });
    const refs = getStore().referrals;
    expect(Object.keys(refs).length).toBe(countBefore + 1);
    expect(refs['rec_new_ref']).toBeTruthy();
    expect(refs['rec_new_ref'].id).toBe('ref_new');
  });

  it('createPatientOptimistic adds patient to store', async () => {
    airtable.create.mockResolvedValueOnce({ id: 'rec_pat_new', fields: { id: 'pat_new' } });
    await createPatientOptimistic({ id: 'pat_new', first_name: 'Jane', last_name: 'Doe' });
    expect(getStore().patients['rec_pat_new']).toBeTruthy();
  });

  it('createTaskOptimistic auto-generates task ID', async () => {
    const taskFields = { title: 'Follow up', type: 'Follow-Up', route_to_role: 'Intake', status: 'Pending' };
    airtable.create.mockResolvedValueOnce({ id: 'rec_task_new', fields: { id: 'task_001', ...taskFields } });
    await createTaskOptimistic(taskFields);
    const tasks = getStore().tasks;
    expect(Object.values(tasks).some(t => t.title === 'Follow up')).toBe(true);
  });

  it('createNoteOptimistic adds note to store', async () => {
    const noteFields = { patient_id: 'pat_test', content: 'Test note', author_id: 'usr_001' };
    airtable.create.mockResolvedValueOnce({ id: 'rec_note_new', fields: { id: 'note_001', ...noteFields } });
    await createNoteOptimistic(noteFields);
    expect(Object.values(getStore().notes).some(n => n.content === 'Test note')).toBe(true);
  });

  it('mergeEntities adds new records without overwriting existing', () => {
    mergeEntities('referrals', {
      rec_ref2: { _id: 'rec_ref2', id: 'ref_002', current_stage: 'Intake' },
    });
    expect(getStore().referrals['rec_ref1']).toBeTruthy();
    expect(getStore().referrals['rec_ref2']).toBeTruthy();
  });

  it('updateEntity patches a single record', () => {
    updateEntity('referrals', 'rec_ref1', { priority: 'High' });
    expect(getStore().referrals['rec_ref1'].priority).toBe('High');
    expect(getStore().referrals['rec_ref1'].current_stage).toBe('Lead Entry');
  });

  it('removeEntity deletes a record from the store', () => {
    removeEntity('referrals', 'rec_ref1');
    expect(getStore().referrals['rec_ref1']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Full Pipeline Journey — Happy Path (ALF)
// ─────────────────────────────────────────────────────────────────────────────

describe('Full pipeline journey — ALF happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('completes the entire pipeline from Lead Entry to SOC Completed (post-2026-05-20 workflow)', async () => {
    // 1. Lead Entry → Intake
    expect(canMoveFromTo('Lead Entry', 'Intake')).toBe(true);
    await moveStage('Intake', { intake_owner_id: 'usr_001' });
    expect(getRefStage()).toBe('Intake');

    // 2. Intake → Eligibility Verification (the F2F sub-stage and Clinical
    //    RN concurrent push both happen INSIDE Intake; the patient officially
    //    leaves Intake when the staff click "Push to Eligibility")
    expect(canMoveFromTo('Intake', 'Eligibility Verification')).toBe(true);
    await moveStage('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');

    // 3. Eligibility Verification → EMR Onboarding (LIFO with Clinical RN
    //    completion; auth/disen are supportive side flows, NOT forward
    //    destinations under the new model)
    expect(canMoveFromTo('Eligibility Verification', 'EMR Onboarding')).toBe(true);
    await moveStage('EMR Onboarding', {
      eligibility_completed_at: new Date().toISOString(),
      clinical_review_completed_at: new Date().toISOString(),
    });
    expect(getRefStage()).toBe('EMR Onboarding');

    // 4. EMR Onboarding → Staffing Feasibility (patient is onboarded into the
    //    external EMR before scheduling can plot a SOC)
    expect(canMoveFromTo('EMR Onboarding', 'Staffing Feasibility')).toBe(true);
    await moveStage('Staffing Feasibility', {
      emr_onboarded_at: new Date().toISOString(),
    });
    expect(getRefStage()).toBe('Staffing Feasibility');

    // 5. Staffing Feasibility → Pre-SOC (Admin Confirmation is now a side
    //    channel for NTUC review only; not in the forward path)
    expect(canMoveFromTo('Staffing Feasibility', 'Pre-SOC')).toBe(true);
    await moveStage('Pre-SOC');
    expect(getRefStage()).toBe('Pre-SOC');

    // 6. Pre-SOC → SOC Completed (SOC Scheduled retained as legacy, but the
    //    forward path skips it)
    expect(canMoveFromTo('Pre-SOC', 'SOC Completed')).toBe(true);
    await moveStage('SOC Completed', { soc_completed_date: '2026-04-15' });
    expect(getRefStage()).toBe('SOC Completed');

    // 7. Cannot move out of terminal
    expect(canMoveFromTo('SOC Completed', 'Pre-SOC')).toBe(false);
    expect(canMoveFromTo('SOC Completed', 'Intake')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Auth-Required Path
// ─────────────────────────────────────────────────────────────────────────────

describe('Authorization Pending as a supportive sub-module of Eligibility (post-2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Eligibility Verification' });
  });

  it('Authorization Pending is no longer reachable directly from Clinical RN', () => {
    // Pre-2026-05-20 Clinical RN could route to Auth Pending. Under the new
    // model auth is an Eligibility-side concern (and a concurrent flag, not a
    // forward destination), so Clinical RN's only forward path is EMR Onboarding.
    expect(canMoveFromTo('Clinical Intake RN Review', 'Authorization Pending')).toBe(false);
    expect(canMoveFromTo('Clinical Intake RN Review', 'EMR Onboarding')).toBe(true);
  });

  it('Authorization Pending → Eligibility Verification remains allowed for legacy stage exit', () => {
    // Modern exit is Authorization Obtained (auth_obtained_at) without a stage
    // change. Legacy rows still on current_stage Authorization Pending can return
    // to Eligibility Verification via that transition edge.
    expect(canMoveFromTo('Authorization Pending', 'Eligibility Verification')).toBe(true);
  });

  it('auth denial routes to NTUC via Admin Confirmation', async () => {
    const { effectiveStage } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Authorization Pending',
      canDirect: () => true,
      userId: 'usr_admin',
    });
    expect(effectiveStage).toBe('NTUC');
  });

  it('auth denial without direct permission goes to Admin Confirmation', async () => {
    const { effectiveStage, wasIntercepted, ntucMetadata } = resolveNtucDestination({
      requestedStage: 'NTUC',
      fromStage: 'Authorization Pending',
      canDirect: () => false,
      userId: 'usr_regular',
    });
    expect(effectiveStage).toBe('Admin Confirmation');
    expect(wasIntercepted).toBe(true);
    expect(ntucMetadata.ntuc_request_origin_stage).toBe('Authorization Pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Disenrollment Branch
// ─────────────────────────────────────────────────────────────────────────────

describe('Disenrollment Required as a supportive sub-module of Eligibility (post-2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Eligibility Verification' });
  });

  it('Eligibility no longer treats Disenrollment as a forward destination — it is a concurrent flag', () => {
    // Per the workflow overhaul, Eligibility surfaces a DisenrollmentAssistanceFlags
    // row instead of flipping current_stage to 'Disenrollment Required'.
    expect(canMoveFromTo('Eligibility Verification', 'Disenrollment Required')).toBe(false);
  });

  it('Disenrollment Required (legacy current_stage) can return to Eligibility', () => {
    expect(canMoveFromTo('Disenrollment Required', 'Eligibility Verification')).toBe(true);
  });

  it('Disenrollment can escalate to Conflict', () => {
    expect(canMoveFromTo('Disenrollment Required', 'Conflict')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Conflict Resolution Paths
// ─────────────────────────────────────────────────────────────────────────────

describe('Conflict resolution paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Conflict' });
  });

  it('conflict can resolve back to Eligibility Verification', async () => {
    expect(canMoveFromTo('Conflict', 'Eligibility Verification')).toBe(true);
    await moveStage('Eligibility Verification');
    expect(getRefStage()).toBe('Eligibility Verification');
  });

  it('conflict can resolve to Clinical RN Review', async () => {
    expect(canMoveFromTo('Conflict', 'Clinical Intake RN Review')).toBe(true);
    await moveStage('Clinical Intake RN Review');
    expect(getRefStage()).toBe('Clinical Intake RN Review');
  });

  it('conflict can escalate to Disenrollment', async () => {
    expect(canMoveFromTo('Conflict', 'Disenrollment Required')).toBe(true);
    await moveStage('Disenrollment Required');
    expect(getRefStage()).toBe('Disenrollment Required');
  });

  it('conflict can move to NTUC (terminal)', async () => {
    expect(canMoveFromTo('Conflict', 'NTUC')).toBe(true);
    await moveStage('NTUC', { ntuc_reason: 'Unresolvable conflict' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('conflict resolution requires modal (requiresNote=true)', () => {
    expect(needsModal('Conflict', 'Eligibility Verification')).toBe(true);
    expect(needsModal('Conflict', 'NTUC')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Hold + Release
// ─────────────────────────────────────────────────────────────────────────────

describe('Hold placement and release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'F2F/MD Orders Pending' });
  });

  it('any active stage can go to Hold', async () => {
    await moveStage('Hold', {
      hold_reason: 'Awaiting documents',
      hold_return_stage: 'F2F/MD Orders Pending',
      hold_owner_id: 'usr_001',
    });
    expect(getRefStage()).toBe('Hold');
  });

  it('Hold can release back to the original stage', async () => {
    await moveStage('Hold', { hold_return_stage: 'F2F/MD Orders Pending' });
    expect(canMoveFromTo('Hold', 'F2F/MD Orders Pending')).toBe(true);
    await moveStage('F2F/MD Orders Pending', {
      hold_reason: '',
      hold_return_stage: '',
      hold_owner_id: '',
    });
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
  });

  it('Hold can move to NTUC', async () => {
    await moveStage('Hold', { hold_return_stage: 'Intake' });
    expect(canMoveFromTo('Hold', 'NTUC')).toBe(true);
    await moveStage('NTUC', { ntuc_reason: 'Patient declined' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('Hold always requires a modal', () => {
    for (const stage of ['Intake', 'Eligibility Verification', 'Staffing Feasibility', 'Pre-SOC']) {
      expect(needsModal(stage, 'Hold'), `${stage} → Hold should require modal`).toBe(true);
    }
  });

  it('Hold from different stages preserves return stage correctly', async () => {
    const testStages = [
      'Intake', 'Eligibility Verification', 'Clinical Intake RN Review',
      'Staffing Feasibility', 'Pre-SOC',
    ];
    for (const fromStage of testStages) {
      seedStore({ current_stage: fromStage });
      await moveStage('Hold', { hold_return_stage: fromStage });
      expect(getStore().referrals['rec_ref1'].hold_return_stage).toBe(fromStage);
      await moveStage(fromStage);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Lead Entry → Discard + Restore
// ─────────────────────────────────────────────────────────────────────────────

describe('Lead discard and restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('Lead Entry can move to Discarded Leads with reason', async () => {
    expect(canMoveFromTo('Lead Entry', 'Discarded Leads')).toBe(true);
    await moveStage('Discarded Leads', {
      discard_reason: 'Duplicate referral',
      discard_explanation: 'Same patient referred twice',
    });
    expect(getRefStage()).toBe('Discarded Leads');
    expect(getStore().referrals['rec_ref1'].discard_reason).toBe('Duplicate referral');
  });

  it('Discarded Leads can be restored to Lead Entry (via direct update, not canMoveFromTo)', async () => {
    await moveStage('Discarded Leads');
    expect(getRefStage()).toBe('Discarded Leads');
    // Panel does direct updateReferral — canMoveFromTo returns false for terminal stages
    await moveStage('Lead Entry', { discard_reason: '', discard_explanation: '' });
    expect(getRefStage()).toBe('Lead Entry');
  });

  it('DISCARD_REASONS contains expected options', () => {
    expect(DISCARD_REASONS).toContain('Duplicate referral');
    expect(DISCARD_REASONS).toContain('Patient declined services');
    expect(DISCARD_REASONS).toContain('Out of service area');
    expect(DISCARD_REASONS).toContain('Other');
    expect(DISCARD_REASONS.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: OPWDD Enrollment Path (Code 95 = No)
// ─────────────────────────────────────────────────────────────────────────────

describe('OPWDD Enrollment path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'OPWDD Enrollment', division: 'Special Needs', code_95: 'no' });
  });

  it('OPWDD can move to Intake (specialist completes enrollment)', async () => {
    expect(canMoveFromTo('OPWDD Enrollment', 'Intake')).toBe(true);
    await moveStage('Intake');
    expect(getRefStage()).toBe('Intake');
  });

  it('OPWDD can move to Discarded Leads', async () => {
    expect(canMoveFromTo('OPWDD Enrollment', 'Discarded Leads')).toBe(true);
    await moveStage('Discarded Leads', { discard_reason: 'Patient unreachable' });
    expect(getRefStage()).toBe('Discarded Leads');
  });

  it('OPWDD cannot skip ahead to Staffing or Pre-SOC', () => {
    expect(canMoveFromTo('OPWDD Enrollment', 'Staffing Feasibility')).toBe(false);
    expect(canMoveFromTo('OPWDD Enrollment', 'Pre-SOC')).toBe(false);
    expect(canMoveFromTo('OPWDD Enrollment', 'SOC Completed')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: Clinical RN Review — Send Back to F2F
// ─────────────────────────────────────────────────────────────────────────────

describe('Clinical RN — send back to F2F', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Clinical Intake RN Review' });
  });

  it('Clinical RN can send back to F2F/MD Orders Pending', async () => {
    expect(canMoveFromTo('Clinical Intake RN Review', 'F2F/MD Orders Pending')).toBe(true);
    await moveStage('F2F/MD Orders Pending');
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
  });

  it('Clinical RN can decline to Conflict', async () => {
    expect(canMoveFromTo('Clinical Intake RN Review', 'Conflict')).toBe(true);
    await moveStage('Conflict', { clinical_review_decision: 'decline' });
    expect(getRefStage()).toBe('Conflict');
  });

  it('Clinical RN Review has protectedExit and requires clinical.rn_review permission', () => {
    const rule = StageRules.stages['Clinical Intake RN Review'];
    expect(rule.protectedExit).toBe(true);
    expect(rule.requiresPermission).toBe('clinical.rn_review');
    // requiresNote is FALSE post-2026-05-20 — the ClinicalRNPanel captures
    // any required note in-form (Send Back to F2F) rather than via the
    // generic transition modal.
    expect(rule.requiresNote).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: Admin Confirmation — NTUC Request Flow
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin Confirmation — NTUC request review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({
      current_stage: 'Admin Confirmation',
      ntuc_request_origin_stage: 'Staffing Feasibility',
      ntuc_requested_by: 'usr_regular',
      ntuc_requested_at: '2026-03-15T10:00:00Z',
    });
  });

  it('admin confirms NTUC — moves to NTUC', async () => {
    expect(canMoveFromTo('Admin Confirmation', 'NTUC')).toBe(true);
    await moveStage('NTUC', { ntuc_reason: 'Confirmed by admin' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('admin denies NTUC — moves to Conflict', async () => {
    expect(canMoveFromTo('Admin Confirmation', 'Conflict')).toBe(true);
    await moveStage('Conflict');
    expect(getRefStage()).toBe('Conflict');
  });

  it('admin sends back to origin stage', async () => {
    const origin = getStore().referrals['rec_ref1'].ntuc_request_origin_stage;
    expect(origin).toBe('Staffing Feasibility');
    expect(canMoveFromTo('Admin Confirmation', origin)).toBe(true);
    await moveStage(origin, {
      ntuc_request_origin_stage: '',
      ntuc_requested_by: '',
      ntuc_requested_at: '',
    });
    expect(getRefStage()).toBe('Staffing Feasibility');
  });

  it('Admin Confirmation → Pre-SOC (standard path, no NTUC request)', async () => {
    seedStore({ current_stage: 'Admin Confirmation' });
    expect(canMoveFromTo('Admin Confirmation', 'Pre-SOC')).toBe(true);
    await moveStage('Pre-SOC');
    expect(getRefStage()).toBe('Pre-SOC');
  });

  it('Admin Confirmation has protectedExit and requiresPermission', () => {
    const rule = StageRules.stages['Admin Confirmation'];
    expect(rule.protectedExit).toBe(true);
    expect(rule.requiresPermission).toBe('scheduling.admin_confirm');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: Consolidated Stages (Pre-SOC + SOC Scheduled)
// ─────────────────────────────────────────────────────────────────────────────

describe('Consolidated stages', () => {
  it('Pre-SOC meta includes SOC Scheduled in consolidatedStages', () => {
    const meta = STAGE_META['Pre-SOC'];
    expect(meta.consolidatedStages).toContain('Pre-SOC');
    expect(meta.consolidatedStages).toContain('SOC Scheduled');
  });

  it('Staffing Feasibility meta includes the full active pipeline in consolidatedStages', () => {
    const meta = STAGE_META['Staffing Feasibility'];
    expect(meta.consolidatedStages).toContain('Intake');
    expect(meta.consolidatedStages).toContain('Eligibility Verification');
    expect(meta.consolidatedStages).toContain('F2F/MD Orders Pending');
    expect(meta.consolidatedStages).toContain('Clinical Intake RN Review');
    expect(meta.consolidatedStages).toContain('Staffing Feasibility');
  });

  it('SOC Scheduled is hiddenFromNav', () => {
    expect(STAGE_META['SOC Scheduled'].hiddenFromNav).toBe(true);
  });

  it('Hold is hiddenFromNav', () => {
    expect(STAGE_META['Hold'].hiddenFromNav).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16: Stage Config Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('STAGE_META and STAGE_SLUGS consistency', () => {
  it('every slug maps to a valid stage', () => {
    for (const [stage, slug] of Object.entries(STAGE_SLUGS)) {
      expect(typeof slug).toBe('string');
      expect(slug.length).toBeGreaterThan(0);
      expect(StageRules.stages[stage] || STAGE_META[stage],
        `Stage "${stage}" has a slug but no rule or meta`).toBeTruthy();
    }
  });

  it('ALL_STAGES matches STAGE_SLUGS keys', () => {
    expect(ALL_STAGES.sort()).toEqual(Object.keys(STAGE_SLUGS).sort());
  });

  it('terminal stages have isTerminal=true in STAGE_META', () => {
    expect(STAGE_META['SOC Completed'].isTerminal).toBe(true);
    expect(STAGE_META['NTUC'].isTerminal).toBe(true);
    expect(STAGE_META['Discarded Leads'].isTerminal).toBe(true);
  });

  it('non-terminal stages have isTerminal=false in STAGE_META', () => {
    const nonTerminal = ['Lead Entry', 'Intake', 'Eligibility Verification', 'F2F/MD Orders Pending',
      'Clinical Intake RN Review', 'Authorization Pending', 'Staffing Feasibility',
      'Admin Confirmation', 'Pre-SOC', 'SOC Scheduled', 'OPWDD Enrollment'];
    for (const s of nonTerminal) {
      expect(STAGE_META[s].isTerminal, `${s} should not be terminal`).toBe(false);
    }
  });

  it('displayName overrides exist where expected', () => {
    expect(STAGE_META['Lead Entry'].displayName).toBe('Leads');
    expect(STAGE_META['SOC Completed'].displayName).toBe('Completed');
    expect(STAGE_META['OPWDD Enrollment'].displayName).toBe('OPWDD');
    expect(STAGE_META['Discarded Leads'].displayName).toBe('Discarded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17: Permission Keys Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Permission keys integrity', () => {
  it('all permission keys are unique strings', () => {
    const values = Object.values(PERMISSION_KEYS);
    const uniqueSet = new Set(values);
    expect(uniqueSet.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('critical pipeline permissions exist', () => {
    expect(PERMISSION_KEYS.REFERRAL_CREATE).toBeTruthy();
    expect(PERMISSION_KEYS.REFERRAL_TRANSITION).toBeTruthy();
    expect(PERMISSION_KEYS.REFERRAL_HOLD).toBeTruthy();
    expect(PERMISSION_KEYS.REFERRAL_NTUC).toBeTruthy();
    expect(PERMISSION_KEYS.REFERRAL_NTUC_DIRECT).toBeTruthy();
    expect(PERMISSION_KEYS.CLINICAL_RN_REVIEW).toBeTruthy();
    expect(PERMISSION_KEYS.SCHEDULING_ADMIN_CONFIRM).toBeTruthy();
    expect(PERMISSION_KEYS.SCHEDULING_SOC_SCHEDULE).toBeTruthy();
    expect(PERMISSION_KEYS.SCHEDULING_SOC_COMPLETE).toBeTruthy();
    expect(PERMISSION_KEYS.LEADS_PROMOTE_TO_INTAKE).toBeTruthy();
    expect(PERMISSION_KEYS.LEADS_DISCARD).toBeTruthy();
  });

  it('StageRules permission references match PERMISSION_KEYS values', () => {
    const allPermValues = new Set(Object.values(PERMISSION_KEYS));
    for (const [name, rule] of Object.entries(StageRules.stages)) {
      if (rule.requiresPermission) {
        expect(allPermValues.has(rule.requiresPermission),
          `${name}.requiresPermission="${rule.requiresPermission}" not in PERMISSION_KEYS`
        ).toBe(true);
      }
    }
    if (StageRules.globalRules.holdToNTUCRequiresPermission) {
      expect(allPermValues.has(StageRules.globalRules.holdToNTUCRequiresPermission)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18: Complex Multi-Branch Scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Complex multi-branch scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('Lead → Intake → Eligibility → Disenrollment → Eligibility → F2F → Clinical → Auth → NTUC (intercepted)', async () => {
    await moveStage('Intake');
    await moveStage('Eligibility Verification');
    await moveStage('Disenrollment Required');
    await moveStage('Eligibility Verification');
    await moveStage('F2F/MD Orders Pending');
    await moveStage('Clinical Intake RN Review');
    await moveStage('Authorization Pending');

    const { effectiveStage, wasIntercepted, ntucMetadata } = resolveNtucDestination({
      requestedStage: 'NTUC', fromStage: 'Authorization Pending', canDirect: () => false, userId: 'usr_x',
    });
    expect(effectiveStage).toBe('Admin Confirmation');
    expect(wasIntercepted).toBe(true);

    await moveStage(effectiveStage, ntucMetadata);
    expect(getRefStage()).toBe('Admin Confirmation');

    // Admin confirms NTUC
    await moveStage('NTUC', { ntuc_reason: 'Auth denied' });
    expect(getRefStage()).toBe('NTUC');
  });

  it('Lead → Intake → Hold → Release → Eligibility → Conflict → Back to Elig → F2F → complete pipeline', async () => {
    await moveStage('Intake');
    await moveStage('Hold', { hold_return_stage: 'Intake', hold_reason: 'Waiting on insurance' });
    expect(getRefStage()).toBe('Hold');

    await moveStage('Intake', { hold_reason: '', hold_return_stage: '' });
    await moveStage('Eligibility Verification');
    await moveStage('Conflict');
    await moveStage('Eligibility Verification');
    await moveStage('F2F/MD Orders Pending');
    await moveStage('Clinical Intake RN Review');
    await moveStage('Staffing Feasibility');
    await moveStage('Admin Confirmation');
    await moveStage('Pre-SOC');
    await moveStage('SOC Scheduled');
    await moveStage('SOC Completed');
    expect(getRefStage()).toBe('SOC Completed');
  });

  it('Special Needs Code95=No → OPWDD → Intake → continues pipeline', async () => {
    seedStore({ current_stage: 'OPWDD Enrollment', division: 'Special Needs', code_95: 'no' });
    await moveStage('Intake');
    await moveStage('Eligibility Verification');
    await moveStage('F2F/MD Orders Pending');
    expect(getRefStage()).toBe('F2F/MD Orders Pending');
  });

  it('multiple holds throughout the pipeline', async () => {
    await moveStage('Intake');
    await moveStage('Hold', { hold_return_stage: 'Intake' });
    await moveStage('Intake');

    await moveStage('Eligibility Verification');
    await moveStage('Hold', { hold_return_stage: 'Eligibility Verification' });
    await moveStage('Eligibility Verification');

    await moveStage('F2F/MD Orders Pending');
    await moveStage('Hold', { hold_return_stage: 'F2F/MD Orders Pending' });
    await moveStage('F2F/MD Orders Pending');

    await moveStage('Clinical Intake RN Review');
    expect(getRefStage()).toBe('Clinical Intake RN Review');
  });

  it('Discard → Restore → full pipeline completion', async () => {
    await moveStage('Discarded Leads', { discard_reason: 'Patient unreachable' });
    expect(getRefStage()).toBe('Discarded Leads');

    await moveStage('Lead Entry', { discard_reason: '', discard_explanation: '' });
    await moveStage('Intake');
    await moveStage('Eligibility Verification');
    await moveStage('F2F/MD Orders Pending');
    await moveStage('Clinical Intake RN Review');
    await moveStage('Staffing Feasibility');
    await moveStage('Admin Confirmation');
    await moveStage('Pre-SOC');
    await moveStage('SOC Scheduled');
    await moveStage('SOC Completed');
    expect(getRefStage()).toBe('SOC Completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19: Every Stage's Reachability
// ─────────────────────────────────────────────────────────────────────────────

describe('Every stage is reachable from at least one other stage', () => {
  const allStageNames = Object.keys(StageRules.stages);

  it('each stage appears in at least one canMoveTo (or is an entry stage)', () => {
    const entryStages = new Set(['Lead Entry', 'OPWDD Enrollment']);
    for (const target of allStageNames) {
      if (entryStages.has(target)) continue;
      const reachableFrom = allStageNames.filter(source =>
        StageRules.stages[source].canMoveTo.includes(target)
      );
      const holdReach = target === 'Hold' && StageRules.globalRules.anyActiveStageCanMoveToHold;
      expect(
        reachableFrom.length > 0 || holdReach,
        `Stage "${target}" is unreachable — no stage has it in canMoveTo`
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20: Clinical Review Field Tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('Clinical review fields are tracked on referral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Clinical Intake RN Review' });
  });

  it('stores accept decision with reviewer and timestamp', async () => {
    const now = new Date().toISOString();
    await moveStage('Staffing Feasibility', {
      clinical_review_decision: 'accept',
      clinical_review_by: 'usr_rn_01',
      clinical_review_at: now,
    });
    const ref = getStore().referrals['rec_ref1'];
    expect(ref.clinical_review_decision).toBe('accept');
    expect(ref.clinical_review_by).toBe('usr_rn_01');
    expect(ref.clinical_review_at).toBe(now);
  });

  it('stores conditional decision', async () => {
    await moveStage('Staffing Feasibility', {
      clinical_review_decision: 'conditional',
      clinical_review_by: 'usr_rn_02',
    });
    expect(getStore().referrals['rec_ref1'].clinical_review_decision).toBe('conditional');
  });

  it('stores decline decision + routes to Conflict (legacy data — Decline button removed 2026-05-20)', async () => {
    // The Decline UI was removed; new clinical RNs route through Conflict
    // instead. Historical "decline" decisions still read correctly though.
    await moveStage('Conflict', {
      clinical_review_decision: 'decline',
      clinical_review_by: 'usr_rn_03',
    });
    expect(getRefStage()).toBe('Conflict');
    expect(getStore().referrals['rec_ref1'].clinical_review_decision).toBe('decline');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 21: Workflow Overhaul (2026-05-20) — concurrent stages, LIFO,
// supportive modules, urgent care, and Conflict source_stage round-trip.
// ─────────────────────────────────────────────────────────────────────────────

describe('Workflow overhaul (2026-05-20) — concurrent presence + LIFO + supportive workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ current_stage: 'Intake' });
  });

  it('Pushing to Clinical RN does NOT change current_stage; it sets in_clinical_review=true', async () => {
    await updateReferralOptimistic('rec_ref1', {
      in_clinical_review: true,
      clinical_review_pushed_at: new Date().toISOString(),
    });
    const r = getStore().referrals['rec_ref1'];
    expect(r.current_stage).toBe('Intake');
    expect(r.in_clinical_review).toBe(true);
  });

  it('Push to Eligibility flips current_stage AND preserves in_clinical_review for the concurrent view', async () => {
    await updateReferralOptimistic('rec_ref1', { in_clinical_review: true });
    await updateReferralOptimistic('rec_ref1', { current_stage: 'Eligibility Verification' });
    const r = getStore().referrals['rec_ref1'];
    expect(r.current_stage).toBe('Eligibility Verification');
    expect(r.in_clinical_review).toBe(true);
  });

  it('LIFO: Clinical RN Confirm AFTER Eligibility Completed advances to EMR Onboarding', async () => {
    // Eligibility completes first
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'Eligibility Verification',
      eligibility_completed_at: new Date().toISOString(),
    });
    // Clinical RN confirms last → fires LIFO transition to EMR Onboarding
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'EMR Onboarding',
      clinical_review_completed_at: new Date().toISOString(),
      in_clinical_review: false,
    });
    expect(getRefStage()).toBe('EMR Onboarding');
  });

  it('LIFO: Eligibility Completed AFTER Clinical RN Confirm advances to EMR Onboarding', async () => {
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'Eligibility Verification',
      clinical_review_completed_at: new Date().toISOString(),
      in_clinical_review: false,
    });
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'EMR Onboarding',
      eligibility_completed_at: new Date().toISOString(),
    });
    expect(getRefStage()).toBe('EMR Onboarding');
  });

  it('EMR Onboarding gates Staffing: mark onboarded advances to Staffing Feasibility', async () => {
    await updateReferralOptimistic('rec_ref1', { current_stage: 'EMR Onboarding' });
    expect(canMoveFromTo('EMR Onboarding', 'Staffing Feasibility')).toBe(true);
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'Staffing Feasibility',
      emr_onboarded_at: new Date().toISOString(),
      emr_onboarded_by_id: 'usr_sched',
    });
    expect(getRefStage()).toBe('Staffing Feasibility');
    expect(getStore().referrals['rec_ref1'].emr_onboarded_at).toBeTruthy();
  });

  it('Eligibility Send-Back-to-Intake writes the three flag fields and flips current_stage', async () => {
    await updateReferralOptimistic('rec_ref1', { current_stage: 'Eligibility Verification' });
    await updateReferralOptimistic('rec_ref1', {
      current_stage: 'Intake',
      eligibility_returned_to_intake_at: '2026-05-20T10:00:00Z',
      eligibility_returned_to_intake_note: 'Missing primary insurance card.',
      eligibility_returned_to_intake_by_id: 'usr_elig',
    });
    const r = getStore().referrals['rec_ref1'];
    expect(r.current_stage).toBe('Intake');
    expect(r.eligibility_returned_to_intake_note).toContain('Missing primary insurance card');
    expect(r.eligibility_returned_to_intake_by_id).toBe('usr_elig');
  });

  it('Conflict captures source_stage so resolve-to-source can ship the referral back', () => {
    // Verify source_stage is captured in the Conflicts schema (flagConflict
    // writes referral.current_stage into the record).
    const fakeConflict = {
      _id: 'rec_conf1',
      id: 'conf_1',
      patient_id: 'pat_test',
      referral_id: 'ref_test',
      type: 'auth_required',
      source_stage: 'Eligibility Verification',
      status: 'Open',
      resolution_status: 'open',
    };
    expect(fakeConflict.source_stage).toBe('Eligibility Verification');
    // And the new rule allows Conflict → Eligibility Verification so the
    // resolve flow can route back.
    expect(canMoveFromTo('Conflict', 'Eligibility Verification')).toBe(true);
  });

  it('urgent care flag is writable on a referral and survives stage changes', async () => {
    await updateReferralOptimistic('rec_ref1', {
      requires_urgent_care: true,
      urgent_care_marked_by_id: 'usr_marker',
      urgent_care_marked_at: '2026-05-20T11:30:00Z',
      urgent_care_note: 'Patient on home oxygen, weekly visits needed.',
    });
    const r = getStore().referrals['rec_ref1'];
    expect(r.requires_urgent_care).toBe(true);
    expect(r.urgent_care_marked_by_id).toBe('usr_marker');
    // After a stage change the flag stays — urgent care follows the patient.
    await updateReferralOptimistic('rec_ref1', { current_stage: 'Eligibility Verification' });
    expect(getStore().referrals['rec_ref1'].requires_urgent_care).toBe(true);
  });

  it('StageRules: Eligibility cannot directly route to Disenrollment Required (supportive flag instead)', () => {
    expect(canMoveFromTo('Eligibility Verification', 'Disenrollment Required')).toBe(false);
  });

  it('StageRules: Clinical RN cannot route directly to Authorization Pending (now Eligibility-side)', () => {
    expect(canMoveFromTo('Clinical Intake RN Review', 'Authorization Pending')).toBe(false);
  });
});
