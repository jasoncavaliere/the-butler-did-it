/**
 * The durable local write queue (Epic 60 O3).
 *
 * BRD 6.5 step 2: "Maya taps a chore done; the write queues locally and syncs
 * when the network returns." O2 made the *read* path survive an outage; this is
 * the write half. A tap that cannot reach the API is not an error and is not
 * lost - it is appended here, shown as done immediately, and replayed in order
 * once the network is back.
 *
 * **Why replay is safe.** Not because this module resolves conflicts - it
 * deliberately does not (BRD R-2). The API already makes the operation
 * idempotent: `ChoreCompletions` are append-only and an assignment's `Status` is
 * last-writer-wins per `(householdId, week, chore)` under optimistic concurrency,
 * and C4 states it outright - "a second complete of an already-`Done` assignment
 * is an idempotent success". So a write that reaches the server twice cannot
 * double-count or corrupt the assignment. On top of that this module keeps a
 * *client-side* de-duplication key so the common double-send never happens at
 * all: one queued write per target, never two.
 *
 * **What it guarantees.**
 * - *Durable.* One record per household in Web Storage, so a page reload or an
 *   app relaunch of the wall tablet finds the queue exactly as it left it.
 * - *Ordered.* Entries replay strictly head-first, and the drain stops at the
 *   first write it could not confirm rather than reordering around it.
 * - *Never silently dropped.* A write leaves the queue only when the API
 *   confirms it. A failure is retried with an exponential backoff, and a write
 *   that exhausts its retries is **flagged, kept, and stepped over** - bounded
 *   retries then flag-and-continue, so one poison write cannot block everything
 *   behind it forever, and O4 has something real to surface.
 *
 * **Not hard-wired to completions.** An entry stores the request itself - a
 * `{ method, path, body }` triple plus a descriptive `kind` - so any write type
 * replays through this same code path. A cart add (G3) enqueues its own `kind`
 * and inherits the identical durable-queue + replay contract without a line
 * changing here.
 *
 * Like the O2 cache, every storage failure mode degrades instead of throwing: no
 * storage (native, or a browser with it blocked), a missing entry, an
 * unparseable or wrong-shaped one, or a quota error on write all reduce to "no
 * queue" rather than crashing the tap that produced it.
 */

import type { ApiError, ApiResult } from '../api/client';
import { describeApiError } from '../api/errors';
import { defaultLocalStorage, isRecord, type LocalStorageLike } from './storage';

/** HTTP methods a queued write may replay with (reads are never queued). */
export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * What a queued write is, for the humans reading it (and for O4, which groups
 * the pending count and the failed surface by it). It is descriptive only - the
 * replay itself is driven by the stored request triple - which is what lets a
 * new write type join the queue without teaching the drain about it.
 */
export type QueuedWriteKind = 'chore-complete' | 'chore-undo' | 'cart-add';

/** A write handed to the queue: the request to replay, plus how to identify it. */
export type WriteRequest = {
  kind: QueuedWriteKind;
  /**
   * Identifies the *target* this write acts on, not the tap that made it. Two
   * writes against the same target collapse to the latest one (see
   * {@link enqueueWrite}), which is both the de-duplication guard of the AC and
   * the reason a queued entry can be addressed without a separate id.
   */
  dedupeKey: string;
  method: WriteMethod;
  /** API path, relative to the client's base URL. */
  path: string;
  /** JSON request body, replayed verbatim. */
  body: unknown;
};

/** Whether a queued write is still trying, or has exhausted its retries. */
export type QueuedWriteStatus = 'pending' | 'failed';

/** A write as it sits in the queue: the request plus its replay bookkeeping. */
export type QueuedWrite = WriteRequest & {
  /** When the tap happened (epoch ms) - the queue's own order is authoritative. */
  enqueuedAtMs: number;
  /** How many times the API has answered this write with a real error. */
  attempts: number;
  status: QueuedWriteStatus;
  /** The last error, kept readable so O4 can say *why* a write is stuck. */
  lastError?: string;
};

