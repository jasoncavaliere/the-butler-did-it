/**
 * Config-driven selection of the concrete {@link IAuthProvider}. In dev mode
 * (`DisableAuthentication`) the {@link createDevAuthProvider} dev organizer is
 * used; otherwise the {@link createEntraAuthProvider} Entra External ID provider
 * is built from the OIDC config. Because the choice is a single config branch
 * over one seam, swapping IdP later is a config + provider-class change, not a
 * UI rewrite - mirroring the generic server and `IStoreConnector`.
 */

import type { AuthConfig } from '../api/config';
import type { IAuthProvider } from './authProvider';
import { createDevAuthProvider } from './devAuthProvider';
import { createEntraAuthProvider, type EntraAuthDeps } from './entraAuthProvider';

/** Structural view of the Web Crypto API this module needs (no DOM lib dep). */
type WebCryptoLike = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer> };
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type LocationLike = { href: string; assign(url: string): void };

type BrowserGlobals = {
  crypto: WebCryptoLike;
  localStorage: StorageLike;
  location: LocationLike;
  fetch: typeof fetch;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as base64url (no padding), used for the PKCE verifier/challenge. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += BASE64[b0 >> 2];
    output += BASE64[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += i + 1 < bytes.length ? BASE64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '';
    output += i + 2 < bytes.length ? BASE64[b2 & 0x3f] : '';
  }
  return output.replace(/\+/g, '-').replace(/\//g, '_');
}

/** Convert an ASCII string (the base64url PKCE verifier) to bytes. */
export function stringToBytes(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Assemble the real browser side effects for the Entra provider from the
 * ambient globals. Reads only `globalThis`, so tests can stub the globals to
 * exercise it without a browser.
 */
export function defaultBrowserDeps(): EntraAuthDeps {
  const globals = globalThis as unknown as BrowserGlobals;
  return {
    fetchImpl: (input, init) => globals.fetch(input, init),
    storage: {
      get: (key) => globals.localStorage.getItem(key),
      set: (key, value) => globals.localStorage.setItem(key, value),
      remove: (key) => globals.localStorage.removeItem(key),
    },
    redirect: (url) => globals.location.assign(url),
    currentUrl: () => globals.location.href,
    randomString: () => bytesToBase64Url(globals.crypto.getRandomValues(new Uint8Array(32))),
    sha256Base64Url: async (verifier) => {
      const digest = await globals.crypto.subtle.digest('SHA-256', stringToBytes(verifier));
      return bytesToBase64Url(new Uint8Array(digest));
    },
  };
}

/**
 * Select and build the auth provider for the given config. `deps` overrides the
 * Entra side effects (used by tests); production supplies none and the real
 * {@link defaultBrowserDeps} are used.
 */
export function createAuthProvider(config: AuthConfig, deps?: EntraAuthDeps): IAuthProvider {
  if (config.disableAuthentication) {
    return createDevAuthProvider();
  }
  return createEntraAuthProvider(
    {
      authority: config.authority,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
    },
    deps ?? defaultBrowserDeps(),
  );
}
