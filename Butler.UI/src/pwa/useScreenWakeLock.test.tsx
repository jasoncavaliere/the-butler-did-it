import { act, renderHook } from '@testing-library/react-native';

import { flushPromises, restoreNavigator, setNavigator } from './fakeServiceWorker.testing';
import { useScreenWakeLock } from './useScreenWakeLock';
import type { WakeLockLike, WakeLockSentinelLike } from './wakeLock';

/** A sentinel whose `release()` marks it released, like the browser's. */
function fakeSentinel(): WakeLockSentinelLike & { released: boolean; release: jest.Mock } {
  const sentinel = {
    released: false,
    release: jest.fn(async () => {
      sentinel.released = true;
    }),
  };
  return sentinel;
}

/** A wake lock that hands out a fresh sentinel per request, all kept for inspection. */
function fakeWakeLock() {
  const sentinels: ReturnType<typeof fakeSentinel>[] = [];
  const wakeLock = {
    request: jest.fn(async (): Promise<WakeLockSentinelLike> => {
      const sentinel = fakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    }),
  };
  return { wakeLock, sentinels };
}

/** A document stand-in whose visibility a test can flip, firing `visibilitychange`. */
function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: jest.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.add(listener);
    }),
    removeEventListener: jest.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.delete(listener);
    }),
    count: () => listeners.size,
    show(state: 'visible' | 'hidden') {
      doc.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
  };
  return doc;
}

async function settle() {
  await act(async () => {
    await flushPromises();
  });
}

afterEach(() => {
  restoreNavigator();
});

describe('useScreenWakeLock', () => {
  it('requests a screen wake lock on mount (AC1)', async () => {
    const { wakeLock, sentinels } = fakeWakeLock();
    const target = fakeDocument();

    await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
    expect(sentinels[0].release).not.toHaveBeenCalled();
    expect(target.count()).toBe(1);
  });

  it('reads navigator.wakeLock by default', async () => {
    const { wakeLock } = fakeWakeLock();
    setNavigator({ wakeLock });

    await renderHook(() => useScreenWakeLock());
    await settle();

    expect(wakeLock.request).toHaveBeenCalledWith('screen');
  });

  it('re-requests the wake lock when the page becomes visible again (AC2)', async () => {
    const { wakeLock, sentinels } = fakeWakeLock();
    const target = fakeDocument();
    await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();

    // Hidden: the browser drops the lock by itself; the hub asks for nothing.
    sentinels[0].released = true;
    await act(async () => target.show('hidden'));
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    await act(async () => target.show('visible'));
    await settle();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    // The dropped lock is not released twice.
    expect(sentinels[0].release).not.toHaveBeenCalled();
  });

  it('keeps only the newest lock: a previous one still held is released', async () => {
    const { wakeLock, sentinels } = fakeWakeLock();
    const target = fakeDocument();
    await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();

    await act(async () => target.show('visible'));
    await settle();

    expect(sentinels).toHaveLength(2);
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(sentinels[1].release).not.toHaveBeenCalled();
  });

  it('releases the held lock and stops listening on unmount', async () => {
    const { wakeLock, sentinels } = fakeWakeLock();
    const target = fakeDocument();
    const { unmount } = await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();

    await act(async () => unmount());

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(target.count()).toBe(0);
  });

  it('releases a lock that arrives after unmount', async () => {
    const sentinel = fakeSentinel();
    let grant: (value: WakeLockSentinelLike) => void = () => undefined;
    const wakeLock: WakeLockLike = {
      request: jest.fn(
        () =>
          new Promise<WakeLockSentinelLike>((resolve) => {
            grant = resolve;
          }),
      ),
    };
    const { unmount } = await renderHook(() => useScreenWakeLock({ wakeLock, target: fakeDocument() }));

    await act(async () => unmount());
    grant(sentinel);
    await settle();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('asks once on mount and listens for nothing without a document', async () => {
    const { wakeLock } = fakeWakeLock();

    const { unmount } = await renderHook(() => useScreenWakeLock({ wakeLock }));
    await settle();
    await act(async () => unmount());

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('unsupported: requests nothing, listens for nothing, and does not throw (AC3)', async () => {
    setNavigator({});
    const target = fakeDocument();

    const { unmount } = await renderHook(() => useScreenWakeLock({ target }));
    await settle();
    await act(async () => target.show('visible'));

    expect(target.addEventListener).not.toHaveBeenCalled();
    await act(async () => unmount());
  });

  it('a refused request does not throw or log, and a later return to visible asks again (AC3)', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wakeLock: WakeLockLike = {
      request: jest.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };
    const target = fakeDocument();

    const { unmount } = await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();
    await act(async () => target.show('visible'));
    await settle();
    await act(async () => unmount());

    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it('swallows a release that rejects or throws', async () => {
    const rejecting = {
      release: jest.fn(async () => {
        throw new Error('already gone');
      }),
    };
    const throwing = {
      release: jest.fn(() => {
        throw new Error('already gone');
      }),
    } as unknown as WakeLockSentinelLike;
    const queue: WakeLockSentinelLike[] = [rejecting, throwing];
    const wakeLock: WakeLockLike = { request: jest.fn(async () => queue.shift() as WakeLockSentinelLike) };
    const target = fakeDocument();

    const { unmount } = await renderHook(() => useScreenWakeLock({ wakeLock, target }));
    await settle();
    // The second lock replaces the first, whose release rejects.
    await act(async () => target.show('visible'));
    await settle();
    // Unmount releases the second, whose release throws.
    await act(async () => unmount());
    await settle();

    expect(rejecting.release).toHaveBeenCalledTimes(1);
    expect(throwing.release).toHaveBeenCalledTimes(1);
  });
});
