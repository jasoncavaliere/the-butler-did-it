import type { AuthConfig } from '../api/config';
import {
  bytesToBase64Url,
  createAuthProvider,
  defaultBrowserDeps,
  stringToBytes,
} from './createAuthProvider';
import type { EntraAuthDeps } from './entraAuthProvider';

const DEV_CONFIG: AuthConfig = {
  disableAuthentication: true,
  authority: '',
  clientId: '',
  redirectUri: '',
  scopes: ['openid', 'profile'],
};

const LIVE_CONFIG: AuthConfig = {
  disableAuthentication: false,
  authority: 'https://tenant.ciamlogin.com/tid/v2.0',
  clientId: 'client-123',
  redirectUri: 'https://hub.butler.test/callback',
  scopes: ['openid', 'profile'],
};

function fakeDeps(): EntraAuthDeps {
  return {
    fetchImpl: jest.fn() as unknown as typeof fetch,
    storage: { get: () => null, set: () => undefined, remove: () => undefined },
    redirect: () => undefined,
    currentUrl: () => 'https://hub.butler.test/',
    randomString: () => 'r',
    sha256Base64Url: async () => 'c',
  };
}

describe('createAuthProvider', () => {
  it('selects the dev provider when authentication is disabled', () => {
    expect(createAuthProvider(DEV_CONFIG).kind).toBe('dev');
  });

  it('selects the Entra provider with injected deps when auth is enabled', () => {
    expect(createAuthProvider(LIVE_CONFIG, fakeDeps()).kind).toBe('entra');
  });

  it('falls back to the default browser deps when none are injected', () => {
    const restore = stubBrowserGlobals();
    try {
      expect(createAuthProvider(LIVE_CONFIG).kind).toBe('entra');
    } finally {
      restore();
    }
  });
});

describe('bytesToBase64Url', () => {
  it('encodes lengths that are exact multiples of three', () => {
    expect(bytesToBase64Url(Uint8Array.from([0x4d, 0x61, 0x6e]))).toBe('TWFu'); // "Man"
  });

  it('encodes a trailing single byte (two base64 chars, no padding)', () => {
    expect(bytesToBase64Url(Uint8Array.from([0x4d]))).toBe('TQ');
  });

  it('encodes a trailing pair of bytes (three base64 chars, no padding)', () => {
    expect(bytesToBase64Url(Uint8Array.from([0x4d, 0x61]))).toBe('TWE');
  });

  it('uses the URL-safe alphabet (- and _ instead of + and /)', () => {
    // 0xfb 0xff 0xbf -> standard "+/+" territory; ensure it is URL-safe.
    const encoded = bytesToBase64Url(Uint8Array.from([0xfb, 0xff, 0xbf]));
    expect(encoded).not.toMatch(/[+/]/);
  });
});

describe('stringToBytes', () => {
  it('maps an ASCII string to its char codes', () => {
    expect(Array.from(stringToBytes('AB'))).toEqual([65, 66]);
  });
});

describe('defaultBrowserDeps', () => {
  it('wires every side effect to the ambient browser globals', async () => {
    const restore = stubBrowserGlobals();
    try {
      const deps = defaultBrowserDeps();

      deps.storage.set('k', 'v');
      expect(deps.storage.get('k')).toBe('v');
      deps.storage.remove('k');
      expect(deps.storage.get('k')).toBeNull();

      deps.redirect('https://example.test/go');
      const globals = globalThis as unknown as {
        location: { href: string };
        fetch: jest.Mock;
      };
      expect(globals.location.href).toBe('https://example.test/go');
      expect(deps.currentUrl()).toBe('https://example.test/go');

      await deps.fetchImpl('https://example.test/data');
      expect(globals.fetch).toHaveBeenCalledWith('https://example.test/data', undefined);

      // Random string comes from getRandomValues -> base64url (URL-safe, non-empty).
      const random = deps.randomString();
      expect(random.length).toBeGreaterThan(0);
      expect(random).not.toMatch(/[+/=]/);

      const challenge = await deps.sha256Base64Url('verifier');
      expect(challenge.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

/**
 * Stub the browser globals `defaultBrowserDeps` reads, returning a restore fn.
 * The fakes are deterministic so the deps are fully exercised without a browser.
 */
function stubBrowserGlobals(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    crypto: g.crypto,
    localStorage: g.localStorage,
    location: g.location,
    fetch: g.fetch,
  };

  const store = new Map<string, string>();
  let hrefValue = 'https://hub.butler.test/';

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      get href() {
        return hrefValue;
      },
      assign: (url: string) => {
        hrefValue = url;
      },
    },
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (array: Uint8Array) => {
        for (let i = 0; i < array.length; i += 1) {
          array[i] = (i * 7 + 1) & 0xff;
        }
        return array;
      },
      subtle: {
        digest: async (_algorithm: string, data: Uint8Array) =>
          Uint8Array.from(data.subarray(0, 4)).buffer,
      },
    },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  });

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete (globalThis as unknown as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    }
  };
}
