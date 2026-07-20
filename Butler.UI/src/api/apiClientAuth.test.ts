import { createApiClient } from './client';

const BASE = 'http://api.test:9000';

/** A minimal ok Response with an empty body. */
function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => '',
  } as unknown as Response;
}

/** Read the headers the client passed to fetch on its most recent call. */
function headersOf(fetchImpl: jest.Mock): Record<string, string> {
  const [, init] = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
  return init.headers as Record<string, string>;
}

describe('createApiClient bearer token (T4)', () => {
  it('attaches an Authorization bearer on reads when a token is available', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getAuthToken: () => 'tok-123' });

    await client.get('/me');

    expect(headersOf(fetchImpl).Authorization).toBe('Bearer tok-123');
    expect(headersOf(fetchImpl).Accept).toBe('application/json');
  });

  it('attaches an Authorization bearer on writes when a token is available', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getAuthToken: () => 'tok-123' });

    await client.update('/households/hh-1', { name: 'Home' });

    expect(headersOf(fetchImpl).Authorization).toBe('Bearer tok-123');
    // The write headers are preserved alongside the bearer.
    expect(headersOf(fetchImpl)['Content-Type']).toBe('application/json');
  });

  it('sends no Authorization header when the token getter yields null', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getAuthToken: () => null });

    await client.get('/households/hh-1/people');

    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
  });

  it('sends no Authorization header when no token getter is configured', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({ baseUrl: BASE, fetchImpl });

    await client.get('/health');

    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
  });
});
