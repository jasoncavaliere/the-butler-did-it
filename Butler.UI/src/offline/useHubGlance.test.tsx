import { act, renderHook } from '@testing-library/react-native';

import type { ApiClient, ApiResult } from '../api/client';
import { GLANCE_INTERVAL_MS } from './hubGlance';
import { resetSessionFallbackStorage } from './storage';
import { defaultVisibilityTarget, useHubGlance, type VisibilityTarget } from './useHubGlance';

const noContent: ApiResult<unknown> = { ok: true, status: 204, data: undefined, etag: null };

/** A stand-in for `document`, with its visibility listeners exposed. */
function fakeDocument(state = 'visible') {
  const listeners = new Set<() => void>();
  const target = {
    visibilityState: state,
    addEventListener: jest.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: jest.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  return {
    target: target as VisibilityTarget,
    count: () => listeners.size,
    show: (next: string) => {
      target.visibilityState = next;
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },
  };
}

function fakeClient() {
  const update = jest.fn(async () => noContent);
  const client: ApiClient = {
    baseUrl: 'http://api.test',
    get: jest.fn() as unknown as ApiClient['get'],
    update: update as unknown as ApiClient['update'],
  };
  return { client, update };
}

/** Install (or remove, with `undefined`) an ambient global property. */
function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

let now = 1_000_000;

beforeEach(() => {
  resetSessionFallbackStorage();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetSessionFallbackStorage();
  setGlobal('document', undefined);
});

describe('useHubGlance', () => {
  it('posts once on mount', async () => {
    const doc = fakeDocument();
    const { client, update } = fakeClient();

    await renderHook(() => useHubGlance('hh-1', client, jest.fn(), doc.target));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('/households/hh-1/events', { type: 'hub-glanced' }, { method: 'POST' });
    expect(doc.target.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('posts again on visibilitychange to visible after 10 minutes', async () => {
    const doc = fakeDocument();
    const { client, update } = fakeClient();
    await renderHook(() => useHubGlance('hh-1', client, jest.fn(), doc.target));

    now += GLANCE_INTERVAL_MS;
    await act(async () => {
      doc.show('visible');
    });

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not post again inside 10 minutes', async () => {
    const doc = fakeDocument();
    const { client, update } = fakeClient();
    await renderHook(() => useHubGlance('hh-1', client, jest.fn(), doc.target));

    now += GLANCE_INTERVAL_MS - 1;
    await act(async () => {
      doc.show('visible');
    });

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('ignores the page being hidden', async () => {
    const doc = fakeDocument();
    const { client, update } = fakeClient();
    await renderHook(() => useHubGlance('hh-1', client, jest.fn(), doc.target));

    now += GLANCE_INTERVAL_MS;
    await act(async () => {
      doc.show('hidden');
    });

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reports through the latest client and enqueue, without re-reporting on a new identity', async () => {
    const doc = fakeDocument();
    const first = fakeClient();
    const second = fakeClient();
    const { rerender } = await renderHook(
      ({ client }: { client: ApiClient }) => useHubGlance('hh-1', client, jest.fn(), doc.target),
      { initialProps: { client: first.client } },
    );

    await rerender({ client: second.client });
    expect(second.update).not.toHaveBeenCalled();

    now += GLANCE_INTERVAL_MS;
    await act(async () => {
      doc.show('visible');
    });
    expect(first.update).toHaveBeenCalledTimes(1);
    expect(second.update).toHaveBeenCalledTimes(1);
  });

  it('hands an offline glance to the latest enqueue', async () => {
    const doc = fakeDocument();
    const update = jest.fn(
      async (): Promise<ApiResult<unknown>> => ({
        ok: false,
        error: { kind: 'network', status: 0, title: 'Network request failed' },
      }),
    );
    const client: ApiClient = {
      baseUrl: 'http://api.test',
      get: jest.fn() as unknown as ApiClient['get'],
      update: update as unknown as ApiClient['update'],
    };
    const enqueue = jest.fn();

    await renderHook(() => useHubGlance('hh-1', client, enqueue, doc.target));

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hub-glance' }));
  });

  it('removes its listener on unmount', async () => {
    const doc = fakeDocument();
    const { client } = fakeClient();
    const { unmount } = await renderHook(() => useHubGlance('hh-1', client, jest.fn(), doc.target));
    expect(doc.count()).toBe(1);

    await act(async () => {
      unmount();
    });

    expect(doc.count()).toBe(0);
  });

  it('still reports on mount, but listens for nothing, without a document', async () => {
    const { client, update } = fakeClient();

    await renderHook(() => useHubGlance('hh-1', client, jest.fn(), undefined));

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('uses the ambient document by default', async () => {
    const doc = fakeDocument();
    setGlobal('document', doc.target);
    const { client } = fakeClient();

    await renderHook(() => useHubGlance('hh-1', client, jest.fn()));

    expect(doc.count()).toBe(1);
  });
});

describe('defaultVisibilityTarget', () => {
  it('is undefined where there is no document', () => {
    setGlobal('document', undefined);
    expect(defaultVisibilityTarget()).toBeUndefined();
  });

  it('is undefined for a document without the event API', () => {
    setGlobal('document', { visibilityState: 'visible' });
    expect(defaultVisibilityTarget()).toBeUndefined();
  });

  it('is the ambient document when it has one', () => {
    const doc = fakeDocument();
    setGlobal('document', doc.target);
    expect(defaultVisibilityTarget()).toBe(doc.target);
  });

  it('is undefined when probing the document throws', () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(defaultVisibilityTarget()).toBeUndefined();
  });
});
