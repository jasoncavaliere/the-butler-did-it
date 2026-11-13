import { act, renderHook } from '@testing-library/react-native';

import { useCurrentWeekIso } from './useCurrentWeek';

/**
 * The hook is the render-time half of the week guard (#89): it is what turns a
 * wall hub's rows read-only at the boundary without anyone touching it. The clock
 * is pinned to one minute before the 2026-W29 -> 2026-W30 boundary (Sunday
 * 2026-07-19 23:59 UTC), so every case is about that instant.
 */
describe('useCurrentWeekIso', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-19T23:59:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts at the week the hub is in', async () => {
    const { result } = await renderHook(() => useCurrentWeekIso());

    expect(result.current.currentWeek).toBe('2026-W29');
  });

  it('turns over at the boundary by itself, and keeps doing so week after week', async () => {
    const { result } = await renderHook(() => useCurrentWeekIso());

    // Just short of the boundary: nothing yet.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(59_999);
    });
    expect(result.current.currentWeek).toBe('2026-W29');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2);
    });
    expect(result.current.currentWeek).toBe('2026-W30');

    // The timer was re-armed for the following boundary, not spent.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(7 * 86_400_000);
    });
    expect(result.current.currentWeek).toBe('2026-W31');
  });

  it('re-arms even when the timer fires early and the week has not changed', async () => {
    // An early fire re-reads the same week, so React skips that update; the
    // timer must still be re-armed or the boundary would never be noticed.
    const { result } = await renderHook(() => useCurrentWeekIso());

    // Hold the clock back by a second while the boundary timer fires, so the
    // fire happens "early" relative to the clock.
    await act(async () => {
      jest.setSystemTime(new Date('2026-07-19T23:58:59.000Z'));
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.currentWeek).toBe('2026-W29');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.currentWeek).toBe('2026-W30');
  });

  it('recheck catches up at once when the clock moved but the timer has not fired', async () => {
    // A sleeping tablet can fire its timer late; the board calls recheck when a
    // tap finds the week has turned.
    const { result } = await renderHook(() => useCurrentWeekIso());

    jest.setSystemTime(new Date('2026-07-20T00:00:30.000Z'));
    expect(result.current.currentWeek).toBe('2026-W29');

    await act(async () => {
      result.current.recheck();
    });
    expect(result.current.currentWeek).toBe('2026-W30');
  });

  it('leaves no timer behind when it unmounts', async () => {
    // React schedules timers of its own, so the boundary timer is picked out by
    // its delay - one minute, from the pinned clock - rather than by a count.
    const setSpy = jest.spyOn(globalThis, 'setTimeout');
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await renderHook(() => useCurrentWeekIso());
    const armed = setSpy.mock.results[
      setSpy.mock.calls.findIndex(([, delay]) => delay === 60_000)
    ]?.value as ReturnType<typeof setTimeout>;
    expect(armed).toBeDefined();
    expect(clearSpy).not.toHaveBeenCalledWith(armed);

    await act(async () => {
      unmount();
    });

    expect(clearSpy).toHaveBeenCalledWith(armed);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
