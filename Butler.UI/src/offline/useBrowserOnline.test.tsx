import { act, renderHook } from '@testing-library/react-native';

import { initialBrowserOnline, useBrowserOnline } from './useBrowserOnline';

/** A stand-in browser event target that records `online` and `offline` listeners. */
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
    count: (type: string) => listeners.get(type)?.size ?? 0,
    emit: (type: string) => {
      for (const listener of Array.from(listeners.get(type) ?? [])) {
        listener();
      }
    },
  };
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

describe('initialBrowserOnline', () => {
  it('is offline only when the browser says so outright', () => {
    setNavigator({ onLine: false });
    expect(initialBrowserOnline()).toBe(false);

    setNavigator({ onLine: true });
    expect(initialBrowserOnline()).toBe(true);
  });

  it('reads as online where there is no answer (no navigator, no onLine)', () => {
    setNavigator(undefined);
    expect(initialBrowserOnline()).toBe(true);

    setNavigator({});
    expect(initialBrowserOnline()).toBe(true);
  });

  it('reads as online when asking throws', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(initialBrowserOnline()).toBe(true);
  });
});

describe('useBrowserOnline', () => {
  it('starts from navigator.onLine', async () => {
    setNavigator({ onLine: false });
    const { result } = await renderHook(() => useBrowserOnline(fakeTarget()));
    expect(result.current).toBe(false);
  });

  it('follows the online and offline events', async () => {
    setNavigator({ onLine: true });
    const target = fakeTarget();
    const { result } = await renderHook(() => useBrowserOnline(target));
    expect(result.current).toBe(true);

    await act(async () => {
      target.emit('offline');
    });
    expect(result.current).toBe(false);

    await act(async () => {
      target.emit('online');
    });
    expect(result.current).toBe(true);
  });

  it('unsubscribes from both events on unmount', async () => {
    const target = fakeTarget();
    const { unmount } = await renderHook(() => useBrowserOnline(target));
    expect(target.count('online')).toBe(1);
    expect(target.count('offline')).toBe(1);

    await unmount();

    expect(target.count('online')).toBe(0);
    expect(target.count('offline')).toBe(0);
  });

  it('is inert without an event target and reads as online', async () => {
    const { result } = await renderHook(() => useBrowserOnline(undefined));
    expect(result.current).toBe(true);
  });
});
