import type { ApiClient, ApiResult } from './client';
import { PING_PATH, pingApi } from './ping';

/** A client whose only read answers `result`, recording the path it was asked for. */
function clientAnswering(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

describe('pingApi', () => {
  it('is true when the System ping route answers', async () => {
    const client = clientAnswering({
      ok: true,
      status: 200,
      data: { status: 'ok', service: 'Butler.Api', timestampUtc: '2026-11-15T10:00:00Z' },
      etag: null,
    });

    await expect(pingApi(client)).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith(PING_PATH);
    expect(PING_PATH).toBe('/api/system/ping');
  });

  it.each<[string, ApiResult<unknown>]>([
    ['an unreachable API', { ok: false, error: { kind: 'network', status: 0, title: 'down' } }],
    ['a proxy 502', { ok: false, error: { kind: 'http', status: 502, title: 'Bad Gateway' } }],
    ['an unparseable body', { ok: false, error: { kind: 'parse', status: 200, title: 'Bad JSON' } }],
  ])('is false for %s', async (_label, result) => {
    await expect(pingApi(clientAnswering(result))).resolves.toBe(false);
  });
});
