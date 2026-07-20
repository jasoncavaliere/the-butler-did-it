/**
 * Typed API base configuration for Butler.UI.
 *
 * The base URL is read from the Expo public env var `EXPO_PUBLIC_API_BASE_URL`
 * (inlined at build time by Expo). When it is unset we fall back to the local
 * Butler.API dev server. Later UI tickets (e.g. F7 "UI API client") build the
 * real client on top of this seam rather than hard-coding hosts.
 */

/** Dev default when no `EXPO_PUBLIC_API_BASE_URL` is provided. */
export const DEFAULT_DEV_API_BASE_URL = 'http://localhost:5108';

/**
 * Resolve the API base URL from a raw env value, falling back to the dev
 * default when it is missing or blank. Exposed (with an injectable arg) so it
 * can be unit-tested without mutating the module environment.
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
 * Organizer authentication configuration (Engineering Contract 7.4, client
 * side). The organizer is the only authenticated user; these values are public
 * OIDC identifiers, not secrets. `disableAuthentication` mirrors the API's dev
 * bypass: when set, the UI uses the F6 dev organizer instead of a live sign-in.
 */
export type AuthConfig = {
  /** When true, use the dev organizer (no live tenant, no token). */
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
 * Resolve {@link AuthConfig} from the Expo public env vars (injectable for
 * tests). Scopes default to the OIDC basics; the IdP-specific values stay empty
 * placeholders supplied per environment.
 */
export function resolveAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const scopes = (env.EXPO_PUBLIC_AUTH_SCOPES ?? 'openid profile')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    disableAuthentication: parseDisableAuth(env.EXPO_PUBLIC_DISABLE_AUTH),
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
 */
export function apiUrl(path: string, baseUrl: string = apiBaseUrl): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
