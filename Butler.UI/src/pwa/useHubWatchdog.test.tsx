import { act, renderHook } from '@testing-library/react-native';

import { restoreNavigator, setNavigator } from './fakeServiceWorker.testing';
import { WATCHDOG_RELOAD_AFTER_MS, defaultReload, useHubWatchdog } from './useHubWatchdog';

type Conditions = { inError: boolean; online: boolean; queueEmpty: boolean };

const ARMED: Conditions = { inError: true, online: true, queueEmpty: true };

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function renderWatchdog(initial: Conditions, reload: () => void) {
  return renderHook(({ conditions }: { conditions: Conditions }) => useHubWatchdog(conditions, { reload }), {
    initialProps: { conditions: initial },
  });
}

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  restoreNavigator();
  if (originalLocation) {
    Object.defineProperty(globalThis, 'location', originalLocation);
  } else {
    Reflect.deleteProperty(globalThis, 'location');
  }
});

describe('useHubWatchdog', () => {
  it('waits five minutes', () => {
    expect(WATCHDOG_RELOAD_AFTER_MS).toBe(5 * 60_000);
  });

  it('reloads once after 5 minutes in error while online with an empty queue (AC6)', async () => {
    const reload = jest.fn();
    await renderWatchdog(ARMED, reload);

    await advance(WATCHDOG_RELOAD_AFTER_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await advance(1);
    expect(reload).toHaveBeenCalledTimes(1);

    await advance(60 * 60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads while a write is queued (AC7)', async () => {
    const reload = jest.fn();
    await renderWatchdog({ ...ARMED, queueEmpty: false }, reload);

    await advance(60 * 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while offline', async () => {
    const reload = jest.fn();
    await renderWatchdog({ ...ARMED, online: false }, reload);

    await advance(60 * 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when not in error', async () => {
    const reload = jest.fn();
    await renderWatchdog({ ...ARMED, inError: false }, reload);

    await advance(60 * 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when recovered before 5 minutes, and counts again from zero', async () => {
    const reload = jest.fn();
    const { rerender } = await renderWatchdog(ARMED, reload);

    await advance(4 * 60_000);
    await rerender({ conditions: { ...ARMED, inError: false } });
    await advance(60 * 60_000);
    expect(reload).not.toHaveBeenCalled();

    // A fresh error needs five continuous minutes of its own.
    await rerender({ conditions: ARMED });
    await advance(WATCHDOG_RELOAD_AFTER_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await advance(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a write queued mid-wait cancels the reload (AC7)', async () => {
    const reload = jest.fn();
    const { rerender } = await renderWatchdog(ARMED, reload);

    await advance(4 * 60_000);
    await rerender({ conditions: { ...ARMED, queueEmpty: false } });
    await advance(60 * 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('offline at fire time: does not reload', async () => {
    const reload = jest.fn();
    await renderWatchdog(ARMED, reload);
    setNavigator({ onLine: false });

    await advance(WATCHDOG_RELOAD_AFTER_MS);

    expect(reload).not.toHaveBeenCalled();
  });

  it('a new reload identity does not restart the wait, and the newest one is called', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(({ reload }: { reload: () => void }) => useHubWatchdog(ARMED, { reload }), {
      initialProps: { reload: first },
    });

    await advance(4 * 60_000);
    await rerender({ reload: second });
    await advance(60_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('honours an injected threshold', async () => {
    const reload = jest.fn();
    await renderHook(() => useHubWatchdog(ARMED, { reload, thresholdMs: 1_000 }));

    await advance(1_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clears its timer on unmount', async () => {
    const reload = jest.fn();
    const { unmount } = await renderWatchdog(ARMED, reload);

    await act(async () => unmount());
    await advance(60 * 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads through location.reload by default', async () => {
    const reload = jest.fn();
    Object.defineProperty(globalThis, 'location', { value: { reload }, configurable: true, writable: true });
    await renderHook(() => useHubWatchdog(ARMED));

    await advance(WATCHDOG_RELOAD_AFTER_MS);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('defaultReload', () => {
  it('calls location.reload', () => {
    const reload = jest.fn();
    Object.defineProperty(globalThis, 'location', { value: { reload }, configurable: true, writable: true });

    defaultReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a location or a reload (native)', () => {
    Object.defineProperty(globalThis, 'location', { value: undefined, configurable: true, writable: true });
    expect(() => defaultReload()).not.toThrow();

    Object.defineProperty(globalThis, 'location', { value: {}, configurable: true, writable: true });
    expect(() => defaultReload()).not.toThrow();
  });

  it('never throws when the reload does', () => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        reload: () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
      writable: true,
    });

    expect(() => defaultReload()).not.toThrow();
  });
});
