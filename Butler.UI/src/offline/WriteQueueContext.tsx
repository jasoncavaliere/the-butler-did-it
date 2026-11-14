import { createContext, useContext, type ReactNode } from 'react';

import type { ApiClient } from '../api/client';
import type { DatasetCheck } from './datasetGuard';
import { useWriteQueue, type WriteQueueState } from './useWriteQueue';

/**
 * One write queue per household, shared by everything that reads it (Epic 60 O4).
 *
 * O3 had a single consumer, the chore board, so the queue lived in the board as a
 * hook. O4 adds a second - the sync indicator in the hub header - and two calls
 * to {@link useWriteQueue} would mean two drains running over one storage record,
 * which breaks the queue's "drains never overlap" guarantee and with it replay
 * order. So the hub mounts this provider once, it calls the hook once, and both
 * the board and the indicator read the same state through
 * {@link useWriteQueueContext}.
 *
 * Unlike {@link useOrganizer} there is deliberately no forgiving default outside
 * a provider: a default queue could not drain, so a write enqueued into it would
 * be silently lost. A consumer rendered without the provider throws instead.
 */
const WriteQueueContext = createContext<WriteQueueState | null>(null);

export function WriteQueueProvider({
  householdId,
  client,
  verifyDataset,
  children,
}: {
  householdId: string;
  /** The client queued writes replay through (the hub's own, see useWriteQueue). */
  client: ApiClient;
  /** The dataset guard's check, gating every replay (#100 D7, see useWriteQueue). */
  verifyDataset?: () => Promise<DatasetCheck>;
  children: ReactNode;
}) {
  const queue = useWriteQueue(householdId, client, verifyDataset);
  return <WriteQueueContext.Provider value={queue}>{children}</WriteQueueContext.Provider>;
}

/** Read the household's shared write queue; throws outside a {@link WriteQueueProvider}. */
export function useWriteQueueContext(): WriteQueueState {
  const queue = useContext(WriteQueueContext);
  if (queue === null) {
    throw new Error('useWriteQueueContext must be used inside a WriteQueueProvider');
  }
  return queue;
}
