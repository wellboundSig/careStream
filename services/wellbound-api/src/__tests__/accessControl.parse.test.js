import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmail,
  normalizeEmail,
  parsePermissionKeys,
} from '../accessControl.js';

describe('normalizeEmail / extractEmail', () => {
  it('reads standard claim fields', () => {
    assert.equal(extractEmail({ email: 'Rafi@WellboundHC.com' }), 'rafi@wellboundhc.com');
    assert.equal(extractEmail({ primary_email_address: 'a@b.com' }), 'a@b.com');
    assert.equal(extractEmail({ emails: ['c@d.com'] }), 'c@d.com');
  });

  it('uses X-User-Email only for the Clerk test issuer', () => {
    assert.equal(
      extractEmail({ iss: 'https://upright-platypus-97.clerk.accounts.dev' }, 'mordy@wellboundhc.com'),
      'mordy@wellboundhc.com',
    );
    assert.equal(
      extractEmail({ iss: 'https://clerk.wellboundcarestream.com' }, 'mordy@wellboundhc.com'),
      '',
    );
  });

  it('prefers a signed claim over the hint', () => {
    assert.equal(
      extractEmail(
        { iss: 'https://upright-platypus-97.clerk.accounts.dev', email: 'rafi@wellboundhc.com' },
        'spoof@evil.test',
      ),
      'rafi@wellboundhc.com',
    );
  });

  it('normalizes empty values', () => {
    assert.equal(normalizeEmail('  '), '');
    assert.equal(extractEmail({}), '');
  });
});

describe('parsePermissionKeys', () => {
  it('parses a JSON array string', () => {
    const keys = parsePermissionKeys('["clinical.eligibility_optum_auto","clinical.eligibility_batch"]');
    assert.deepEqual(keys, ['clinical.eligibility_optum_auto', 'clinical.eligibility_batch']);
  });

  it('accepts an already-parsed array', () => {
    assert.deepEqual(parsePermissionKeys(['a', 'b']), ['a', 'b']);
  });

  it('unwraps a double-encoded string', () => {
    assert.deepEqual(parsePermissionKeys(JSON.stringify('["a"]')), ['a']);
  });

  it('returns empty on junk', () => {
    assert.deepEqual(parsePermissionKeys(''), []);
    assert.deepEqual(parsePermissionKeys(null), []);
    assert.deepEqual(parsePermissionKeys({ foo: true }), []);
    assert.deepEqual(parsePermissionKeys('not-json'), []);
  });
});
