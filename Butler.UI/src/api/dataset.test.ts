import type { ApiClient, ApiResult } from './client';
import { DATASET_PATH, fetchDatasetId } from './dataset';

/** A client whose only read answers `result`, recording the path it was asked for. */
function clientAnswering(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });

describe('fetchDatasetId', () => {
  it('reads the id from the System dataset route', async () => {
    const client = clientAnswering(ok({ datasetId: 'abc123' }));

    await expect(fetchDatasetId(client)).resolves.toBe('abc123');
    expect(client.get).toHaveBeenCalledWith(DATASET_PATH);
    expect(DATASET_PATH).toBe('/api/system/dataset');
  });

  it.each<[string, ApiResult<unknown>]>([
    ['an unreachable API', { ok: false, error: { kind: 'network', status: 0, title: 'down' } }],
    ['a proxy 502', { ok: false, error: { kind: 'http', status: 502, title: 'Bad Gateway' } }],
    ['a problem answer', { ok: false, error: { kind: 'problem', status: 500, title: 'Boom' } }],
    ['an unparseable body', { ok: false, error: { kind: 'parse', status: 200, title: 'Bad JSON' } }],
  ])('is null for %s', async (_label, result) => {
    await expect(fetchDatasetId(clientAnswering(result))).resolves.toBeNull();
  });

  it.each<[string, unknown]>([
    ['no body', null],
    ['a non-object body', 'abc123'],
    ['a body without an id', {}],
    ['an empty id', { datasetId: '' }],
    ['a non-string id', { datasetId: 42 }],
  ])('is null for %s', async (_label, data) => {
    await expect(fetchDatasetId(clientAnswering(ok(data)))).resolves.toBeNull();
  });
});
