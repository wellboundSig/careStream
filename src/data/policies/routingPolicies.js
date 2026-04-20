/**
 * Routing policies — what explicit routing options are available given a
 * module + state. These are pure functions; the UI calls them to render
 * buttons and the backend calls them to reject unknown routes.
 *
 * SAFETY PRINCIPLE
 * - Nothing here auto-fires. Every routing action needs an explicit user
 *   invocation with audit metadata (user, time, reason, source module).
 */

import {
  AUTH_STATUS,
  VERIFICATION_STATUS,
  ROUTING_ACTION,
  DIVISION,
} from '../eligibilityEnums.js';

import { determineAllowedAuthorizationPaths } from './authorizationPolicies.js';

/**
 * For an Eligibility workspace, what routes may staff choose?
 *
 * @param {object} ctx
 * @param {object[]} [ctx.verifications] Current verification records
 * @param {string}   [ctx.division]      DIVISION.*
 * @param {boolean}  [ctx.opwddCriteriaMet] Optional staff-marked flag
 * @returns {{ action: string, label: string, note: string }[]}
 */
export function determineAllowedRoutingActionsForEligibility(ctx = {}) {
  const actions = [];
  const { verifications = [], opwddCriteriaMet } = ctx;

  const anyDenied = verifications.some((v) =>
    v.verificationStatus === VERIFICATION_STATUS.DENIED_NOT_FOUND ||
    v.verificationStatus === VERIFICATION_STATUS.CONFIRMED_INACTIVE);

  const anyActive = verifications.some((v) => v.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE);

  // Always present — staff may escalate anything.
  actions.push({
    action: ROUTING_ACTION.SEND_TO_CONFLICT,
    label:  'Send to Conflict',
    note:   'Requires at least one structured conflict reason.',
  });

  if (opwddCriteriaMet) {
    actions.push({
      action: ROUTING_ACTION.ROUTE_TO_OPWDD,
      label:  'Route to OPWDD Flow',
      note:   'Requires staff confirmation and audit trail.',
    });
  }

  actions.push({
    action: ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST,
    label:  'Flag for Expert Medicaid Disenrollment Assistance',
    note:   'Requires note and a follow-up owner.',
  });

  if (anyActive && !anyDenied) {
    actions.push({
      action: ROUTING_ACTION.ADVANCE_TO_AUTHORIZATION,
      label:  'Advance to Authorization',
      note:   'Requires at least one confirmed active payer and a confirmed order rank.',
    });
  }
  return actions;
}

/**
 * For the Authorization module, thin wrapper delegating to
 * `determineAllowedAuthorizationPaths`. UI consumes this to render buttons.
 *
 * @param {object} ctx
 * @param {string} ctx.authStatus
 * @param {string} [ctx.division]
 */
export function determineAllowedRoutingActionsForAuthorization(ctx = {}) {
  const allowed = determineAllowedAuthorizationPaths(ctx);
  return allowed.map((a) => ({ action: a, label: LABEL_FOR[a] || a, note: NOTE_FOR[a] || '' }));
}

const LABEL_FOR = {
  [ROUTING_ACTION.SEND_TO_CONFLICT]:          'Send to Conflict',
  [ROUTING_ACTION.SEND_TO_FOLLOW_UP]:         'Schedule Follow-Up',
  [ROUTING_ACTION.REQUEST_SCA]:               'Request Single Case Agreement',
  [ROUTING_ACTION.ROUTE_TO_OPWDD]:            'Route to OPWDD Flow',
  [ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST]: 'Flag for Expert Disenrollment Assist',
  [ROUTING_ACTION.ADVANCE_TO_AUTHORIZATION]:  'Advance to Authorization',
  [ROUTING_ACTION.ADVANCE_TO_STAFFING]:       'Advance to Staffing',
};

const NOTE_FOR = {
  [ROUTING_ACTION.SEND_TO_CONFLICT]:          'Requires at least one conflict reason.',
  [ROUTING_ACTION.SEND_TO_FOLLOW_UP]:         'Requires follow-up date and owner.',
  [ROUTING_ACTION.REQUEST_SCA]:               'SPN-only. Adds SCA tracking record.',
};

/**
 * Should the Eligibility workspace suggest OPWDD routing?
 *
 * We refuse to auto-route. This returns a SUGGESTION flag with human-readable
 * rationale. The UI then shows a button; the button only fires the route on
 * explicit click.
 *
 * @param {object} ctx
 * @param {string} [ctx.code95]         Referral.code_95
 * @param {string} [ctx.clinicalCategory]
 * @param {string} [ctx.snAgeGroup]     'Adult' | 'Pediatric'
 * @returns {{ suggest: boolean, reasons: string[] }}
 */
export function shouldSuggestOPWDDRouting({ code95, clinicalCategory, snAgeGroup } = {}) {
  const reasons = [];
  if (code95 === 'no' || code95 === 'No' || code95 === 'NO') {
    reasons.push('Referral code 95 = No.');
  }
  if (clinicalCategory === 'developmentally_disabled') {
    reasons.push('Clinical category flagged as developmentally disabled.');
  }
  if (snAgeGroup === 'Adult' && clinicalCategory === 'developmentally_disabled') {
    reasons.push('Adult SN with DD profile.');
  }
  return { suggest: reasons.length > 0, reasons };
}

/**
 * True when the requested routing action satisfies preconditions. Callers
 * must still pass the captured payload (reasons, follow-up data, etc.)
 * through the record validators before persisting.
 */
export function canPerformRoutingAction(action, payload = {}) {
  switch (action) {
    case ROUTING_ACTION.SEND_TO_CONFLICT:
      return {
        ok: Array.isArray(payload.reasons) && payload.reasons.length > 0,
        error: 'Conflict requires at least one structured reason.',
      };
    case ROUTING_ACTION.SEND_TO_FOLLOW_UP:
      return {
        ok: !!(payload.followUpDate && payload.followUpOwnerUserId),
        error: 'Follow-up requires date and owner.',
      };
    case ROUTING_ACTION.REQUEST_SCA:
      return {
        ok: payload.division === DIVISION.SPECIAL_NEEDS,
        error: 'SCA is only available for Special Needs division.',
      };
    case ROUTING_ACTION.ROUTE_TO_OPWDD:
      return {
        ok: !!payload.confirmedByUserId,
        error: 'OPWDD routing requires explicit staff confirmation.',
      };
    case ROUTING_ACTION.FLAG_DISENROLLMENT_ASSIST:
      return {
        ok: !!(payload.note && payload.followUpDate && payload.followUpOwnerUserId),
        error: 'Disenrollment assist flag requires note, follow-up date, and owner.',
      };
    case ROUTING_ACTION.ADVANCE_TO_AUTHORIZATION:
      return {
        ok: !!payload.hasConfirmedActiveInsurance,
        error: 'Advance to authorization requires at least one confirmed active insurance.',
      };
    case ROUTING_ACTION.ADVANCE_TO_STAFFING:
      return {
        ok: payload.authStatus === AUTH_STATUS.APPROVED || payload.authStatus === AUTH_STATUS.NAR,
        error: 'Advance to staffing requires Approved or NAR authorization.',
      };
    default:
      return { ok: false, error: `Unknown routing action: ${action}` };
  }
}
