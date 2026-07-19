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
 * Join the API base URL with a path, tolerating a leading slash on the path and
 * a trailing slash on the base. Defaults to the resolved {@link apiBaseUrl}.
 */
export function apiUrl(path: string, baseUrl: string = apiBaseUrl): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
