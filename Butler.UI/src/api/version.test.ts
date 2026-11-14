import type { ApiClient, ApiResult } from './client';
import { VERSION_PATH, fetchApiVersion } from './version';

/** A client whose only read answers `result`, recording the path it was asked for. */
function clientAnswering(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });

describe('fetchApiVersion', () => {
  it('reads the sha and build time from the System version route', async () => {
    const client = clientAnswering(ok({ sha: 'abc1234', buildTime: '2026-11-14T10:00:00Z' }));

    await expect(fetchApiVersion(client)).resolves.toEqual({
      sha: 'abc1234',
      buildTime: '2026-11-14T10:00:00Z',
    });
    expect(client.get).toHaveBeenCalledWith(VERSION_PATH);
    expect(VERSION_PATH).toBe('/api/system/version');
  });

  it('keeps a null build time as null', async () => {
    await expect(fetchApiVersion(clientAnswering(ok({ sha: 'dev', buildTime: null })))).resolves.toEqual({
      sha: 'dev',
      buildTime: null,
    });
  });

  it('treats a non-string or missing build time as null', async () => {
    await expect(fetchApiVersion(clientAnswering(ok({ sha: 'abc1234', buildTime: 42 })))).resolves.toEqual({
      sha: 'abc1234',
      buildTime: null,
    });
    await expect(fetchApiVersion(clientAnswering(ok({ sha: 'abc1234' })))).resolves.toEqual({
      sha: 'abc1234',
      buildTime: null,
    });
  });

  it.each<[string, ApiResult<unknown>]>([
    ['an unreachable API', { ok: false, error: { kind: 'network', status: 0, title: 'down' } }],
    ['a proxy 502', { ok: false, error: { kind: 'http', status: 502, title: 'Bad Gateway' } }],
    ['an unparseable body', { ok: false, error: { kind: 'parse', status: 200, title: 'Bad JSON' } }],
  ])('is null for %s', async (_label, result) => {
    await expect(fetchApiVersion(clientAnswering(result))).resolves.toBeNull();
  });

  it.each<[string, unknown]>([
    ['no body', null],
    ['a non-object body', 'abc1234'],
    ['a body without a sha', { buildTime: '2026-11-14T10:00:00Z' }],
    ['an empty sha', { sha: '' }],
    ['a non-string sha', { sha: 42 }],
  ])('is null for %s', async (_label, data) => {
    await expect(fetchApiVersion(clientAnswering(ok(data)))).resolves.toBeNull();
  });
});
