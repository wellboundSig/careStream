#!/usr/bin/env node
/**
 * Local clearinghouse credential + connectivity test.
 * Reads .deploy-secrets.eligibility.env (gitignored). No chart data involved.
 *
 * Usage:
 *   node scripts/test-eligibility.js                 # test everything configured
 *   node scripts/test-eligibility.js --availity qua  # only Availity QUA
 *   node scripts/test-eligibility.js --waystar       # only the Waystar gateway probe
 *
 * What each test proves:
 *   Availity: OAuth token issued  → key+secret valid for that environment.
 *   Optum:    OAuth token issued  → key+secret valid (sandbox or prod).
 *   Waystar:  gateway reachability + auth classification. "Authentication
 *             Failure" = wrong creds OR this machine's IP is not on the
 *             Waystar allowlist. Any other response = credentials accepted.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SECRETS = join(ROOT, '.deploy-secrets.eligibility.env');

function loadEnvFile(path) {
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

const env = { ...loadEnvFile(SECRETS), ...process.env };
const args = process.argv.slice(2);
const only = {
  availity: args.includes('--availity'),
  waystar: args.includes('--waystar'),
  optum: args.includes('--optum'),
};
const runAll = !only.availity && !only.waystar && !only.optum;
const availityEnvArg = args[args.indexOf('--availity') + 1];

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';
const results = [];

function report(name, status, detail) {
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function testAvailityToken(label, clientId, clientSecret, host) {
  if (!clientId) return report(`Availity ${label}`, SKIP, 'no client id in secrets file');
  if (!clientSecret) return report(`Availity ${label}`, SKIP, `client id present but no secret — get the client_secret for this app from the Availity portal`);
  try {
    const res = await fetch(`https://${host}/availity/v1/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'hipaa',
      }).toString(),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    if (res.ok && body.access_token) {
      report(`Availity ${label}`, PASS, `token issued (expires_in=${body.expires_in}s)`);
    } else {
      report(`Availity ${label}`, FAIL, `HTTP ${res.status}: ${body.error_description || body.error || JSON.stringify(body).slice(0, 160)}`);
    }
  } catch (err) {
    report(`Availity ${label}`, FAIL, err.message);
  }
}

async function testOptumToken(label, clientId, clientSecret, sandbox) {
  if (!clientId) return report(`Optum ${label}`, SKIP, 'no client id in secrets file');
  if (!clientSecret) return report(`Optum ${label}`, SKIP, 'client id present but no secret — get the client_secret from the Optum developer portal');
  const url = sandbox
    ? 'https://sandbox-apigw.optum.com/apip/auth/v2/token'
    : 'https://apigw.optum.com/apip/auth/v2/token';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    if (res.ok && body.access_token) {
      report(`Optum ${label}`, PASS, `token issued (products: ${body.api_product_list || 'n/a'})`);
    } else {
      report(`Optum ${label}`, FAIL, `HTTP ${res.status}: ${body.error_description || body.error || JSON.stringify(body).slice(0, 160)}`);
    }
  } catch (err) {
    report(`Optum ${label}`, FAIL, err.message);
  }
}

async function testWaystarGateway() {
  const userId = env.WAYSTAR_API_USERID;
  const password = env.WAYSTAR_API_PASSWORD;
  const gateway = env.WAYSTAR_GATEWAY_URL || 'https://eligibilityapi.zirmed.com/1.0/Rest/Gateway/GatewayAsync.ashx';
  if (!userId || !password) return report('Waystar gateway', SKIP, 'no WAYSTAR_API_USERID / WAYSTAR_API_PASSWORD');
  try {
    // Documented contract (Waystar "Insurance Verification" doc): X12 270 in
    // `Data` with DataFormat/ResponseType, against test payer 33333 which
    // returns a SIMULATED Medicare 271 (never sent to a real payer).
    const { buildX12_270 } = await import('../src/waystarEligibility.js');
    const x12 = buildX12_270({
      senderId: userId, payerId: '33333', payerName: 'MEDICARE',
      orgName: 'WELLBOUND LLC', npi: '1518305572',
      memberId: '1AA1AA1AA11', firstName: 'JOHN', lastName: 'TEST',
      dob: '19500101', dateOfService: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    });
    const form = new URLSearchParams({
      UserID: userId,
      Password: password,
      DataFormat: 'X12',
      ResponseType: env.WAYSTAR_RESPONSE_TYPE || '271',
      Data: x12,
    });
    if (env.WAYSTAR_CUST_ID) form.set('CustID', env.WAYSTAR_CUST_ID);
    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const text = (await res.text());
    if (/authentication failure/i.test(text) || res.status === 401) {
      report('Waystar gateway', FAIL, `auth rejected (401). Per Waystar docs, UserID/Password must be a Waystar WEB USER login with eligibility access — the SSO Settings→Key/Pass API key is a different credential. Current egress IP: ${await myIp()}`);
    } else if (res.status === 403) {
      report('Waystar gateway', FAIL, 'HTTP 403 — credentials valid but the account is not set up for Eligibility. Contact Waystar.');
    } else if (/empty request received/i.test(text)) {
      report('Waystar gateway', FAIL, 'gateway did not find the 270 payload — payload field contract changed?');
    } else if (res.status === 200 && /~EB[|*]/.test(text)) {
      report('Waystar gateway', PASS, `HTTP 200 — simulated Medicare 271 returned with benefit segments. Fully working end-to-end.`);
    } else {
      const head = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
      report('Waystar gateway', PASS, `HTTP ${res.status}, auth + payload accepted. Response head: ${JSON.stringify(head)}`);
    }
  } catch (err) {
    report('Waystar gateway', FAIL, `unreachable: ${err.message}`);
  }
}

async function myIp() {
  try {
    const res = await fetch('https://checkip.amazonaws.com', { signal: AbortSignal.timeout(4000) });
    return (await res.text()).trim();
  } catch { return 'unknown'; }
}

console.log('\nClearinghouse credential tests\n');

if (runAll || only.availity) {
  if (!availityEnvArg || availityEnvArg === 'qua' || availityEnvArg.startsWith('--')) {
    await testAvailityToken('QUA (test)', env.AVAILITY_QUA_CLIENT_ID, env.AVAILITY_QUA_CLIENT_SECRET, 'qua.api.availity.com');
  }
  if (!availityEnvArg || availityEnvArg === 'prod' || availityEnvArg.startsWith('--')) {
    await testAvailityToken('production', env.AVAILITY_CLIENT_ID, env.AVAILITY_CLIENT_SECRET, 'api.availity.com');
  }
  if (availityEnvArg === 'demo') {
    await testAvailityToken('demo app', env.AVAILITY_DEMO_CLIENT_ID, env.AVAILITY_DEMO_CLIENT_SECRET, 'api.availity.com');
  }
}
if (runAll || only.optum) {
  await testOptumToken('demo (sandbox)', env.OPTUM_DEMO_CLIENT_ID, env.OPTUM_DEMO_CLIENT_SECRET, true);
  await testOptumToken('app (production)', env.OPTUM_APP_CLIENT_ID, env.OPTUM_APP_CLIENT_SECRET, false);
}
if (runAll || only.waystar) {
  await testWaystarGateway();
}

const failed = results.filter((r) => r.status === FAIL).length;
const skipped = results.filter((r) => r.status === SKIP).length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped\n`);
process.exit(failed ? 1 : 0);