/**
 * Key prefix. The `v1` segment is the schema version: bumping it retires every
 * old record at once. Unlike the read cache, retiring a queue discards writes, so
 * a bump is a deliberate act - which is why entries are validated field by field
 * on the way out instead.
 */
export const WRITE_QUEUE_PREFIX = 'butler.writeq.v1.';

/** Storage key for a household's write queue. */
export function writeQueueKey(householdId: string): string {
  return `${WRITE_QUEUE_PREFIX}${householdId}`;
}

/**
 * How many real error answers a write absorbs before it is flagged `failed`.
 * Bounded on purpose: an unbounded retry is how one bad write blocks a queue
 * forever (the ticket's poison-write risk). An unreachable API is *not* one of
 * these answers - see {@link drainWriteQueue}.
 */
export const MAX_WRITE_ATTEMPTS = 5;

/** First backoff step, doubling per attempt. */
export const RETRY_BASE_MS = 1_000;

/** Backoff ceiling, so a long-lived hub settles into a slow retry, not a stall. */
export const RETRY_MAX_MS = 30_000;

/**
 * How long to wait before re-probing while the API is unreachable. A reconnect
 * event normally short-circuits this; the timer exists because a browser can
 * report `online` while the API is still unreachable (O4's noted risk), and
 * because the wall tablet is never reloaded by hand.
 */
export const OFFLINE_RETRY_MS = 30_000;

/**
 * Delay before the next attempt at a write that has failed `attempts` times:
 * 1s, 2s, 4s, 8s, capped at {@link RETRY_MAX_MS}. Deterministic (no jitter) -
 * a single wall tablet is not a thundering herd, and a fixed schedule is one a
 * test can assert on.
 */
export function backoffDelayMs(attempts: number): number {
  const step = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** step, RETRY_MAX_MS);
}

/**
 * The de-duplication key for a chore assignment. Keyed by the *target* -
 * `(weekIso, choreId)` - not by the direction, so tapping done twice queues one
 * write, and tapping done then undo collapses to the undo instead of queueing a
 * pair that would race itself on replay. Exported because the board also uses it
 * to find the queued write for a row when it redraws.
 */
export function assignmentDedupeKey(weekIso: string, choreId: string): string {
  return `assignment|${weekIso}|${choreId}`;
}

/** Whether a persisted value is one of the methods a queued write may use. */
function isWriteMethod(value: unknown): value is WriteMethod {
  return value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE';
}

/**
 * Rebuild one entry from storage, or `null` when it cannot be replayed at all.
 *
 * Every field the drain actually uses is checked, because storage is shared,
 * hand-editable, and survives schema changes: an entry missing its path or
 * method is not a write that can be retried, it is junk that would be POSTed at
 * `undefined`. `kind` is validated only as a string, never against the union -
 * an entry written by a newer build (a cart add, say) must survive a rollback
 * rather than be discarded by an older one.
 */
function parseWrite(value: unknown): QueuedWrite | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.kind !== 'string' || typeof value.dedupeKey !== 'string' || value.dedupeKey === '') {
    return null;
  }
  if (!isWriteMethod(value.method) || typeof value.path !== 'string' || value.path === '') {
    return null;
  }
  if (typeof value.enqueuedAtMs !== 'number' || typeof value.attempts !== 'number' || value.attempts < 0) {
    return null;
  }
  if (value.status !== 'pending' && value.status !== 'failed') {
    return null;
  }
  const write: QueuedWrite = {
    kind: value.kind as QueuedWriteKind,
    dedupeKey: value.dedupeKey,
    method: value.method,
    path: value.path,
    body: value.body,
    enqueuedAtMs: value.enqueuedAtMs,
    attempts: value.attempts,
    status: value.status,
  };
  return typeof value.lastError === 'string' ? { ...write, lastError: value.lastError } : write;
}

