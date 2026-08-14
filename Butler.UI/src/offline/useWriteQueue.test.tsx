import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type { LocalStorageLike } from './storage';
import { useWriteQueue } from './useWriteQueue';
import {
  MAX_WRITE_ATTEMPTS,
  OFFLINE_RETRY_MS,
  assignmentDedupeKey,
  readWriteQueue,
  saveWriteQueue,
  writeQueueKey,
  type QueuedWrite,
  type WriteRequest,
} from './writeQueue';

const WEEK = '2026-W29';

const confirmed: ApiResult<unknown> = { ok: true, status: 200, data: {}, etag: null };

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

const refused: ApiResult<never> = {
  ok: false,
  error: { kind: 'http', status: 409, title: 'Conflict' },
};

function completion(choreId: string): WriteRequest {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/hh-1/assignments/${WEEK}/${choreId}/complete`,
    body: { personId: 'p1' },
  };
}

/** A queued write as it would look after a reload, straight out of storage. */
function stored(choreId: string, overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return { ...completion(choreId), enqueuedAtMs: 1, attempts: 0, status: 'pending', ...overrides };
}

/** Install an in-memory `globalThis.localStorage` and hand back its raw map. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage: LocalStorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  return map;
}

/** Stands in for the browser's `online` event; returns a function that fires it. */
function installReconnect(restore: (() => void)[]): () => void {
  const listeners = new Set<() => void>();
  const original = {
    add: (globalThis as { addEventListener?: unknown }).addEventListener,
    remove: (globalThis as { removeEventListener?: unknown }).removeEventListener,
  };
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  define('addEventListener', (type: string, listener: () => void) => {
    if (type === 'online') {
      listeners.add(listener);
    }
  });
  define('removeEventListener', (type: string, listener: () => void) => {
    if (type === 'online') {
      listeners.delete(listener);
    }
  });
  restore.push(() => {
    define('addEventListener', original.add);
    define('removeEventListener', original.remove);
  });

  return () => {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };
}

/** A client whose every write is answered by `answer`, recording the calls. */
function queueClient(answer: () => Promise<ApiResult<unknown>> | ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn() as unknown as ApiClient['get'],
    update: jest.fn(async (_path: string, _body: unknown, _options?: UpdateOptions) =>
      answer(),
    ) as unknown as ApiClient['update'],
  };
}

let cleanups: (() => void)[] = [];

beforeEach(() => {
  cleanups = [];
  installStorage();
});

afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  jest.useRealTimers();
});

describe('useWriteQueue', () => {
  it('queue-persists-offline: hydrates writes taken before a reload, and replays them', async () => {
    // The storage record is what a relaunched wall tablet finds. Nobody taps
    // anything in this test - the drain is entirely the mount doing its job.
    saveWriteQueue('hh-1', [stored('c1'), stored('c2')]);
    const client = queueClient(() => confirmed);

    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(client.update).toHaveBeenCalledTimes(2);
    expect(client.update).toHaveBeenNthCalledWith(1, completion('c1').path, { personId: 'p1' }, { method: 'POST' });
    expect(client.update).toHaveBeenNthCalledWith(2, completion('c2').path, { personId: 'p1' }, { method: 'POST' });
    expect(readWriteQueue('hh-1')).toEqual([]);
  });

  it('enqueue makes the write durable and syncs it straight away', async () => {
    const client = queueClient(() => confirmed);
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });

    await waitFor(() => expect(client.update).toHaveBeenCalledWith(
      completion('c1').path,
      { personId: 'p1' },
      { method: 'POST' },
    ));
    await waitFor(() => expect(result.current.entries).toEqual([]));
  });

  it('an offline enqueue stays queued, durably, and counts as pending', async () => {
    const client = queueClient(() => unreachable);
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });

    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(result.current.failed).toBe(0);
    // Durable, not merely in React state: a reload finds it.
    expect(readWriteQueue('hh-1')).toHaveLength(1);
  });

  it('replay-on-reconnect: the network coming back drains the queue', async () => {
    const emitOnline = installReconnect(cleanups);
    let offline = true;
    const client = queueClient(() => (offline ? unreachable : confirmed));
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() => expect(result.current.pending).toBe(1));
    const attemptsWhileOffline = (client.update as jest.Mock).mock.calls.length;

    // Nobody touches the tablet: the `online` event alone has to drain it.
    offline = false;
    await act(async () => {
      emitOnline();
    });

    await waitFor(() => expect(result.current.pending).toBe(0));
    expect((client.update as jest.Mock).mock.calls.length).toBeGreaterThan(attemptsWhileOffline);
    expect(readWriteQueue('hh-1')).toEqual([]);
  });

  it('subscribes to nothing while there is nothing to sync', async () => {
    const emitOnline = installReconnect(cleanups);
    const client = queueClient(() => confirmed);

    await renderHook(() => useWriteQueue('hh-1', client));
    await act(async () => {
      emitOnline();
    });

    // An empty queue means a reconnect cannot start a write storm on the wall.
    expect(client.update).not.toHaveBeenCalled();
  });

  it('failed-replay-is-retried-not-dropped: it backs off, then flags without dropping', async () => {
    jest.useFakeTimers();
    const client = queueClient(() => refused);
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // One refusal, then it waits - it does not spin.
    expect(client.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(999);
    });
    expect(client.update).toHaveBeenCalledTimes(1);

    // Each backoff step doubles: 1s, 2s, 4s, 8s across the remaining attempts.
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(delay);
      });
    }

    expect(client.update).toHaveBeenCalledTimes(MAX_WRITE_ATTEMPTS);
    // At the cap it is flagged - and still in storage, never silently dropped.
    await waitFor(() => expect(result.current.failed).toBe(1));
    expect(result.current.pending).toBe(0);
    expect(readWriteQueue('hh-1')[0]).toMatchObject({
      attempts: MAX_WRITE_ATTEMPTS,
      status: 'failed',
    });

    // ...and nothing retries it after that, so a poison write costs nothing.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * OFFLINE_RETRY_MS);
    });
    expect(client.update).toHaveBeenCalledTimes(MAX_WRITE_ATTEMPTS);
  });

  it('re-probes on a slow heartbeat while the API is unreachable', async () => {
    // A browser can report `online` while the API is still down (and a wall tablet
    // is never reloaded by hand), so the queue does not rely on the event alone.
    jest.useFakeTimers();
    let offline = true;
    const client = queueClient(() => (offline ? unreachable : confirmed));
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(client.update).toHaveBeenCalledTimes(1);

    // Nothing happens in between - it is a heartbeat, not a loop.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(OFFLINE_RETRY_MS - 1);
    });
    expect(client.update).toHaveBeenCalledTimes(1);

    offline = false;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });

    await waitFor(() => expect(result.current.pending).toBe(0));
  });

  it('flush retries on demand, which is what an O4 retry affordance will call', async () => {
    let offline = true;
    const client = queueClient(() => (offline ? unreachable : confirmed));
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() => expect(result.current.pending).toBe(1));

    offline = false;
    await act(async () => {
      result.current.flush();
    });

    await waitFor(() => expect(result.current.entries).toEqual([]));
  });

  it('never runs two drains at once: a tap mid-sync joins the same sequence', async () => {
    // Two overlapping passes would replay the queue out of order, which is the one
    // guarantee the whole module is built on.
    let release: () => void = () => {};
    const firstSend = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const concurrent: number[] = [];
    let inFlight = 0;
    const client = queueClient(async () => {
      inFlight += 1;
      concurrent.push(inFlight);
      calls += 1;
      if (calls === 1) {
        await firstSend;
      }
      inFlight -= 1;
      return confirmed;
    });
    saveWriteQueue('hh-1', [stored('c1')]);

    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    // The mount drain is parked mid-send; a tap lands right on top of it.
    await act(async () => {
      result.current.enqueue(completion('c2'));
      release();
      await firstSend;
    });

    await waitFor(() => expect(result.current.entries).toEqual([]));
    expect(Math.max(...concurrent)).toBe(1);
    expect(calls).toBe(2);
  });

  it('stops its retry timer on unmount rather than leaking it', async () => {
    jest.useFakeTimers();
    const client = queueClient(() => refused);
    const { result, unmount } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(client.update).toHaveBeenCalledTimes(1);

    await unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * OFFLINE_RETRY_MS);
    });

    expect(client.update).toHaveBeenCalledTimes(1);
  });

  it('abandons a drain that finishes after the hook is gone', async () => {
    // The tablet navigated away mid-sync. The write was still confirmed and left
    // storage; what must not happen is a state update or a timer on a dead hook.
    let release: (value: ApiResult<unknown>) => void = () => {};
    const inFlight = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const client = queueClient(() => inFlight);
    saveWriteQueue('hh-1', [stored('c1')]);

    const { unmount } = await renderHook(() => useWriteQueue('hh-1', client));
    await unmount();

    await act(async () => {
      release(confirmed);
      await inFlight;
    });

    expect(readWriteQueue('hh-1')).toEqual([]);
  });

  it('replays through whichever client the hub currently holds', async () => {
    // The bearer flips when an organizer signs in (T4) or the hub pairs (T5); a
    // queued write must go out under the client the board is holding *now*.
    let offline = true;
    const stale = queueClient(() => unreachable);
    const fresh = queueClient(() => (offline ? unreachable : confirmed));
    const { result, rerender } = await renderHook(
      ({ client }: { client: ApiClient }) => useWriteQueue('hh-1', client),
      { initialProps: { client: stale } },
    );

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() => expect(result.current.pending).toBe(1));

    await rerender({ client: fresh });
    offline = false;
    await act(async () => {
      result.current.flush();
    });

    await waitFor(() => expect(result.current.entries).toEqual([]));
    expect(fresh.update).toHaveBeenCalledWith(completion('c1').path, { personId: 'p1' }, { method: 'POST' });
  });

  it('keeps households apart: switching household loads that household queue', async () => {
    saveWriteQueue('hh-2', [stored('c9')]);
    let offline = true;
    const client = queueClient(() => (offline ? unreachable : confirmed));

    const { result, rerender } = await renderHook(
      ({ householdId }: { householdId: string }) => useWriteQueue(householdId, client),
      { initialProps: { householdId: 'hh-1' } },
    );
    await waitFor(() => expect(result.current.entries).toEqual([]));

    await rerender({ householdId: 'hh-2' });

    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(result.current.entries[0].dedupeKey).toBe(assignmentDedupeKey(WEEK, 'c9'));
  });

  it('degrades to a session-only queue where there is no storage at all', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const client = queueClient(() => confirmed);

    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    // The tap does not throw, and nothing is persisted for it to replay later.
    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() => expect(client.update).not.toHaveBeenCalled());
    expect(result.current.entries).toEqual([]);
  });

  it('leaves nothing behind for another household under its own key', async () => {
    const client = queueClient(() => unreachable);
    const { result } = await renderHook(() => useWriteQueue('hh-1', client));

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() => expect(result.current.pending).toBe(1));

    expect(readWriteQueue('hh-2')).toEqual([]);
    expect(globalThis.localStorage.getItem(writeQueueKey('hh-1'))).not.toBeNull();
  });
});
