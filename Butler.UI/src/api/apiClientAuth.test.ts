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

describe('device token rejection (#188)', () => {
  it('calls onDeviceRejected on a 401 to a request sent on the device token, and marks the error', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const onDeviceRejected = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getDeviceToken: () => 'device-xyz',
      onDeviceRejected,
    });

    const result = await client.get('/households/hh-1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onDeviceRejected).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', status: 401, title: 'HTTP 401', viaDeviceToken: true },
    });
  });

  it('does not call onDeviceRejected on a device 403, but still marks the error', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(403));
    const onDeviceRejected = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getDeviceToken: () => 'device-xyz',
      onDeviceRejected,
    });

    const result = await client.get('/me');

    expect(onDeviceRejected).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.viaDeviceToken).toBe(true);
  });

  it('calls both callbacks when an organizer 401 is retried on the device and that gets a 401 too', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const onUnauthorized = jest.fn();
    const onDeviceRejected = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'expired',
      getDeviceToken: () => 'device-xyz',
      onUnauthorized,
      onDeviceRejected,
    });

    const result = await client.get('/households/hh-1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchImpl)[DEVICE_TOKEN_HEADER]).toBe('device-xyz');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onDeviceRejected).toHaveBeenCalledTimes(1);
    expect(!result.ok && result.error.viaDeviceToken).toBe(true);
  });

  it('calls neither rejection callback when the device retry gets a 403', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(statusResponse(401))
      .mockResolvedValueOnce(statusResponse(403));
    const onDeviceRejected = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getAuthToken: () => 'expired',
      getDeviceToken: () => 'device-xyz',
      onDeviceRejected,
    });

    const result = await client.get('/me');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onDeviceRejected).not.toHaveBeenCalled();
    expect(!result.ok && result.error).toEqual({
      kind: 'http',
      status: 403,
      title: 'HTTP 403',
      viaDeviceToken: true,
    });
  });

  it('tolerates a missing onDeviceRejected callback', async () => {
    const fetchImpl = jest.fn(async () => statusResponse(401));
    const client = createApiClient({ baseUrl: BASE, fetchImpl, getDeviceToken: () => 'device-xyz' });

    const result = await client.get('/households/hh-1');

    expect(result.ok).toBe(false);
  });

  it('marks a network failure on the device token but does not treat it as a rejection', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    const onDeviceRejected = jest.fn();
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl,
      getDeviceToken: () => 'device-xyz',
      onDeviceRejected,
    });

    const result = await client.get('/households/hh-1');

    expect(onDeviceRejected).not.toHaveBeenCalled();
    expect(!result.ok && result.error.kind).toBe('network');
    expect(!result.ok && result.error.viaDeviceToken).toBe(true);
  });

  it('leaves a device success, an organizer failure and an anonymous failure unmarked', async () => {
    const onDeviceRejected = jest.fn();

    const ok = createApiClient({
      baseUrl: BASE,
      fetchImpl: jest.fn(async () => okResponse()),
      getDeviceToken: () => 'device-xyz',
      onDeviceRejected,
    });
    expect((await ok.get('/households/hh-1')).ok).toBe(true);

    const organizer = createApiClient({
      baseUrl: BASE,
      fetchImpl: jest.fn(async () => statusResponse(401)),
      getAuthToken: () => 'expired',
      onDeviceRejected,
    });
    const organizerResult = await organizer.get('/me');
    expect(!organizerResult.ok && 'viaDeviceToken' in organizerResult.error).toBe(false);

    const anonymous = createApiClient({
      baseUrl: BASE,
      fetchImpl: jest.fn(async () => statusResponse(401)),
      onDeviceRejected,
    });
    const anonymousResult = await anonymous.get('/me');
    expect(!anonymousResult.ok && 'viaDeviceToken' in anonymousResult.error).toBe(false);

    expect(onDeviceRejected).not.toHaveBeenCalled();
  });
});
