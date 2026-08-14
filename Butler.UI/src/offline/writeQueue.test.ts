import type { ApiResult } from '../api/client';
import { resetSessionFallbackStorage, type LocalStorageLike } from './storage';
import {
  MAX_WRITE_ATTEMPTS,
  OFFLINE_RETRY_MS,
  RETRY_MAX_MS,
  WRITE_QUEUE_PREFIX,
  assignmentDedupeKey,
  backoffDelayMs,
  countFailed,
  countPending,
  drainWriteQueue,
  enqueueWrite,
  readWriteQueue,
  saveWriteQueue,
  writeQueueKey,
  type QueuedWrite,
  type WriteRequest,
} from './writeQueue';

const WEEK = '2026-W29';

/** An in-memory stand-in for Web Storage, with the raw map exposed to assert on. */
function fakeStorage(seed: Record<string, string> = {}): LocalStorageLike & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** Install (or remove, with `undefined`) an ambient `globalThis.localStorage`. */
function setGlobalStorage(storage: LocalStorageLike | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

/** A chore completion, the write this queue exists for. */
function completion(choreId: string, personId = 'p1'): WriteRequest {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/hh-1/assignments/${WEEK}/${choreId}/complete`,
    body: { personId },
  };
}

/** Its reversal, against the same target - so it collapses onto the completion. */
function reversal(choreId: string, personId = 'p1'): WriteRequest {
  return {
    kind: 'chore-undo',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/hh-1/assignments/${WEEK}/${choreId}/undo`,
    body: { personId },
  };
}

const confirmed: ApiResult<unknown> = { ok: true, status: 200, data: {}, etag: null };

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

const refused: ApiResult<never> = {
  ok: false,
  error: { kind: 'problem', status: 409, title: 'Conflict', detail: 'That week is closed.' },
};

/** A `send` that records the paths it was given, answering per call. */
function recordingSend(answers: (ApiResult<unknown> | undefined)[] = []) {
  const paths: string[] = [];
  let call = 0;
  const send = jest.fn(async (write: QueuedWrite): Promise<ApiResult<unknown>> => {
    paths.push(write.path);
    const answer = answers[call] ?? answers[answers.length - 1] ?? confirmed;
    call += 1;
    return answer;
  });
  return { send, paths };
}

beforeEach(() => {
  // Native (and Jest) have no Web Storage; tests that want one install it.
  setGlobalStorage(undefined);
  // The session fallback is a process-wide singleton on purpose, so a test that
  // exercises the degraded path would otherwise seed the next one.
  resetSessionFallbackStorage();
});

afterEach(() => {
  setGlobalStorage(undefined);
  resetSessionFallbackStorage();
});

describe('writeQueueKey', () => {
  it('scopes the queue by household, so two households never share writes', () => {
    expect(writeQueueKey('hh-1')).toBe(`${WRITE_QUEUE_PREFIX}hh-1`);
    expect(writeQueueKey('hh-2')).not.toBe(writeQueueKey('hh-1'));
  });
});

describe('assignmentDedupeKey', () => {
  it('identifies the target, not the direction of the write', () => {
    // Complete and undo on the same chore share a key on purpose: the queue holds
    // the latest intent for a target rather than a pair of writes racing to win.
    expect(assignmentDedupeKey(WEEK, 'c1')).toBe(assignmentDedupeKey(WEEK, 'c1'));
    expect(assignmentDedupeKey(WEEK, 'c1')).not.toBe(assignmentDedupeKey(WEEK, 'c2'));
    // The week is part of the identity, so the same chore in a different week is
    // a different write - which is what the stale-week guard depends on.
    expect(assignmentDedupeKey('2026-W28', 'c1')).not.toBe(assignmentDedupeKey(WEEK, 'c1'));
  });
});

