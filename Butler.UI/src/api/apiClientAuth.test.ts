import { createApiClient, DEVICE_TOKEN_HEADER } from './client';

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

/** A Response with the given status and an optional JSON body. */
function statusResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: (name: string) => (name === 'content-type' && body ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
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

describe('createApiClient device token and expiry (#105)', () => {
  it('sends the device token on X-Device-Token and never as a Bearer', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getDeviceToken: () => 'device-xyz' });

    await client.get('/households/hh-1');

    expect(DEVICE_TOKEN_HEADER).toBe('X-Device-Token');
    expect(headersOf(fetchImpl)['X-Device-Token']).toBe('device-xyz');
    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
  });

  it('sends only the organizer Bearer when both tokens exist', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'tok-123',
      getDeviceToken: () => 'device-xyz',
    });

    await client.update('/households', { name: 'Home' }, { method: 'POST' });

    expect(headersOf(fetchImpl).Authorization).toBe('Bearer tok-123');
    expect(headersOf(fetchImpl)['X-Device-Token']).toBeUndefined();
  });

  it('a 401 on the organizer bearer calls onUnauthorized and retries once on X-Device-Token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(statusResponse(401))
      .mockResolvedValueOnce(statusResponse(200, { householdId: 'hh-1' }));
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'expired',
      getDeviceToken: () => 'device-xyz',
      onUnauthorized,
    });

    const result = await client.get<{ householdId: string }>('/households/hh-1');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchImpl)['X-Device-Token']).toBe('device-xyz');
    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
    expect(result).toEqual({ ok: true, status: 200, data: { householdId: 'hh-1' }, etag: null });
  });

  it('retries at most once: a second 401 is returned as the result', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'expired',
      getDeviceToken: () => 'device-xyz',
      onUnauthorized,
    });

    const result = await client.update('/households/hh-1/assignments/generate', { weekIso: '2026-W29' }, { method: 'POST' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('a 401 on the organizer bearer without a device token clears the organizer and returns the 401', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const onUnauthorized = jest.fn();
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getAuthToken: () => 'expired', onUnauthorized });

    const result = await client.get('/me');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('tolerates a missing onUnauthorized callback', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(statusResponse(401))
      .mockResolvedValueOnce(okResponse());
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'expired',
      getDeviceToken: () => 'device-xyz',
    });

    const result = await client.get('/households/hh-1');

    expect(result.ok).toBe(true);
  });

  it('never retries a 401 that carried only the device token, or a 403 on the organizer', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const onUnauthorized = jest.fn();
    const device = createApiClient({ baseUrl: BASE, fetchImpl, getDeviceToken: () => 'device-xyz', onUnauthorized });

    await device.get('/households/hh-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const forbidden = jest.fn(async () => statusResponse(403));
    const organizer = createApiClient({
      baseUrl: BASE,
      fetchImpl: forbidden,
      getAuthToken: () => 'tok-123',
      getDeviceToken: () => 'device-xyz',
      onUnauthorized,
    });

    await organizer.get('/households/hh-1');
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a network failure on the organizer bearer is returned without a retry', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'tok-123',
      getDeviceToken: () => 'device-xyz',
      onUnauthorized,
    });

    const result = await client.get('/me');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
