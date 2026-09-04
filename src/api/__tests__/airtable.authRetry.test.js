/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('aurora 401 token refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries a 401 once with a fresh Clerk token', async () => {
    const getToken = vi.fn()
      .mockResolvedValueOnce('expired-jwt')
      .mockResolvedValueOnce('fresh-jwt');
    vi.stubGlobal('Clerk', { session: { getToken } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { type: 'UNAUTHORIZED', message: 'Missing or invalid token' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'rec1', fields: { content: 'hi' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { default: airtable } = await import('../airtable.js');
    const rec = await airtable.create('Notes', { content: 'hi' });
    expect(rec.id).toBe('rec1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls[1][0]).toEqual({ skipCache: true });
    const retryAuth = fetchMock.mock.calls[1][1].headers.Authorization;
    expect(retryAuth).toBe('Bearer fresh-jwt');
  });
});
