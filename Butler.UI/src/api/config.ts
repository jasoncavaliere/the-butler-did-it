/**
 * Typed API base configuration for Butler.UI.
 *
 * The base URL is read from the Expo public env var `EXPO_PUBLIC_API_BASE_URL`
 * (inlined at build time by Expo). It may be absolute (`https://api.example`)
 * or a same-origin relative base such as `/api` (the demo stack, where Caddy
 * serves the hub and proxies `/api/*` to the API on one origin). When it is
 * unset we fall back to the local Butler.API dev server. Later UI tickets
 * (e.g. F7 "UI API client") build the real client on top of this seam rather
 * than hard-coding hosts.
 */

/** Dev default when no `EXPO_PUBLIC_API_BASE_URL` is provided. */
export const DEFAULT_DEV_API_BASE_URL = 'http://localhost:5108';

/**
 * Resolve the API base URL from a raw env value, falling back to the dev
 * default when it is missing or blank. A provided value - absolute or a
 * relative base such as `/api` - is returned trimmed but otherwise unchanged.
 * Exposed (with an injectable arg) so it can be unit-tested without mutating
 * the module environment.
 */
export function resolveApiBaseUrl(
  rawEnv: string | undefined = process.env.EXPO_PUBLIC_API_BASE_URL,
): string {
  const configured = rawEnv?.trim();
  return configured ? configured : DEFAULT_DEV_API_BASE_URL;
}

/** The resolved API base URL for this build. */
export const apiBaseUrl: string = resolveApiBaseUrl();

/**
 * Which organizer sign-in the UI uses:
 * - `dev` -- the F6 dev organizer (no live tenant, no token; the API's bypass).
 * - `entra` -- Entra External ID over OIDC/PKCE.
 * - `pin` -- the local demo PIN pad (#105), against a Demo API.
 */
export type AuthProviderKind = 'dev' | 'entra' | 'pin';

/**
 * Organizer authentication configuration (Engineering Contract 7.4, client
 * side). The organizer is the only authenticated user; these values are public
 * OIDC identifiers, not secrets. `provider` selects the sign-in; the derived
 * `disableAuthentication` mirrors the API's dev bypass (`provider === 'dev'`).
 */
export type AuthConfig = {
  /** Which organizer sign-in to use (`EXPO_PUBLIC_AUTH_PROVIDER`). */
  provider: AuthProviderKind;
  /** When true, use the dev organizer (no live tenant, no token). Same as `provider === 'dev'`. */
  disableAuthentication: boolean;
  /** OIDC authority (issuer) that mints organizer tokens. */
  authority: string;
  /** The app (client) id tokens are issued for. */
  clientId: string;
  /** Redirect URI registered with the IdP. */
  redirectUri: string;
  /** Scopes requested at authorize time. */
  scopes: string[];
};

/** Parse the boolean-ish `EXPO_PUBLIC_DISABLE_AUTH` flag (unset defaults to dev). */
function parseDisableAuth(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    // Unset defaults to dev mode so local and CI runs need no live tenant.
    return true;
  }
  return value === 'true' || value === '1';
}

/**
 * Resolve the provider from `EXPO_PUBLIC_AUTH_PROVIDER` (`dev`, `entra`, or
 * `pin`, case-insensitive). When it is unset or unrecognized, fall back to the
 * older `EXPO_PUBLIC_DISABLE_AUTH` flag: dev when it is on (or unset), else Entra.
 */
function parseAuthProvider(raw: string | undefined, disableRaw: string | undefined): AuthProviderKind {
  const value = raw?.trim().toLowerCase();
  if (value === 'dev' || value === 'entra' || value === 'pin') {
    return value;
  }
  return parseDisableAuth(disableRaw) ? 'dev' : 'entra';
}

/**
 * The auth env vars as Expo sees them at bundle time. Expo inlines only direct
 * `process.env.EXPO_PUBLIC_*` reads, so each one is named here; reading them
 * off a `process.env` object passed around would find nothing in a web export.
 */
export function buildTimeAuthEnv(): Record<string, string | undefined> {
  return {
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_DISABLE_AUTH: process.env.EXPO_PUBLIC_DISABLE_AUTH,
    EXPO_PUBLIC_AUTH_AUTHORITY: process.env.EXPO_PUBLIC_AUTH_AUTHORITY,
    EXPO_PUBLIC_AUTH_CLIENT_ID: process.env.EXPO_PUBLIC_AUTH_CLIENT_ID,
    EXPO_PUBLIC_AUTH_REDIRECT_URI: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI,
    EXPO_PUBLIC_AUTH_SCOPES: process.env.EXPO_PUBLIC_AUTH_SCOPES,
  };
}

/**
 * Resolve {@link AuthConfig} from the Expo public env vars (injectable for
 * tests). Scopes default to the OIDC basics; the IdP-specific values stay empty
 * placeholders supplied per environment.
 */
export function resolveAuthConfig(
  env: Record<string, string | undefined> = buildTimeAuthEnv(),
): AuthConfig {
  const scopes = (env.EXPO_PUBLIC_AUTH_SCOPES ?? 'openid profile')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const provider = parseAuthProvider(env.EXPO_PUBLIC_AUTH_PROVIDER, env.EXPO_PUBLIC_DISABLE_AUTH);
  return {
    provider,
    disableAuthentication: provider === 'dev',
    authority: (env.EXPO_PUBLIC_AUTH_AUTHORITY ?? '').trim(),
    clientId: (env.EXPO_PUBLIC_AUTH_CLIENT_ID ?? '').trim(),
    redirectUri: (env.EXPO_PUBLIC_AUTH_REDIRECT_URI ?? '').trim(),
    scopes,
  };
}

/** The resolved organizer auth configuration for this build. */
export const authConfig: AuthConfig = resolveAuthConfig();

/**
 * Join the API base URL with a path, tolerating a leading slash on the path and
 * a trailing slash on the base. Defaults to the resolved {@link apiBaseUrl}.
 * With a relative base the result is a same-origin relative URL, e.g.
 * `apiUrl('/households', '/api')` is `/api/households`.
 */
export function apiUrl(path: string, baseUrl: string = apiBaseUrl): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
