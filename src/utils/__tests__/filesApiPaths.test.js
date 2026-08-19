import { describe, expect, it } from 'vitest';
import { sanitizeFilename, sanitizeOwnerId } from '../../../services/files-api/src/pathUtil.js';

describe('files-api path sanitizers', () => {
  it('keeps a spaced owner id (encoded by the client, decoded by the API)', () => {
    expect(sanitizeOwnerId('Hari Achary')).toBe('Hari Achary');
  });

  it('blocks path traversal in owner ids', () => {
    expect(sanitizeOwnerId('../CareStream/files/x')).toBe('CareStream/files/x');
  });

  it('allows an issue-reports prefix', () => {
    expect(sanitizeOwnerId('issue-reports/usr_1')).toBe('issue-reports/usr_1');
  });

  it('flattens slashes and dots in filenames', () => {
    const name = sanitizeFilename('../../secret.pdf');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name.endsWith('secret.pdf')).toBe(true);
  });
});