describe('enqueueWrite / readWriteQueue', () => {
  it('queue-persists-offline: a tap survives the reload that follows it', () => {
    // The storage map *is* the durability: reading it back through a fresh call
    // is exactly what a relaunched hub does with the browser's own storage.
    const storage = fakeStorage();

    enqueueWrite('hh-1', completion('c1'), storage, 1_700_000_000_000);

    expect(storage.entries.has(writeQueueKey('hh-1'))).toBe(true);
    expect(readWriteQueue('hh-1', storage)).toEqual([
      {
        ...completion('c1'),
        enqueuedAtMs: 1_700_000_000_000,
        attempts: 0,
        status: 'pending',
      },
    ]);
  });

  it('replays in tap order: later writes queue behind earlier ones', () => {
    const storage = fakeStorage();

    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    enqueueWrite('hh-1', completion('c3'), storage, 3);

    expect(readWriteQueue('hh-1', storage).map((entry) => entry.path)).toEqual([
      completion('c1').path,
      completion('c2').path,
      completion('c3').path,
    ]);
  });

  it('de-duplicates: the same completion tapped twice is one queued write', () => {
    const storage = fakeStorage();

    enqueueWrite('hh-1', completion('c1'), storage, 1);
    const queue = enqueueWrite('hh-1', completion('c1'), storage, 2);

    expect(queue).toHaveLength(1);
    expect(queue[0].enqueuedAtMs).toBe(2);
  });

  it('collapses a complete-then-undo onto the latest intent, in place', () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);

    const queue = enqueueWrite('hh-1', reversal('c1'), storage, 3);

    // One write for c1, and it is the undo the user last meant...
    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe('chore-undo');
    // ...still in its original position, so collapsing it cannot reorder it past
    // the write that was queued after it.
    expect(queue.map((entry) => entry.dedupeKey)).toEqual([
      assignmentDedupeKey(WEEK, 'c1'),
      assignmentDedupeKey(WEEK, 'c2'),
    ]);
  });

  it('a fresh tap revives a write that had exhausted its retries', () => {
    const storage = fakeStorage();
    saveWriteQueue(
      'hh-1',
      [{ ...completion('c1'), enqueuedAtMs: 1, attempts: MAX_WRITE_ATTEMPTS, status: 'failed', lastError: 'Conflict' }],
      storage,
    );

    const queue = enqueueWrite('hh-1', completion('c1'), storage, 2);

    expect(queue[0]).toMatchObject({ attempts: 0, status: 'pending' });
    expect(queue[0].lastError).toBeUndefined();
  });

  it('keeps households apart: each queue is its own record', () => {
    const storage = fakeStorage();

    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-2', completion('c2'), storage, 2);

    expect(readWriteQueue('hh-1', storage)).toHaveLength(1);
    expect(readWriteQueue('hh-1', storage)[0].dedupeKey).toBe(assignmentDedupeKey(WEEK, 'c1'));
    expect(readWriteQueue('hh-2', storage)[0].dedupeKey).toBe(assignmentDedupeKey(WEEK, 'c2'));
  });

  it('carries a write type it was never taught: a cart add queues the same way', () => {
    // AC: the queue is not hard-wired to completions. It stores the request
    // itself, so a different capability's write needs no change here at all.
    const storage = fakeStorage();
    const cartAdd: WriteRequest = {
      kind: 'cart-add',
      dedupeKey: 'cart|2026-W29|oat-milk',
      method: 'POST',
      path: '/households/hh-1/capture/text',
      body: { term: 'oat milk' },
    };

    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', cartAdd, storage, 2);

    expect(readWriteQueue('hh-1', storage).map((entry) => entry.kind)).toEqual([
      'chore-complete',
      'cart-add',
    ]);
  });

  it('reads as an empty queue when nothing has been stored', () => {
    expect(readWriteQueue('hh-1', fakeStorage())).toEqual([]);
  });

  it.each([
    ['unparseable', '{not json'],
    ['not an array', JSON.stringify({ dedupeKey: 'x' })],
    ['a null document', 'null'],
  ])('reads as an empty queue when the record is %s', (_label, raw) => {
    expect(readWriteQueue('hh-1', fakeStorage({ [writeQueueKey('hh-1')]: raw }))).toEqual([]);
  });

  it('reads as an empty queue when storage itself throws', () => {
    const storage: LocalStorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };

    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('keeps the queue in session memory with no storage at all (native, or a browser that blocks it)', () => {
    // The degraded path is *not* "no queue". A tap taken on a device with no Web
    // Storage is still queued, still readable back, and so still replayed - it
    // simply does not survive a relaunch. Dropping it here would discard a write
    // the family saw succeed, which is the outcome the queue exists to prevent.
    expect(readWriteQueue('hh-1')).toEqual([]);

    enqueueWrite('hh-1', completion('c1'), undefined, 1);

    expect(readWriteQueue('hh-1')).toEqual([
      { ...completion('c1'), enqueuedAtMs: 1, attempts: 0, status: 'pending' },
    ]);
    // ...and the caller is told it is session-only rather than durable.
    expect(saveWriteQueue('hh-1', readWriteQueue('hh-1'))).toBe(false);
  });

  it('keeps the queue in session memory when storage refuses the write (quota, private mode)', () => {
    // The store is present and readable, so it is not "no storage" - it just will
    // not take the write. Persisting the stale record it already holds would be
    // worse than useless, so this key reads from memory from here on.
    setGlobalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    enqueueWrite('hh-1', completion('c1'), undefined, 1);

    expect(readWriteQueue('hh-1')).toEqual([
      { ...completion('c1'), enqueuedAtMs: 1, attempts: 0, status: 'pending' },
    ]);
    expect(saveWriteQueue('hh-1', readWriteQueue('hh-1'))).toBe(false);
  });

  it('reports the queue as durable once storage does take the write', () => {
    setGlobalStorage(fakeStorage());

    expect(saveWriteQueue('hh-1', [{ ...completion('c1'), enqueuedAtMs: 1, attempts: 0, status: 'pending' }])).toBe(
      true,
    );
  });

  it('uses the ambient browser storage when one is present', () => {
    setGlobalStorage(fakeStorage());

    enqueueWrite('hh-1', completion('c1'), undefined, 1);

    expect(readWriteQueue('hh-1')).toHaveLength(1);
  });

  it('reports a write that could not be persisted, instead of pretending', () => {
    // Quota, private mode, a disabled store: the queue is still correct in memory
    // and still replays this session, but the caller is told it is not durable.
    const storage: LocalStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(saveWriteQueue('hh-1', [], storage)).toBe(false);
  });
});

