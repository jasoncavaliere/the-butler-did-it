/**
 * The API reachability read (#131).
 *
 * `GET /api/system/ping` is the API's anonymous liveness route. The hub's hidden
 * organizer menu ({@link ../components/HiddenOrganizerMenu}) calls it to say
 * whether the hub can reach the API it is configured for right now.
 */

import type { ApiClient } from './client';
import type { PingResponse } from './models';

/**
 * The route, relative to the API base URL. The System controller's routes carry
 * their own `api/` prefix, so through the single-origin proxy (whose base URL is
 * `/api`) this is requested as `/api/api/system/ping`.
 */
export const PING_PATH = '/api/system/ping';

/**
 * Whether `GET /api/system/ping` succeeds. Never throws.
 *
 * Any success status is `true`; every failure is `false` - an unreachable API,
 * any error status (the proxy answers 502 while the API is down), and an
 * unparseable body. The body itself is not inspected: the route answering is
 * the whole signal.
 */
export async function pingApi(client: ApiClient): Promise<boolean> {
  const result = await client.get<PingResponse>(PING_PATH);
  return result.ok;
}
