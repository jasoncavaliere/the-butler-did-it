/**
 * The React seam over the durable write queue (Epic 60 O3).
 *
 * {@link ../offline/writeQueue} is deliberately plain functions over storage -
 * it knows nothing about components, which is what makes its ordering and
 * retry rules testable in isolation. This hook is the part that has to live in
 * the tree: it holds the queue as state, hands a surface an `enqueue`, and owns
 * the three things that make a queued write eventually leave.
 *
 * **When it drains.**
 * - *On mount*, which is the durability guarantee showing its work: the queue is
 *   hydrated straight from storage, so writes taken before a reload or an app
 *   relaunch of the wall tablet are still there and are replayed immediately.
 * - *On reconnect*, reusing O2's {@link useReconnectSignal} - and only while
 *   something is actually pending, so a hub with an empty queue subscribes to
 *   nothing.
 * - *On a backoff timer*, whose delay the drain itself chooses: an exponential
 *   step after a real error answer, a slow re-probe while the API is
 *   unreachable. Never a tight loop, and never a timer when there is nothing
 *   left to retry.
 *
 * Drains never overlap: a request that arrives mid-drain is remembered and the
 * drain repeats once rather than running a second pass concurrently, which is
 * what keeps replay order a single sequence even when a tap lands during a sync.
 *
 * `entries`, `pending`, and `failed` are the state O4 renders (the indicator's
 * pending count and its failed-write surface). This stays a hook rather than a
 * provider because O3 has exactly one consumer - the chore board; O4 lifts it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '../api/client';
import { useReconnectSignal } from './useReconnect';
import {
  countFailed,
  countPending,
  drainWriteQueue,
  enqueueWrite,
  readWriteQueue,
  type DrainOutcome,
  type QueuedWrite,
  type WriteRequest,
} from './writeQueue';

/** What a surface gets from the queue. */
export type WriteQueueState = {
  /** Every queued write, in replay order (pending and flagged-failed alike). */
  entries: QueuedWrite[];
  /** How many writes are still trying to sync - O4's pending count. */
  pending: number;
  /** How many have exhausted their retries and need surfacing - never dropped. */
  failed: number;
  /** Queue a write and try to sync it straight away. */
  enqueue: (request: WriteRequest) => void;
  /** Attempt a drain now (used on an explicit retry). */
  flush: () => void;
};

/**
 * Hold and drive the household's write queue, replaying it through `client`.
 *
 * The client is passed in rather than pulled from `useApiClient` so the hook has
 * no opinion about how a caller authenticates - the board already holds the
 * client it loads with, and a queued write must replay through exactly that one
 * (the paired hub-device or organizer bearer of T4/T5).
 */
export function useWriteQueue(householdId: string, client: ApiClient): WriteQueueState {
  const [entries, setEntries] = useState<QueuedWrite[]>(() => readWriteQueue(householdId));
  // Bumped whenever something should cause a drain that is not a reconnect: the
  // first mount, a fresh enqueue, an explicit flush, or a backoff timer firing.
  const [revision, setRevision] = useState(0);

  // The client is held in a ref so `send` is stable: rebuilding it on every
  // client identity change would restart the drain effect, and the bearer is
  // resolved per request anyway.
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  const draining = useRef(false);
  const drainAgain = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const pending = countPending(entries);
  const failed = countFailed(entries);

  // Only a queue with something still trying listens for the network coming
  // back; a hub that is empty (or holds nothing but flagged writes, which a
  // reconnect cannot help) subscribes to nothing.
  const reconnectSignal = useReconnectSignal(pending > 0);

  const cancelRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const drain = useCallback(async () => {
    // A drain already in flight absorbs this request instead of racing it, so
    // the queue is only ever replayed as one ordered sequence.
    if (draining.current) {
      drainAgain.current = true;
      return;
    }
    draining.current = true;
    cancelRetry();
    try {
      let outcome: DrainOutcome;
      do {
        drainAgain.current = false;
        outcome = await drainWriteQueue(householdId, (write) =>
          clientRef.current.update(write.path, write.body, { method: write.method }),
        );
        if (!mounted.current) {
          return;
        }
        setEntries(outcome.queue);
      } while (drainAgain.current);

      if (outcome.retryDelayMs !== null) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setRevision((previous) => previous + 1);
        }, outcome.retryDelayMs);
      }
    } finally {
      draining.current = false;
    }
  }, [householdId, cancelRetry]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRetry();
    };
  }, [cancelRetry]);

  useEffect(() => {
    void drain();
  }, [drain, revision, reconnectSignal]);

  const enqueue = useCallback(
    (request: WriteRequest) => {
      // Storage first: the write is durable before anything renders it as done.
      setEntries(enqueueWrite(householdId, request));
      setRevision((previous) => previous + 1);
    },
    [householdId],
  );

  const flush = useCallback(() => setRevision((previous) => previous + 1), []);

  return { entries, pending, failed, enqueue, flush };
}
