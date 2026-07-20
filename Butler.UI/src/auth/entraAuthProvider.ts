/**
 * Entra External ID auth provider: the first and only v1 implementation of the
 * {@link IAuthProvider} seam. It is a standard OIDC Authorization Code flow with
 * PKCE, expressed against generic OIDC endpoints (nothing Entra-specific beyond
 * the v2 endpoint paths), so the same shape works for any OIDC issuer.
 *
 * Every side effect - fetch, storage, browser redirect, current URL, randomness,
 * SHA-256 - is injected via {@link EntraAuthDeps}. That keeps the flow fully
 * unit-testable (a fake provider is injected through the seam, never Entra
 * internals) and keeps the module free of hard browser-global coupling.
 */

import type { IAuthProvider, OrganizerIdentity, OrganizerSession } from './authProvider';

/** Public (non-secret) Entra External ID / OIDC client configuration. */
export type EntraAuthConfig = {
  /** OIDC authority, e.g. `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0`. */
  authority: string;
  /** The app (client) id tokens are issued for. */
  clientId: string;
  /** Redirect URI registered with the IdP (the SWA callback URL). */
  redirectUri: string;
  /** Scopes requested at authorize time. */
  scopes: string[];
};

/** Minimal key/value store for the PKCE verifier + state across the redirect. */
export type PkceStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

/** Injected side effects the Entra flow needs. */
export type EntraAuthDeps = {
  fetchImpl: typeof fetch;
  storage: PkceStorage;
  /** Navigate the browser to the authorize URL (begins the redirect). */
  redirect: (url: string) => void;
  /** The current location href, used to read the OIDC callback params. */
  currentUrl: () => string;
  /** A cryptographically-random URL-safe string (PKCE verifier + state). */
  randomString: () => string;
  /** SHA-256 of the verifier, base64url-encoded (the PKCE code challenge). */
  sha256Base64Url: (verifier: string) => Promise<string>;
};

const VERIFIER_KEY = 'butler.auth.pkce.verifier';
const STATE_KEY = 'butler.auth.pkce.state';

/** The subset of the OIDC token response this provider consumes. */
type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

/** Strip a trailing slash and a trailing `/v2.0` to get the OIDC endpoint base. */
function endpointBase(authority: string): string {
  const trimmed = authority.replace(/\/+$/, '');
  return trimmed.replace(/\/v2\.0$/, '');
}

/** Build the OIDC authorize URL for the code+PKCE flow. */
function buildAuthorizeUrl(config: EntraAuthConfig, challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${endpointBase(config.authority)}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Decode a base64url segment to a byte string (ASCII-safe for JWT payloads). */
export function base64UrlToString(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const char of normalized) {
    if (char === '=') {
      break;
    }
    const index = alphabet.indexOf(char);
    if (index === -1) {
      continue;
    }
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((value >>> bits) & 0xff);
    }
  }
  return output;
}

/** Extract the organizer identity from a JWT id_token's claims. */
function identityFromIdToken(idToken: string): OrganizerIdentity {
  const segments = idToken.split('.');
  const payload = segments.length >= 2 ? segments[1] : '';
  let claims: Record<string, unknown> = {};
  try {
    claims = JSON.parse(base64UrlToString(payload)) as Record<string, unknown>;
  } catch {
    claims = {};
  }
  const subject =
    typeof claims.oid === 'string'
      ? claims.oid
      : typeof claims.sub === 'string'
        ? claims.sub
        : '';
  const name =
    typeof claims.name === 'string'
      ? claims.name
      : typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : 'Organizer';
  return { subject, name };
}

/** Build an Entra External ID auth provider from config + injected side effects. */
export function createEntraAuthProvider(
  config: EntraAuthConfig,
  deps: EntraAuthDeps,
): IAuthProvider {
  async function beginSignIn(): Promise<null> {
    const verifier = deps.randomString();
    const state = deps.randomString();
    const challenge = await deps.sha256Base64Url(verifier);
    deps.storage.set(VERIFIER_KEY, verifier);
    deps.storage.set(STATE_KEY, state);
    deps.redirect(buildAuthorizeUrl(config, challenge, state));
    return null;
  }

  async function completeSignIn(code: string, returnedState: string): Promise<OrganizerSession> {
    const expectedState = deps.storage.get(STATE_KEY);
    const verifier = deps.storage.get(VERIFIER_KEY);
    if (!expectedState || expectedState !== returnedState || !verifier) {
      throw new Error('Organizer sign-in could not be verified (PKCE state mismatch).');
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
      scope: config.scopes.join(' '),
    });

    const response = await deps.fetchImpl(`${endpointBase(config.authority)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });

    deps.storage.remove(VERIFIER_KEY);
    deps.storage.remove(STATE_KEY);

    if (!response.ok) {
      throw new Error(`Organizer token exchange failed (${response.status}).`);
    }

    const tokens = (await response.json()) as TokenResponse;
    const idToken = tokens.id_token ?? '';
    return {
      organizer: identityFromIdToken(idToken),
      token: tokens.access_token ?? idToken,
    };
  }

  return {
    kind: 'entra',
    signIn() {
      const url = new URL(deps.currentUrl());
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (code && returnedState) {
        return completeSignIn(code, returnedState);
      }
      return beginSignIn();
    },
    signOut() {
      deps.storage.remove(VERIFIER_KEY);
      deps.storage.remove(STATE_KEY);
      return Promise.resolve();
    },
  };
}
