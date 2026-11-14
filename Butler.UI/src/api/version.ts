/**
 * The API build-version read (#126).
 *
 * The API reports the git short SHA it was built from and its UTC build time.
 * {@link ../components/VersionInfo} shows them next to the hub's own build SHA,
 * so a hub and an API built from different commits are easy to spot.
 */

import type { ApiClient } from './client';
import type { VersionResponse } from './models';

/**
 * The route, relative to the API base URL. The System controller's routes carry
 * their own `api/` prefix, so through the single-origin proxy (whose base URL is
 * `/api`) this is requested as `/api/api/system/version`.
 */
export const VERSION_PATH = '/api/system/version';

/**
 * Read the API's build version, or `null` when it could not be established.
 *
 * Every failure is `null` - an unreachable API, any error status, an
 * unparseable body, and a body without a usable SHA. A build time that is not
 * a string is reported as `null` (unknown) rather than failing the read.
 */
export async function fetchApiVersion(client: ApiClient): Promise<VersionResponse | null> {
  const result = await client.get<VersionResponse>(VERSION_PATH);
  if (!result.ok) {
    return null;
  }
  const data: unknown = result.data;
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { sha, buildTime } = data as { sha?: unknown; buildTime?: unknown };
  if (typeof sha !== 'string' || sha.length === 0) {
    return null;
  }
  return { sha, buildTime: typeof buildTime === 'string' ? buildTime : null };
}
