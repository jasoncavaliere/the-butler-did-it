/**
 * The dataset-id read (#100 D7).
 *
 * The API serves an opaque id for the data it currently holds, and replaces it
 * whenever that data is replaced (a demo reseed, or wiped storage). The hub's
 * dataset guard ({@link ../offline/datasetGuard}) compares it with the id it
 * last saw to decide whether its cache and write queue still belong to the data
 * behind the API.
 */

import type { ApiClient } from './client';
import type { DatasetResponse } from './models';

/**
 * The route, relative to the API base URL. The System controller's routes carry
 * their own `api/` prefix, so through the single-origin proxy (whose base URL is
 * `/api`) this is requested as `/api/api/system/dataset`.
 */
export const DATASET_PATH = '/api/system/dataset';

/**
 * Read the current dataset id, or `null` when it could not be established.
 *
 * Every failure is `null` - an unreachable API, any error status (the proxy
 * answers 502 while the API is down, which is `http`, not `network`), an
 * unparseable body, and a body without a usable id. The caller treats `null` as
 * "unverified" and changes nothing, so an outage can never look like a reset.
 */
export async function fetchDatasetId(client: ApiClient): Promise<string | null> {
  const result = await client.get<DatasetResponse>(DATASET_PATH);
  if (!result.ok) {
    return null;
  }
  const data: unknown = result.data;
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const datasetId = (data as { datasetId?: unknown }).datasetId;
  return typeof datasetId === 'string' && datasetId.length > 0 ? datasetId : null;
}
