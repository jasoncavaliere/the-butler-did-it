import { useEffect } from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

import { autoRetryDelayMs } from './autoRetry';
import { useAutoRetrySignal } from './useAutoRetrySignal';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe('useAutoRetrySignal', () => {
  it('stays at zero and arms nothing while not failing', async () => {
    const { result } = await renderHook(() => useAutoRetrySignal(false));

    await advance(10 * 60_000);

    expect(result.current).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bumps on the backoff schedule while failing (AC4)', async () => {
    const { result } = await renderHook(() => useAutoRetrySignal(true));

    await advance(autoRetryDelayMs(0) - 1);
    expect(result.current).toBe(0);
    await advance(1);
    expect(result.current).toBe(1);

    await advance(autoRetryDelayMs(1) - 1);
    expect(result.current).toBe(1);
    await advance(1);
    expect(result.current).toBe(2);

    await advance(autoRetryDelayMs(2));
    expect(result.current).toBe(3);
  });

  it('settles at the cap: one bump a minute once the delays stop growing (AC4)', async () => {
    const { result } = await renderHook(() => useAutoRetrySignal(true));

    // 2 + 4 + 8 + 16 + 32 seconds, then the cap. One step per act, so each
    // bump re-renders and arms the next timer.
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000]) {
      await advance(delay);
    }
    expect(result.current).toBe(5);

    await advance(59_999);
    expect(result.current).toBe(5);
    await advance(1);
    expect(result.current).toBe(6);
    await advance(60_000);
    expect(result.current).toBe(7);
  });

  it('stops when the read recovers and starts over from the first step next time', async () => {
    const { result, rerender } = await renderHook(({ failing }: { failing: boolean }) => useAutoRetrySignal(failing), {
      initialProps: { failing: true },
    });
    await advance(2_000);
    await advance(4_000);
    expect(result.current).toBe(2);

    await rerender({ failing: false });
    await advance(10 * 60_000);
    // Never reset: a decrease would be a dependency change and an extra read.
    expect(result.current).toBe(2);

    await rerender({ failing: true });
    await advance(1_999);
    expect(result.current).toBe(2);
    await advance(1);
    expect(result.current).toBe(3);
  });

  it('clears its timer on unmount', async () => {
    const onRetry = jest.fn();
    function Probe() {
      const signal = useAutoRetrySignal(true);
      useEffect(() => {
        if (signal > 0) {
          onRetry();
        }
      }, [signal]);
      return null;
    }
    const clear = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await render(<Probe />);

    await act(async () => {
      unmount();
    });
    await advance(10 * 60_000);

    expect(clear).toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    clear.mockRestore();
  });

  it('uses an injected schedule', async () => {
    const delayFor = jest.fn(() => 100);
    const { result } = await renderHook(() => useAutoRetrySignal(true, delayFor));

    await advance(100);
    await advance(100);
    await advance(100);

    expect(result.current).toBe(3);
    expect(delayFor).toHaveBeenNthCalledWith(1, 0);
    expect(delayFor).toHaveBeenNthCalledWith(2, 1);
    expect(delayFor).toHaveBeenNthCalledWith(3, 2);
  });
});