/**
 * Storage is shared, hand-editable, and survives schema changes, so nothing in it
 * is trusted on the way out. An entry that cannot be replayed - no path, no
 * method - is not a write being dropped, it is junk that would otherwise be
 * POSTed at `undefined`; the real writes around it must survive it.
 */
describe('a malformed entry is dropped without taking the queue with it', () => {
  const sound = { ...completion('c1'), enqueuedAtMs: 1, attempts: 0, status: 'pending' as const };

  function seed(...entries: unknown[]) {
    return fakeStorage({ [writeQueueKey('hh-1')]: JSON.stringify(entries) });
  }

  it.each([
    ['not an object', 'complete c1'],
    ['an array', []],
    ['missing its kind', { ...sound, kind: undefined }],
    ['carrying a non-string kind', { ...sound, kind: 7 }],
    ['missing its dedupe key', { ...sound, dedupeKey: undefined }],
    ['carrying an empty dedupe key', { ...sound, dedupeKey: '' }],
    ['carrying a method it cannot replay with', { ...sound, method: 'GET' }],
    ['missing its path', { ...sound, path: undefined }],
    ['carrying an empty path', { ...sound, path: '' }],
    ['missing its enqueue stamp', { ...sound, enqueuedAtMs: undefined }],
    ['carrying a non-numeric attempt count', { ...sound, attempts: 'many' }],
    ['carrying a negative attempt count', { ...sound, attempts: -1 }],
    ['carrying an unknown status', { ...sound, status: 'syncing' }],
  ])('drops an entry that is %s', (_label, malformed) => {
    const queue = readWriteQueue('hh-1', seed(malformed, { ...sound, dedupeKey: 'keep-me' }));

    expect(queue).toHaveLength(1);
    expect(queue[0].dedupeKey).toBe('keep-me');
  });

  it('keeps a well-formed entry whole, including its recorded last error', () => {
    const flagged = { ...sound, attempts: 2, status: 'failed' as const, lastError: 'Conflict' };

    expect(readWriteQueue('hh-1', seed(flagged))).toEqual([flagged]);
  });

  it('ignores a non-string last error rather than rejecting the write', () => {
    // The error text is for O4 to show; it is not what makes a write replayable,
    // so a junk value costs the note, never the write.
    const queue = readWriteQueue('hh-1', seed({ ...sound, lastError: 500 }));

    expect(queue).toHaveLength(1);
    expect(queue[0].lastError).toBeUndefined();
  });

  it('keeps the first of two entries sharing a dedupe key', () => {
    // Only reachable through hand-edited or corrupted storage, since enqueue
    // maintains the invariant - but entries are *addressed* by that key, so a
    // duplicate would otherwise see one confirmed send remove both writes.
    const queue = readWriteQueue('hh-1', seed(sound, { ...sound, path: '/second' }));

    expect(queue).toHaveLength(1);
    expect(queue[0].path).toBe(sound.path);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt and then holds at the ceiling, never a tight loop', () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(4_000);
    expect(backoffDelayMs(4)).toBe(8_000);
    expect(backoffDelayMs(20)).toBe(RETRY_MAX_MS);
    // Defensive: a zero/negative count still waits, rather than retrying instantly.
    expect(backoffDelayMs(0)).toBe(1_000);
  });
});

