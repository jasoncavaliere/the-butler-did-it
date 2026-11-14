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
 * `entries`, `pending`, `failed`, and `unreachable` are the state O4 renders (the
 * sync indicator's pending count, its failed-write surface, and its connection
 * state). O4 lifted the hook into {@link WriteQueueProvider}, which calls it once
 * per household and shares the result with the chore board and the indicator -
 * call it exactly once per household, never per consumer: two instances would be
 * two drains over one storage record, breaking the no-overlap rule above.
 *
 * `confirmedRevision` is for the surface that loads the data these writes change.
 * A load that raced the drain may have read the server's pre-sync answer, and once
 * a write is confirmed it has also left the queue - so no overlay of queued writes
 * can cover for that stale answer any more. Bumping once per drain run that
 * confirmed something is what lets the surface refetch the post-sync truth (#88).
 *
 * **The dataset gate (#100 D7).** When the hub hands in `verifyDataset`, every
 * drain pass that has something pending asks it first, and replays only when the
 * API is still serving the dataset the writes were taken against:
 * - `changed` - the guard has already emptied the queue and will remount the hub,
 *   so the run stops without sending anything;
 * - `unverified` - the API did not give a usable answer, so nothing is sent; the
 *   hook reports unreachable and re-probes after {@link OFFLINE_RETRY_MS}, exactly
 *   like a drain that found the API down;
 * - `unchanged` / `first-seen` - the drain goes ahead.
 * A pass with nothing pending sends nothing, so it asks nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '../api/client';
import type { DatasetCheck } from './datasetGuard';
import { useReconnectSignal } from './useReconnect';
import {
  OFFLINE_RETRY_MS,
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
  /**
   * A counter that increments once per drain run that confirmed at least one
   * write, however many writes or passes that took. Starts at 0, and is stable
   * while nothing is confirmed (an empty queue, an unreachable API, a refusal) -
   * so listing it in a load effect's dependencies refetches the post-sync server
   * state after a sync and never otherwise, the same contract as
   * {@link useReconnectSignal}.
   */
  confirmedRevision: number;
  /**
   * Whether the most recent drain run ended because the API did not answer (a
   * network failure, not a refusal). Starts `false`, and is reset by the next run
   * that reaches the API - so a browser that reports `online` while the API is
   * still down keeps reading as offline until a drain actually gets through (O4).
   */
  unreachable: boolean;
};

/**
 * Hold and drive the household's write queue, replaying it through `client`.
 *
 * The client is passed in rather than pulled from `useApiClient` so the hook has
 * no opinion about how a caller authenticates - the board already holds the
 * client it loads with, and a queued write must replay through exactly that one
 * (the paired hub-device or organizer bearer of T4/T5).
 *
 * `verifyDataset` is the dataset guard's check (see the module doc); without it
 * the drain replays unconditionally, as before D7.
 */
export function useWriteQueue(
  householdId: string,
  client: ApiClient,
  verifyDataset?: () => Promise<DatasetCheck>,
): WriteQueueState {
  const [entries, setEntries] = useState<QueuedWrite[]>(() => readWriteQueue(householdId));
  // Bumped whenever something should cause a drain that is not a reconnect: the
  // first mount, a fresh enqueue, an explicit flush, or a backoff timer firing.
  const [revision, setRevision] = useState(0);
  // Bumped once at the end of a drain run that confirmed anything (see the type).
  const [confirmedRevision, setConfirmedRevision] = useState(0);
  // Whether the last drain run ended on a network failure (see the type).
  const [unreachable, setUnreachable] = useState(false);

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
      // How the run ended: its final drain pass, or a pass the dataset gate held.
      let ending: Pick<DrainOutcome, 'offline' | 'retryDelayMs'>;
      let confirmedTotal = 0;
      do {
        drainAgain.current = false;
        // The dataset gate (#100 D7): never replay into a dataset the writes
        // were not taken against. Only a pass that would send something asks.
        if (verifyDataset && countPending(readWriteQueue(householdId)) > 0) {
          const check = await verifyDataset();
          if (!mounted.current || check === 'changed') {
            // Unmounted, or the guard has emptied the queue and is remounting
            // the hub, which re-hydrates the (now empty) queue.
            return;
          }
          if (check === 'unverified') {
            // Hold the queue and re-probe, exactly as if the API were down.
            ending = { offline: true, retryDelayMs: OFFLINE_RETRY_MS };
            break;
          }
        }
        // The drain judges each assignment write's week against the real clock
        // as it goes, so a write whose week ended during the outage is flagged
        // rather than replayed into last week (#89).
        const outcome = await drainWriteQueue(householdId, (write) =>
          clientRef.current.update(write.path, write.body, { method: write.method }),
        );
        if (!mounted.current) {
          return;
        }
        setEntries(outcome.queue);
        confirmedTotal += outcome.confirmed;
        ending = outcome;
      } while (drainAgain.current);

      // Only the run's final pass decides it: an earlier unreachable pass that a
      // repeated pass got past is not a current outage.
      setUnreachable(ending.offline);

      // One bump for the whole run, not one per write or per pass, so a surface
      // listening to it refetches once after a sync. A run that confirmed nothing
      // (including the empty-queue drain on mount) leaves it alone.
      if (confirmedTotal > 0) {
        setConfirmedRevision((previous) => previous + 1);
      }

      if (ending.retryDelayMs !== null) {
        const delayMs = ending.retryDelayMs;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setRevision((previous) => previous + 1);
        }, delayMs);
      }
    } finally {
      draining.current = false;
    }
  }, [householdId, cancelRetry, verifyDataset]);

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

  return { entries, pending, failed, enqueue, flush, confirmedRevision, unreachable };
}
