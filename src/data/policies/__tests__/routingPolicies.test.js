import { describe, it, expect } from 'vitest';
import {
  determineAllowedRoutingActionsForEligibility,
  determineAllowedRoutingActionsForAuthorization,
  shouldSuggestOPWDDRouting,
  canPerformRoutingAction,
} from '../routingPolicies.js';
import {
  ROUTING_ACTION,
  VERIFICATION_STATUS,
  AUTH_STATUS,
  DIVISION,
} from '../../eligibilityEnums.js';

describe('determineAllowedRoutingActionsForEligibility', () => {
  it('always offers Send to Conflict and Disenrollment Assist', () => {
    const out = determineAllowedRoutingActionsForEligibility({ verifications: [] });
    const actions = out.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      ROUTING_ACTION.SEND_TO_CONFLICT,
      ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST,
    ]));
  });

  it('offers Advance to Authorization when there is an active insurance and no denials', () => {
    const out = determineAllowedRoutingActionsForEligibility({
      verifications: [{ verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE }],
    });
    expect(out.map((a) => a.action)).toContain(ROUTING_ACTION.ADVANCE_TO_AUTHORIZATION);
  });

  it('does NOT offer OPWDD routing unless criteria explicitly flagged', () => {
    const out = determineAllowedRoutingActionsForEligibility({ verifications: [] });
    expect(out.map((a) => a.action)).not.toContain(ROUTING_ACTION.ROUTE_TO_OPWDD);
  });

  it('offers OPWDD routing when flagged', () => {
    const out = determineAllowedRoutingActionsForEligibility({ verifications: [], opwddCriteriaMet: true });
    expect(out.map((a) => a.action)).toContain(ROUTING_ACTION.ROUTE_TO_OPWDD);
  });

  it('hides Advance when any insurance is denied/inactive', () => {
    const out = determineAllowedRoutingActionsForEligibility({
      verifications: [
        { verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE },
        { verificationStatus: VERIFICATION_STATUS.DENIED_NOT_FOUND },
      ],
    });
    expect(out.map((a) => a.action)).not.toContain(ROUTING_ACTION.ADVANCE_TO_AUTHORIZATION);
  });
});

describe('determineAllowedRoutingActionsForAuthorization', () => {
  it('mirrors authorization policy output with labels', () => {
    const out = determineAllowedRoutingActionsForAuthorization({ authStatus: AUTH_STATUS.DENIED, division: DIVISION.SPECIAL_NEEDS });
    const actions = out.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      ROUTING_ACTION.SEND_TO_CONFLICT,
      ROUTING_ACTION.SEND_TO_FOLLOW_UP,
      ROUTING_ACTION.REQUEST_SCA,
    ]));
  });
});

describe('shouldSuggestOPWDDRouting', () => {
  it('suggests when code 95 is No', () => {
    expect(shouldSuggestOPWDDRouting({ code95: 'No' }).suggest).toBe(true);
  });

  it('does not suggest with no signals', () => {
    expect(shouldSuggestOPWDDRouting({}).suggest).toBe(false);
  });

  it('suggests for DD clinical category', () => {
    expect(shouldSuggestOPWDDRouting({ clinicalCategory: 'developmentally_disabled' }).suggest).toBe(true);
  });
});

describe('canPerformRoutingAction', () => {
  it('rejects SEND_TO_CONFLICT without reasons', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.SEND_TO_CONFLICT, { reasons: [] }).ok).toBe(false);
  });

  it('accepts SEND_TO_CONFLICT with reasons', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.SEND_TO_CONFLICT, { reasons: ['coverage_not_active'] }).ok).toBe(true);
  });

  it('rejects SEND_TO_FOLLOW_UP without owner or date', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.SEND_TO_FOLLOW_UP, { followUpDate: '2026-05-01' }).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.SEND_TO_FOLLOW_UP, { followUpOwnerUserId: 'u1' }).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.SEND_TO_FOLLOW_UP, { followUpDate: '2026-05-01', followUpOwnerUserId: 'u1' }).ok).toBe(true);
  });

  it('rejects REQUEST_SCA outside Special Needs division', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.REQUEST_SCA, { division: DIVISION.ALF }).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.REQUEST_SCA, { division: DIVISION.SPECIAL_NEEDS }).ok).toBe(true);
  });

  it('rejects OPWDD route without explicit staff confirmation', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.ROUTE_TO_OPWDD, {}).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.ROUTE_TO_OPWDD, { confirmedByUserId: 'u1' }).ok).toBe(true);
  });

  it('rejects disenrollment assist without note + follow-up', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST, { note: 'need assist' }).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST, {
      note: 'need assist',
      followUpDate: '2026-05-01',
      followUpOwnerUserId: 'u1',
    }).ok).toBe(true);
  });

  it('advance to staffing only when approved or NAR', () => {
    expect(canPerformRoutingAction(ROUTING_ACTION.ADVANCE_TO_STAFFING, { authStatus: AUTH_STATUS.DENIED }).ok).toBe(false);
    expect(canPerformRoutingAction(ROUTING_ACTION.ADVANCE_TO_STAFFING, { authStatus: AUTH_STATUS.APPROVED }).ok).toBe(true);
    expect(canPerformRoutingAction(ROUTING_ACTION.ADVANCE_TO_STAFFING, { authStatus: AUTH_STATUS.NAR }).ok).toBe(true);
  });

  it('unknown action returns ok=false', () => {
    expect(canPerformRoutingAction('unknown', {}).ok).toBe(false);
  });
});
