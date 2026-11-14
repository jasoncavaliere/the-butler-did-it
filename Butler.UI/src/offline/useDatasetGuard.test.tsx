import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import { readLastSeenDatasetId, writeLastSeenDatasetId } from './datasetGuard';
import { resetSessionFallbackStorage, type LocalStorageLike } from './storage';
import { useDatasetGuard } from './useDatasetGuard';

const okDataset = (datasetId: string): ApiResult<unknown> => ({
  ok: true,
  status: 200,
  data: { datasetId },
  etag: null,
});

const unreachable: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

/** A client whose dataset read answers whatever `answer` returns at call time. */
function datasetClient(answer: () => Promise<ApiResult<unknown>> | ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string) => {
      expect(path).toBe(DATASET_PATH);
      return answer();
    }) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function installStorage(): void {
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

let restores: (() => void)[] = [];

beforeEach(() => {
  restores = [];
  installStorage();
  resetSessionFallbackStorage();
});

afterEach(() => {
  for (const restore of restores) {
    restore();
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  resetSessionFallbackStorage();
});

describe('useDatasetGuard', () => {
  it('checks the dataset on mount and reports checking until it settles', async () => {
    const answer = deferred<ApiResult<unknown>>();
    const client = datasetClient(() => answer.promise);

    const { result } = await renderHook(() => useDatasetGuard('hh-1', client));

    expect(result.current.checking).toBe(true);
    expect(client.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve(okDataset('ds-a'));
    });

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.revision).toBe(0);
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-a');
  });

  it('settles even when the API is unreachable, without a revision', async () => {
    const client = datasetClient(() => unreachable);

    const { result } = await renderHook(() => useDatasetGuard('hh-1', client));

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.revision).toBe(0);
    expect(readLastSeenDatasetId('hh-1')).toBeNull();
  });

  it('does not fetch without a household', async () => {
    const client = datasetClient(() => okDataset('ds-a'));

    const { result } = await renderHook(() => useDatasetGuard(null, client));

    expect(result.current.checking).toBe(false);
    await expect(result.current.verify()).resolves.toBe('unverified');
    expect(client.get).not.toHaveBeenCalled();
  });

  it('bumps revision on a changed dataset', async () => {
    writeLastSeenDatasetId('hh-1', 'ds-a');
    const client = datasetClient(() => okDataset('ds-b'));

    const { result } = await renderHook(() => useDatasetGuard('hh-1', client));

    await waitFor(() => expect(result.current.revision).toBe(1));
    expect(result.current.checking).toBe(false);
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-b');
  });

  it('re-checks the dataset on every reconnect, live or degraded', async () => {
    const emitOnline = installReconnect(restores);
    let id = 'ds-a';
    const client = datasetClient(() => okDataset(id));

    const { result, unmount } = await renderHook(() => useDatasetGuard('hh-1', client));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(client.get).toHaveBeenCalledTimes(1);

    // A live hub: the same dataset, so a reconnect checks and changes nothing.
    await act(async () => {
      emitOnline();
    });
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(result.current.revision).toBe(0);
    // A reconnect re-check never puts the hub back into its startup hold.
    expect(result.current.checking).toBe(false);

    // The API was reseeded during the outage: the next reconnect sees it.
    id = 'ds-b';
    await act(async () => {
      emitOnline();
    });
    await waitFor(() => expect(result.current.revision).toBe(1));
    expect(client.get).toHaveBeenCalledTimes(3);

    await act(async () => {
      unmount();
    });
  });

  it('verify runs a check through the latest client', async () => {
    const first = datasetClient(() => okDataset('ds-a'));
    const second = datasetClient(() => okDataset('ds-b'));

    const { result, rerender } = await renderHook(
      ({ client }: { client: ApiClient }) => useDatasetGuard('hh-1', client),
      { initialProps: { client: first } },
    );
    await waitFor(() => expect(result.current.checking).toBe(false));
    const verify = result.current.verify;

    await rerender({ client: second });
    // The client is read through a ref, so `verify` is stable across it.
    expect(result.current.verify).toBe(verify);

    let check = '';
    await act(async () => {
      check = await result.current.verify();
    });
    expect(check).toBe('changed');
    expect(second.get).toHaveBeenCalledTimes(1);
    expect(result.current.revision).toBe(1);
  });

  it('checks again, and holds, when the household changes', async () => {
    const answers = [deferred<ApiResult<unknown>>(), deferred<ApiResult<unknown>>()];
    let call = 0;
    const client = datasetClient(() => answers[call++].promise);

    const { result, rerender } = await renderHook(
      ({ householdId }: { householdId: string }) => useDatasetGuard(householdId, client),
      { initialProps: { householdId: 'hh-1' } },
    );
    await act(async () => {
      answers[0].resolve(okDataset('ds-a'));
    });
    await waitFor(() => expect(result.current.checking).toBe(false));

    await rerender({ householdId: 'hh-2' });
    expect(result.current.checking).toBe(true);

    await act(async () => {
      answers[1].resolve(okDataset('ds-a'));
    });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(readLastSeenDatasetId('hh-2')).toBe('ds-a');
  });

  it('ignores a check that settles after unmount', async () => {
    writeLastSeenDatasetId('hh-1', 'ds-a');
    const answer = deferred<ApiResult<unknown>>();
    const client = datasetClient(() => answer.promise);

    const { result, unmount } = await renderHook(() => useDatasetGuard('hh-1', client));
    const before = result.current;
    await act(async () => {
      unmount();
    });

    await act(async () => {
      answer.resolve(okDataset('ds-b'));
    });

    // The check itself still ran to completion (the stores were cleared and the
    // new id stored), but nothing was set on the unmounted hook.
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-b');
    expect(result.current).toBe(before);
  });
});
