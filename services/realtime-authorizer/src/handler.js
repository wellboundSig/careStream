/**
 * realtime-authorizer — AppSync Events Lambda authorizer.
 *
 * Browsers connect to the Events WebSocket with their Clerk session JWT as
 * the authorization token; this verifies it (same JWKS logic as wellbound-api)
 * so only signed-in staff can subscribe to change events. Publishing uses the
 * server-side API key and never hits this authorizer.
 *
 * AppSync contract: receive { authorizationToken }, return { isAuthorized }.
 * ttlOverride caches the decision (seconds) so reconnects are cheap.
 */

import { verifyClerkJWT } from './clerkJwt.js';

export async function handler(event) {
  const token = event.authorizationToken || '';
  const payload = await verifyClerkJWT(token);
  return {
    isAuthorized: !!payload,
    ttlOverride: 300,
    resolverContext: payload ? { sub: payload.sub } : {},
  };
}
