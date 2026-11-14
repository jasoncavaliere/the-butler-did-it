/**
 * The dataset guard (#100 D7): the hub's answer to "is my offline state still
 * about the data behind the API?".
 *
 * The glance cache (O2) and the write queue (O3) both outlive the data they were
 * built from. When that data is replaced - a demo reseed, or storage wiped - the
 * cached glance shows a household that is gone, and the queue holds taps aimed at
 * rows that no longer exist (or at new rows that happen to share their ids).
 * Replaying those writes would be worse than losing them.
 *
 * So the API serves an opaque dataset id ({@link fetchDatasetId}), the hub keeps
 * the last one it saw per household, and {@link checkDataset} compares the two:
 *
 * - **`unverified`** - the id could not be read (unreachable API, a proxy 502, a
 *   malformed body). Nothing is cleared: an outage must never look like a reset,
 *   because the queue exists precisely to survive outages.
 * - **`first-seen`** - no id was stored yet. The id is stored and everything is
 *   kept; there is nothing to compare against.
 * - **`unchanged`** - same id. Everything is kept.
 * - **`changed`** - a different id. The household's write queue and glance are
 *   cleared, then the new id is stored.
 *
 * The last-seen id lives in the same {@link sessionFallbackStorage} seam as the
 * queue, so it is durable exactly when the queue is.
 */

import type { ApiClient } from '../api/client';
import { fetchDatasetId } from '../api/dataset';
import { clearGlance } from './glanceCache';
import { sessionFallbackStorage, type LocalStorageLike } from './storage';
import { clearWriteQueue } from './writeQueue';

/** Storage-key prefix; versioned so a future record shape can coexist. */
export const DATASET_ID_PREFIX = 'butler.dataset.v1.';

/** The storage key holding the dataset id a household last saw. */
export function datasetIdKey(householdId: string): string {
  return `${DATASET_ID_PREFIX}${householdId}`;
}

/** The dataset id the household last saw, or `null` when none (or none readable) is stored. */
export function readLastSeenDatasetId(
  householdId: string,
  storage: LocalStorageLike = sessionFallbackStorage(),
): string | null {
  try {
    const raw = storage.getItem(datasetIdKey(householdId));
    return raw !== null && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Remember `datasetId` as the household's last-seen id. Never throws. */
export function writeLastSeenDatasetId(
  householdId: string,
  datasetId: string,
  storage: LocalStorageLike = sessionFallbackStorage(),
): void {
  try {
    storage.setItem(datasetIdKey(householdId), datasetId);
  } catch {
    // The fallback seam only throws when handed a broken store; a lost id reads
    // as first-seen next time, which keeps everything - the safe direction.
  }
}

/** What a dataset check concluded (see the module doc). */
export type DatasetCheck = 'unverified' | 'first-seen' | 'unchanged' | 'changed';

/**
 * Compare the API's dataset id with the one the household last saw, clearing the
 * household's queue and glance when they differ.
 *
 * Everything after the fetch is synchronous - read, compare, clear, store - so
 * two checks racing each other (the reconnect check and the queue's drain gate)
 * can never both see the old id: the first to resolve clears and stores, the
 * second compares against the new id. The queue is cleared before the glance so
 * a write can never outlive the cache it was rendered over.
 */
export async function checkDataset(householdId: string, client: ApiClient): Promise<DatasetCheck> {
  const datasetId = await fetchDatasetId(client);
  if (datasetId === null) {
    return 'unverified';
  }

  const lastSeen = readLastSeenDatasetId(householdId);
  if (lastSeen === null) {
    writeLastSeenDatasetId(householdId, datasetId);
    return 'first-seen';
  }
  if (lastSeen === datasetId) {
    return 'unchanged';
  }

  clearWriteQueue(householdId);
  clearGlance(householdId);
  writeLastSeenDatasetId(householdId, datasetId);
  return 'changed';
}