/**
 * Read a household's queue, in enqueue order. Anything untrustworthy reads as an
 * empty queue: no storage, no entry, an unreadable or unparseable one, or a
 * document that is not an array.
 *
 * Individual malformed entries are dropped rather than failing the whole read -
 * one corrupt row must not take the rest of the queue's real writes with it. A
 * duplicate `dedupeKey` (only reachable through hand-edited or corrupted storage,
 * since {@link enqueueWrite} maintains the invariant) keeps the earlier entry,
 * because that is the position the queue's order was built on and entries are
 * addressed by that key.
 */
export function readWriteQueue(
  householdId: string,
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): QueuedWrite[] {
  if (!storage) {
    return [];
  }

  let raw: string | null;
  try {
    raw = storage.getItem(writeQueueKey(householdId));
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const queue: QueuedWrite[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const write = parseWrite(entry);
    if (write === null || seen.has(write.dedupeKey)) {
      continue;
    }
    seen.add(write.dedupeKey);
    queue.push(write);
  }
  return queue;
}

/**
 * Persist a household's queue, returning whether it actually landed.
 *
 * A failure here (quota, private mode, a disabled store) is swallowed the way
 * the O2 cache swallows its own, but it means something stronger and the caller
 * is told: the queue is still correct in memory and will still replay this
 * session, it simply is not durable across a reload. Throwing instead would take
 * out the tap that produced the write, which is the one outcome the queue exists
 * to prevent.
 */
export function saveWriteQueue(
  householdId: string,
  queue: QueuedWrite[],
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(writeQueueKey(householdId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/**
 * Queue `request` and return the resulting queue.
 *
 * A new target is appended, so replay order is tap order. A target that is
 * already queued is **replaced in place** - same position, `attempts` reset,
 * any `failed` flag cleared - which is the client-side de-duplication guard of
 * the AC and does three things at once:
 * - the same completion tapped twice is one queued write and one API call, so
 *   the double-send the server would have absorbed idempotently never happens;
 * - a complete-then-undo on the same chore replays as the single write the user
 *   actually meant, instead of two writes racing to be the last writer;
 * - keeping the original position means collapsing a redundant write cannot
 *   reorder it past writes that were queued after it.
 */
export function enqueueWrite(
  householdId: string,
  request: WriteRequest,
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
  nowMs: number = Date.now(),
): QueuedWrite[] {
  const queued: QueuedWrite = {
    ...request,
    enqueuedAtMs: nowMs,
    attempts: 0,
    status: 'pending',
  };

  const existing = readWriteQueue(householdId, storage);
  const at = existing.findIndex((entry) => entry.dedupeKey === request.dedupeKey);
  const queue =
    at === -1
      ? [...existing, queued]
      : existing.map((entry, index) => (index === at ? queued : entry));

  saveWriteQueue(householdId, queue, storage);
  return queue;
}

/** What one replay pass did, and when the caller should come back. */
export type DrainOutcome = {
  /** The queue as it now stands, already persisted. */
  queue: QueuedWrite[];
  /** How many writes the API confirmed (and which therefore left the queue). */
  confirmed: number;
  /** Milliseconds until the next attempt, or `null` when nothing is left to retry. */
  retryDelayMs: number | null;
  /** True when the pass stopped because the API was unreachable. */
  offline: boolean;
};

/** Sends one queued write; resolves to the client's normalized result. */
export type SendWrite = (write: QueuedWrite) => Promise<ApiResult<unknown>>;

/**
 * Replay the household's queue against the API, head-first, and persist the
 * result of every step.
 *
 * The rules, in the order they matter:
 *
 * - **Confirmed writes leave, and only then.** An entry is removed after the API
 *   answers `ok`, and the shortened queue is written to storage before the next
 *   send - so a reload mid-drain resumes exactly where it stopped and never
 *   re-sends something already confirmed.
 * - **A tap taken mid-sync survives it.** The queue is re-read from storage after
 *   every request rather than carried as a snapshot, so a write enqueued while a
 *   request was in flight is not erased by the answer to a request it predates -
 *   and a write that was *replaced* mid-flight is not confirmed away on behalf of
 *   the intent that superseded it.
 * - **Order is preserved by stopping, not by skipping.** A write that could not
 *   be confirmed halts the pass rather than letting the writes behind it
 *   overtake it.
 * - **An unreachable API costs a write nothing.** A `network` error means the
 *   outage is still on, not that the write is bad, so it does not consume the
 *   retry budget: an outage of any length can never mark a write terminally
 *   failed. The pass simply stops and asks to be retried later.
 * - **A real error answer counts.** An HTTP / problem-details / parse failure is
 *   the service actually responding, so it increments `attempts` and the pass
 *   backs off exponentially instead of hammering ({@link backoffDelayMs}).
 * - **Bounded retries, then flag and continue.** At {@link MAX_WRITE_ATTEMPTS}
 *   the entry is flagged `failed` with its last error and the drain moves *past*
 *   it. It stays in storage - never dropped, never auto-cleared - which is what
 *   O4 surfaces; and it stops holding the rest of the queue hostage.
 *
 * A `failed` entry is skipped on every later pass. Only a fresh tap on the same
 * target revives it, which {@link enqueueWrite} does by resetting the entry.
 */
export async function drainWriteQueue(
  householdId: string,
  send: SendWrite,
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): Promise<DrainOutcome> {
  let queue = readWriteQueue(householdId, storage);
  let confirmed = 0;
  let index = 0;

  while (index < queue.length) {
    const write = queue[index];

    if (write.status === 'failed') {
      index += 1;
      continue;
    }

    const result = await send(write);

    // Re-read before writing anything back. A tap taken while that request was in
    // flight is already in storage, and persisting the snapshot this pass started
    // with would erase it - losing a write to a sync, which is precisely the
    // failure the queue exists to prevent.
    queue = readWriteQueue(householdId, storage);
    const stillQueued = queue.some(
      (entry) => entry.dedupeKey === write.dedupeKey && entry.enqueuedAtMs === write.enqueuedAtMs,
    );
    if (!stillQueued) {
      // Superseded mid-flight (a second tap on the same chore replaced it) or
      // cleared outright. Whatever now holds that position is the intent the user
      // last expressed, so it is sent on the next turn of this loop rather than
      // being overwritten by the answer to a request it did not make.
      continue;
    }

    if (result.ok) {
      queue = queue.filter((entry) => entry.dedupeKey !== write.dedupeKey);
      saveWriteQueue(householdId, queue, storage);
      confirmed += 1;
      // The next entry has shifted into `index`, so it is not advanced.
      continue;
    }

    if (result.error.kind === 'network') {
      return { queue, confirmed, retryDelayMs: OFFLINE_RETRY_MS, offline: true };
    }

    queue = withAttempt(queue, write.dedupeKey, write.attempts + 1, result.error);
    saveWriteQueue(householdId, queue, storage);

    if (write.attempts + 1 >= MAX_WRITE_ATTEMPTS) {
      index += 1;
      continue;
    }
    return { queue, confirmed, retryDelayMs: backoffDelayMs(write.attempts + 1), offline: false };
  }

  return { queue, confirmed, retryDelayMs: null, offline: false };
}

/** Record one real error answer against a queued write, flagging it at the cap. */
function withAttempt(
  queue: QueuedWrite[],
  dedupeKey: string,
  attempts: number,
  error: ApiError,
): QueuedWrite[] {
  return queue.map((entry) =>
    entry.dedupeKey === dedupeKey
      ? {
          ...entry,
          attempts,
          status: attempts >= MAX_WRITE_ATTEMPTS ? ('failed' as const) : ('pending' as const),
          lastError: describeApiError(error),
        }
      : entry,
  );
}

/** How many queued writes are still trying to sync. */
export function countPending(queue: QueuedWrite[]): number {
  return queue.filter((entry) => entry.status === 'pending').length;
}

/** How many queued writes have exhausted their retries and need surfacing (O4). */
export function countFailed(queue: QueuedWrite[]): number {
  return queue.filter((entry) => entry.status === 'failed').length;
}
