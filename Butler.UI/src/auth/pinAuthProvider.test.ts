import { createPinAuthProvider, PinSignInError } from './pinAuthProvider';

const BASE = 'http://api.test:9000';

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const SIGNED_IN = { token: 'tok-1', subject: 'dev-organizer', name: 'Demo Organizer', idleTimeoutSeconds: 900 };

async function rejection(promise: Promise<unknown>): Promise<PinSignInError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PinSignInError);
    return error as PinSignInError;
  }
  throw new Error('expected a rejection');
}

describe('createPinAuthProvider (#105)', () => {
  it('posts the PIN and returns the organizer session with the token', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, SIGNED_IN));
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    const session = await provider.signIn({ pin: '2468' });

    expect(provider.kind).toBe('pin');
    expect(session).toEqual({ organizer: { subject: 'dev-organizer', name: 'Demo Organizer' }, token: 'tok-1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/auth/pin/sign-in`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ pin: '2468' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects an empty or missing PIN as invalid without calling the API', async () => {
    const fetchImpl = jest.fn();
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    expect((await rejection(provider.signIn())).reason).toBe('invalid');
    expect((await rejection(provider.signIn({ pin: '' }))).reason).toBe('invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a 401 as invalid', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(401, { title: 'The PIN is not correct.', status: 401 }, 'application/problem+json'),
    );
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    const error = await rejection(provider.signIn({ pin: '1111' }));

    expect(error.reason).toBe('invalid');
    expect(error.name).toBe('PinSignInError');
  });

  it('rejects a 429 as locked with the retry seconds from the problem', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(429, { title: 'Too many PIN attempts.', status: 429, retryAfterSeconds: 42 }, 'application/problem+json'),
    );
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    const error = await rejection(provider.signIn({ pin: '2468' }));

    expect(error.reason).toBe('locked');
    expect(error.retryAfterSeconds).toBe(42);
  });

  it('rejects a 429 without retry seconds as locked with none', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(429, undefined, ''));
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    const error = await rejection(provider.signIn({ pin: '2468' }));

    expect(error.reason).toBe('locked');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('rejects any other failure as unavailable with a readable message', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    const error = await rejection(provider.signIn({ pin: '2468' }));

    expect(error.reason).toBe('unavailable');
    expect(error.message).toMatch(/unreachable/);
  });

  it('signs out by revoking the remembered token with a Bearer, then forgets it', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SIGNED_IN))
      .mockResolvedValue(jsonResponse(204, undefined, ''));
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });
    await provider.signIn({ pin: '2468' });

    await provider.signOut();
    await provider.signOut();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${BASE}/auth/pin/sign-out`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('signs out without calling the API when never signed in, and ignores a failed revoke', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, SIGNED_IN))
      .mockRejectedValueOnce(new Error('offline'));
    const provider = createPinAuthProvider({ apiBaseUrl: BASE, fetchImpl });

    await provider.signOut();
    expect(fetchImpl).not.toHaveBeenCalled();

    await provider.signIn({ pin: '2468' });
    await expect(provider.signOut()).resolves.toBeUndefined();
  });
});
