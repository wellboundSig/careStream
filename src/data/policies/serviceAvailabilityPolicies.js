/**
 * Service availability policies — which services can be requested,
 * authorized, or billed given the division / facility setting.
 *
 * SAFETY PRINCIPLE
 * - ABA is deliberately removed from the Authorization workflow. It is not
 *   a billable CHHA service line in this system.
 * - HHA cannot be a billable service line in ALF because the duplication
 *   risk with ALF-provided personal care is the single highest-audit-risk
 *   pattern in this product. This is a HARD rule; no override path.
 */

import {
  AUTH_SERVICE,
  ALL_AUTH_SERVICES,
  DIVISION,
  FACILITY_SETTING,
} from '../eligibilityEnums.js';

// ABA is never available in the authorization flow. Intentional.
const BASE_ALLOWED_SERVICES = ALL_AUTH_SERVICES.filter((s) => s !== 'ABA');

/**
 * Which services can appear as selectable options in the Authorization form?
 *
 * @param {object} input
 * @param {string} [input.division]        DIVISION.*
 * @param {string} [input.facilitySetting] FACILITY_SETTING.* (optional)
 * @returns {{ allowed: string[], blocked: Array<{ service: string, reason: string }> }}
 */
export function determineAllowedServicesByDivision({ division, facilitySetting } = {}) {
  const blocked = [];
  let allowed = [...BASE_ALLOWED_SERVICES];

  const isALF = division === DIVISION.ALF || facilitySetting === FACILITY_SETTING.ALF;

  if (isALF) {
    // HHA is explicitly not billable in ALF per business rule.
    allowed = allowed.filter((s) => s !== AUTH_SERVICE.HHA);
    blocked.push({
      service: AUTH_SERVICE.HHA,
      reason: 'ALF provides HHA-equivalent personal care. Billing HHA from the CHHA creates duplication risk.',
    });
  }

  // ABA is always blocked in this module.
  blocked.push({
    service: 'ABA',
    reason: 'ABA is not an authorized service line in this CHHA workflow.',
  });

  return { allowed, blocked };
}

/**
 * True if a given service is allowed in the auth workflow, given context.
 */
export function isServiceAllowed(service, ctx = {}) {
  const { allowed } = determineAllowedServicesByDivision(ctx);
  return allowed.includes(service);
}

/**
 * Validate a `servicesRequested[]` or `servicesAuthorized[]` list.
 * Returns invalid services with human-readable reasons.
 */
export function validateRequestedServices(services = [], ctx = {}) {
  const { allowed, blocked } = determineAllowedServicesByDivision(ctx);
  const blockedMap = Object.fromEntries(blocked.map((b) => [b.service, b.reason]));
  const errors = [];
  for (const s of services) {
    if (!allowed.includes(s)) {
      errors.push({
        service: s,
        reason: blockedMap[s] || `Service ${s} is not allowed in this setting`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}
