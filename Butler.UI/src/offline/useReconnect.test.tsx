import { act, renderHook } from '@testing-library/react-native';

import { defaultReconnectTarget, useReconnectSignal } from './useReconnect';

/**
 * A stand-in for the browser's event target, with the registered `online`
 * listeners exposed so a test can fire a reconnect and count subscriptions.
 */
function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: jest.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: jest.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    /** How many listeners are currently registered for `online`. */
    count: () => listeners.get('online')?.size ?? 0,
    /** Fire a reconnect at every current listener. */
    emit: () => {
      for (const listener of Array.from(listeners.get('online') ?? [])) {
        listener();
      }
    },
  };
}

/** Install (or remove, with `undefined`) an ambient global property. */
function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

describe('useReconnectSignal', () => {
  it('starts at zero and subscribes to the reconnect event while enabled', async () => {
    const target = fakeTarget();

    const { result } = await renderHook(() => useReconnectSignal(true, target));

    expect(result.current).toBe(0);
    expect(target.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(target.count()).toBe(1);
  });

  it('bumps once per reconnect, so a load effect listing it refetches each time', async () => {
    const target = fakeTarget();
    const { result } = await renderHook(() => useReconnectSignal(true, target));

    await act(async () => {
      target.emit();
    });
    expect(result.current).toBe(1);

    await act(async () => {
      target.emit();
    });
    expect(result.current).toBe(2);
  });

  it('subscribes to nothing while disabled: a healthy hub listens for nothing', async () => {
    const target = fakeTarget();

    const { result } = await renderHook(() => useReconnectSignal(false, target));

    expect(target.addEventListener).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });

  it('unsubscribes when the surface stops being degraded, and holds its count', async () => {
    const target = fakeTarget();
    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useReconnectSignal(enabled, target),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      target.emit();
    });
    expect(result.current).toBe(1);

    // The load succeeded, so the caller disables the signal: the listener goes...
    await rerender({ enabled: false });
    expect(target.count()).toBe(0);
    // ...and a reconnect while healthy changes nothing.
    await act(async () => {
      target.emit();
    });
    expect(result.current).toBe(1);

    // Going degraded again re-subscribes, so the next reconnect refetches.
    await rerender({ enabled: true });
    expect(target.count()).toBe(1);
    await act(async () => {
      target.emit();
    });
    expect(result.current).toBe(2);
  });

  it('unsubscribes on unmount', async () => {
    const target = fakeTarget();
    const { unmount } = await renderHook(() => useReconnectSignal(true, target));

    expect(target.count()).toBe(1);

    await unmount();

    expect(target.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(target.count()).toBe(0);
  });

  it('is inert with no event target at all (native, or a stripped environment)', async () => {
    const { result } = await renderHook(() => useReconnectSignal(true, undefined));

    expect(result.current).toBe(0);
  });

  it('is inert by default where the environment exposes no event target', async () => {
    // The ambient default is looked up per render; this environment has none, so
    // the hook must be a no-op rather than throwing on the missing API.
    const { result } = await renderHook(() => useReconnectSignal(true));

    expect(result.current).toBe(0);
  });
});

describe('defaultReconnectTarget', () => {
  const original = {
    add: (globalThis as { addEventListener?: unknown }).addEventListener,
    remove: (globalThis as { removeEventListener?: unknown }).removeEventListener,
  };

  afterEach(() => {
    setGlobal('addEventListener', original.add);
    setGlobal('removeEventListener', original.remove);
  });

  it('finds an ambient event target when the environment has one (the browser)', () => {
    setGlobal('addEventListener', jest.fn());
    setGlobal('removeEventListener', jest.fn());

    expect(defaultReconnectTarget()).toBe(globalThis);
  });

  it('is undefined where there is no event target', () => {
    setGlobal('addEventListener', undefined);
    setGlobal('removeEventListener', undefined);

    expect(defaultReconnectTarget()).toBeUndefined();
  });

  it('is undefined when only half the event-target API is present', () => {
    setGlobal('addEventListener', jest.fn());
    setGlobal('removeEventListener', undefined);

    expect(defaultReconnectTarget()).toBeUndefined();
  });

  it('is undefined when probing for the API throws, rather than letting it escape', () => {
    // A locked-down environment can make the property access itself throw; the
    // reconnect signal degrades to "never fires" instead of breaking the render.
    Object.defineProperty(globalThis, 'addEventListener', {
      get() {
        throw new Error('SecurityError');
      },
      configurable: true,
    });

    expect(defaultReconnectTarget()).toBeUndefined();
  });
});
