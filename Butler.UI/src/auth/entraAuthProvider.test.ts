import {
  base64UrlToString,
  createEntraAuthProvider,
  type EntraAuthConfig,
  type EntraAuthDeps,
  type PkceStorage,
} from './entraAuthProvider';

const CONFIG: EntraAuthConfig = {
  authority: 'https://tenant.ciamlogin.com/tid/v2.0',
  clientId: 'client-123',
  redirectUri: 'https://hub.butler.test/callback',
  scopes: ['openid', 'profile'],
};

/** A map-backed PKCE storage for tests. */
function memoryStorage(seed: Record<string, string> = {}): PkceStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

/** Base64url-encode a JSON object the way a JWT segment is encoded. */
function encodeSegment(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Build a fake JWT with the given payload claims. */
function makeJwt(claims: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'none' })}.${encodeSegment(claims)}.sig`;
}

type DepsOverrides = Partial<EntraAuthDeps> & { url?: string };

function makeDeps(overrides: DepsOverrides = {}): {
  deps: EntraAuthDeps;
  redirected: string[];
  storage: PkceStorage;
} {
  const redirected: string[] = [];
  const storage = overrides.storage ?? memoryStorage();
  let counter = 0;
  const deps: EntraAuthDeps = {
    fetchImpl: overrides.fetchImpl ?? (jest.fn() as unknown as typeof fetch),
    storage,
    redirect: overrides.redirect ?? ((url) => redirected.push(url)),
    currentUrl: overrides.currentUrl ?? (() => overrides.url ?? 'https://hub.butler.test/'),
    randomString: overrides.randomString ?? (() => `rand-${(counter += 1)}`),
    sha256Base64Url: overrides.sha256Base64Url ?? (async () => 'challenge-xyz'),
  };
  return { deps, redirected, storage };
}

function tokenResponse(body: unknown, ok = true, status = 200): typeof fetch {
  return jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('createEntraAuthProvider', () => {
  it('identifies as the entra provider', () => {
    const { deps } = makeDeps();
    expect(createEntraAuthProvider(CONFIG, deps).kind).toBe('entra');
  });

  describe('begin (no callback params)', () => {
    it('stores PKCE state and redirects to the authorize endpoint, returning null', async () => {
      const { deps, redirected, storage } = makeDeps();
      const result = await createEntraAuthProvider(CONFIG, deps).signIn();

      expect(result).toBeNull();
      expect(redirected).toHaveLength(1);
      const url = new URL(redirected[0]);
      // /v2.0 is stripped from the authority to form the OIDC endpoint base.
      expect(url.origin + url.pathname).toBe(
        'https://tenant.ciamlogin.com/tid/oauth2/v2.0/authorize',
      );
      expect(url.searchParams.get('client_id')).toBe('client-123');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('redirect_uri')).toBe('https://hub.butler.test/callback');
      expect(url.searchParams.get('scope')).toBe('openid profile');
      expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBe('rand-2');
      expect(storage.get('butler.auth.pkce.verifier')).toBe('rand-1');
      expect(storage.get('butler.auth.pkce.state')).toBe('rand-2');
    });

    it('keeps an authority without a /v2.0 suffix intact', async () => {
      const { deps, redirected } = makeDeps();
      await createEntraAuthProvider(
        { ...CONFIG, authority: 'https://issuer.test/tenant' },
        deps,
      ).signIn();
      expect(redirected[0]).toContain('https://issuer.test/tenant/oauth2/v2.0/authorize');
    });
  });

  describe('complete (callback params present)', () => {
    const seeded = () =>
      memoryStorage({
        'butler.auth.pkce.verifier': 'verifier-1',
        'butler.auth.pkce.state': 'state-1',
      });
    const callbackUrl = 'https://hub.butler.test/callback?code=auth-code&state=state-1';

    it('exchanges the code, returns the session, and clears PKCE storage', async () => {
      const fetchImpl = tokenResponse({
        access_token: 'access-tok',
        id_token: makeJwt({ oid: 'oid-42', name: 'Robin Organizer' }),
      });
      const { deps, storage } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      const session = await createEntraAuthProvider(CONFIG, deps).signIn();

      expect(session).toEqual({
        organizer: { subject: 'oid-42', name: 'Robin Organizer' },
        token: 'access-tok',
      });
      const [tokenUrl, init] = (fetchImpl as jest.Mock).mock.calls[0];
      expect(tokenUrl).toBe('https://tenant.ciamlogin.com/tid/oauth2/v2.0/token');
      const body = new URLSearchParams(init.body as string);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('verifier-1');
      expect(storage.get('butler.auth.pkce.verifier')).toBeNull();
      expect(storage.get('butler.auth.pkce.state')).toBeNull();
    });

    it('falls back to the id_token as the bearer when no access_token is returned', async () => {
      const idToken = makeJwt({ sub: 'sub-9', preferred_username: 'robin@butler.test' });
      const fetchImpl = tokenResponse({ id_token: idToken });
      const { deps } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      const session = await createEntraAuthProvider(CONFIG, deps).signIn();

      expect(session?.token).toBe(idToken);
      // subject falls back to `sub`, name falls back to `preferred_username`.
      expect(session?.organizer).toEqual({ subject: 'sub-9', name: 'robin@butler.test' });
    });

    it('uses safe fallbacks when the id_token carries no identity claims', async () => {
      const fetchImpl = tokenResponse({ id_token: makeJwt({}) });
      const { deps } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      const session = await createEntraAuthProvider(CONFIG, deps).signIn();
      expect(session?.organizer).toEqual({ subject: '', name: 'Organizer' });
    });

    it('tolerates a malformed id_token by using identity fallbacks', async () => {
      const fetchImpl = tokenResponse({ id_token: 'not-a-jwt' });
      const { deps } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      const session = await createEntraAuthProvider(CONFIG, deps).signIn();
      expect(session?.organizer).toEqual({ subject: '', name: 'Organizer' });
    });

    it('handles a token response with no id_token at all', async () => {
      const fetchImpl = tokenResponse({ access_token: 'access-tok' });
      const { deps } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      const session = await createEntraAuthProvider(CONFIG, deps).signIn();
      expect(session).toEqual({ organizer: { subject: '', name: 'Organizer' }, token: 'access-tok' });
    });

    it('throws when the returned state does not match the stored state', async () => {
      const { deps } = makeDeps({
        storage: seeded(),
        url: 'https://hub.butler.test/callback?code=auth-code&state=wrong',
      });
      await expect(createEntraAuthProvider(CONFIG, deps).signIn()).rejects.toThrow(
        /PKCE state mismatch/,
      );
    });

    it('throws when no PKCE state was stored (nothing to verify against)', async () => {
      const { deps } = makeDeps({ storage: memoryStorage(), url: callbackUrl });
      await expect(createEntraAuthProvider(CONFIG, deps).signIn()).rejects.toThrow(
        /PKCE state mismatch/,
      );
    });

    it('throws when the verifier is missing even if the state matches', async () => {
      const storage = memoryStorage({ 'butler.auth.pkce.state': 'state-1' });
      const { deps } = makeDeps({ storage, url: callbackUrl });
      await expect(createEntraAuthProvider(CONFIG, deps).signIn()).rejects.toThrow(
        /PKCE state mismatch/,
      );
    });

    it('throws and still clears storage when the token exchange fails', async () => {
      const fetchImpl = tokenResponse({ error: 'invalid_grant' }, false, 400);
      const { deps, storage } = makeDeps({ storage: seeded(), url: callbackUrl, fetchImpl });

      await expect(createEntraAuthProvider(CONFIG, deps).signIn()).rejects.toThrow(
        /token exchange failed \(400\)/,
      );
      expect(storage.get('butler.auth.pkce.verifier')).toBeNull();
      expect(storage.get('butler.auth.pkce.state')).toBeNull();
    });
  });

  it('sign-out clears any PKCE storage and resolves', async () => {
    const storage = memoryStorage({
      'butler.auth.pkce.verifier': 'v',
      'butler.auth.pkce.state': 's',
    });
    const { deps } = makeDeps({ storage });
    await expect(createEntraAuthProvider(CONFIG, deps).signOut()).resolves.toBeUndefined();
    expect(storage.get('butler.auth.pkce.verifier')).toBeNull();
  });
});

describe('base64UrlToString', () => {
  it('decodes a base64url string to its byte string', () => {
    expect(base64UrlToString(encodeAscii('Butler'))).toBe('Butler');
  });

  it('stops at padding characters', () => {
    // "Hi" base64-encodes to "SGk=" (with padding); base64url drops it, but a
    // stray '=' must still terminate decoding cleanly.
    expect(base64UrlToString('SGk=')).toBe('Hi');
  });

  it('skips characters outside the base64 alphabet', () => {
    expect(base64UrlToString('SG\nk')).toBe('Hi');
  });

  function encodeAscii(input: string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
});