describe('drainWriteQueue', () => {
  it('replay-on-reconnect: drains in enqueue order and empties the queue', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    enqueueWrite('hh-1', completion('c3'), storage, 3);
    const { send, paths } = recordingSend([confirmed]);

    const outcome = await drainWriteQueue('hh-1', send, storage);

    expect(paths).toEqual([completion('c1').path, completion('c2').path, completion('c3').path]);
    expect(outcome).toEqual({ queue: [], confirmed: 3, retryDelayMs: null, offline: false });
    // Durably empty: a reload after the drain does not replay any of them again.
    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('replay-idempotent: a completion tapped twice sends once and clears once', async () => {
    // The API is idempotent for a repeated complete (C4), but the client-side
    // de-duplication key means the repeat never even goes out.
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c1'), storage, 2);
    const { send } = recordingSend([confirmed]);

    const outcome = await drainWriteQueue('hh-1', send, storage);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.confirmed).toBe(1);
    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('draining twice does not re-send what the API already confirmed', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    const { send } = recordingSend([confirmed]);

    await drainWriteQueue('hh-1', send, storage);
    await drainWriteQueue('hh-1', send, storage);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('removes a write only after the API confirms it', async () => {
    // The queue is inspected from *inside* the send, i.e. mid-flight: the write
    // being replayed is still queued, so a crash or reload right here replays it
    // rather than losing it.
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    let inFlight: QueuedWrite[] = [];

    await drainWriteQueue(
      'hh-1',
      async () => {
        inFlight = readWriteQueue('hh-1', storage);
        return confirmed;
      },
      storage,
    );

    expect(inFlight).toHaveLength(1);
    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('persists each confirmation as it happens, so a reload resumes mid-drain', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    const seenBySecondSend: string[][] = [];

    await drainWriteQueue(
      'hh-1',
      async () => {
        seenBySecondSend.push(readWriteQueue('hh-1', storage).map((entry) => entry.dedupeKey));
        return confirmed;
      },
      storage,
    );

    // By the time the second write goes out, the first has already left storage.
    expect(seenBySecondSend[1]).toEqual([assignmentDedupeKey(WEEK, 'c2')]);
  });

  it('a tap taken while a request is in flight survives the sync', async () => {
    // The wall tablet is shared: someone taps a second chore while the first is
    // still syncing. Persisting the snapshot the pass started with would erase
    // that tap - a write lost to a sync, which is the whole point of the queue.
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    let taps = 0;

    const outcome = await drainWriteQueue(
      'hh-1',
      async () => {
        taps += 1;
        if (taps === 1) {
          enqueueWrite('hh-1', completion('c2'), storage, 2);
        }
        return confirmed;
      },
      storage,
    );

    expect(taps).toBe(2);
    expect(outcome.confirmed).toBe(2);
    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('does not confirm away a write that was replaced mid-flight', async () => {
    // Tap done, then tap undo before the first request answers. Removing the
    // entry on the completion's `ok` would drop the undo the user last meant.
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    const sent: string[] = [];

    const outcome = await drainWriteQueue(
      'hh-1',
      async (write) => {
        sent.push(write.path);
        if (sent.length === 1) {
          enqueueWrite('hh-1', reversal('c1'), storage, 2);
        }
        return confirmed;
      },
      storage,
    );

    expect(sent).toEqual([completion('c1').path, reversal('c1').path]);
    // Only the undo is counted as confirmed - the completion's own answer was
    // discarded, because by then it was not the write sitting in the queue.
    expect(outcome.confirmed).toBe(1);
    expect(readWriteQueue('hh-1', storage)).toEqual([]);
  });

  it('an unreachable API stops the pass and costs the write nothing', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    const { send } = recordingSend([unreachable]);

    const outcome = await drainWriteQueue('hh-1', send, storage);

    // It stops at the head rather than letting c2 overtake c1...
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ confirmed: 0, offline: true, retryDelayMs: OFFLINE_RETRY_MS });
    // ...and the outage does not burn the retry budget, so an outage of any
    // length can never mark a perfectly good write as terminally failed.
    expect(readWriteQueue('hh-1', storage).map((entry) => entry.attempts)).toEqual([0, 0]);
  });

  it('resumes at the head once the network is back, still in order', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    await drainWriteQueue('hh-1', recordingSend([unreachable]).send, storage);

    const { paths } = recordingSend([confirmed]);
    const second = recordingSend([confirmed]);
    const outcome = await drainWriteQueue('hh-1', second.send, storage);

    expect(paths).toEqual([]);
    expect(second.paths).toEqual([completion('c1').path, completion('c2').path]);
    expect(outcome.confirmed).toBe(2);
  });

  it('failed-replay-is-retried-not-dropped: a refusal keeps the write and backs off', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    const { send } = recordingSend([refused]);

    const first = await drainWriteQueue('hh-1', send, storage);

    // The write is still queued, is now recorded as having been refused once, and
    // the caller is told to come back in a second - not immediately.
    expect(send).toHaveBeenCalledTimes(1);
    expect(first.retryDelayMs).toBe(1_000);
    expect(first.offline).toBe(false);
    expect(readWriteQueue('hh-1', storage)[0]).toMatchObject({
      attempts: 1,
      status: 'pending',
      lastError: 'That week is closed.',
    });

    // ...and the next pass retries that same write first, rather than skipping it.
    const second = await drainWriteQueue('hh-1', send, storage);
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: completion('c1').path }));
    expect(second.retryDelayMs).toBe(2_000);
  });

  it('flags a write at the retry cap and steps past it, so it cannot block the queue', async () => {
    const storage = fakeStorage();
    enqueueWrite('hh-1', completion('c1'), storage, 1);
    enqueueWrite('hh-1', completion('c2'), storage, 2);
    // The poison write is refused every time; the one behind it is fine.
    const send = jest.fn(async (write: QueuedWrite) =>
      write.path === completion('c1').path ? refused : confirmed,
    );

    let outcome = await drainWriteQueue('hh-1', send, storage);
    for (let attempt = 2; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      expect(outcome.retryDelayMs).not.toBeNull();
      outcome = await drainWriteQueue('hh-1', send, storage);
    }

    // The poison write is flagged and *kept* - never dropped, never auto-cleared,
    // which is what O4 surfaces...
    const queue = readWriteQueue('hh-1', storage);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      dedupeKey: assignmentDedupeKey(WEEK, 'c1'),
      attempts: MAX_WRITE_ATTEMPTS,
      status: 'failed',
    });
    // ...and the healthy write behind it got through instead of waiting forever.
    expect(outcome.confirmed).toBe(1);
    expect(outcome.retryDelayMs).toBeNull();
  });

  it('skips an already-flagged write on every later pass', async () => {
    const storage = fakeStorage();
    saveWriteQueue(
      'hh-1',
      [
        { ...completion('c1'), enqueuedAtMs: 1, attempts: MAX_WRITE_ATTEMPTS, status: 'failed' },
        { ...completion('c2'), enqueuedAtMs: 2, attempts: 0, status: 'pending' },
      ],
      storage,
    );
    const { send, paths } = recordingSend([confirmed]);

    const outcome = await drainWriteQueue('hh-1', send, storage);

    expect(paths).toEqual([completion('c2').path]);
    expect(outcome.retryDelayMs).toBeNull();
    expect(readWriteQueue('hh-1', storage).map((entry) => entry.status)).toEqual(['failed']);
  });

  it('an empty queue is a no-op that asks for no retry', async () => {
    const { send } = recordingSend();

    expect(await drainWriteQueue('hh-1', send, fakeStorage())).toEqual({
      queue: [],
      confirmed: 0,
      retryDelayMs: null,
      offline: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('countPending / countFailed', () => {
  it('separates what is still trying from what needs surfacing', () => {
    const queue: QueuedWrite[] = [
      { ...completion('c1'), enqueuedAtMs: 1, attempts: 0, status: 'pending' },
      { ...completion('c2'), enqueuedAtMs: 2, attempts: 1, status: 'pending' },
      { ...completion('c3'), enqueuedAtMs: 3, attempts: MAX_WRITE_ATTEMPTS, status: 'failed' },
    ];

    expect(countPending(queue)).toBe(2);
    expect(countFailed(queue)).toBe(1);
    expect(countPending([])).toBe(0);
    expect(countFailed([])).toBe(0);
  });
});
