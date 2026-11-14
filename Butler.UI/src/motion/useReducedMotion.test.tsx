import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

/**
 * The RN jest preset already mocks `AccessibilityInfo` with `jest.fn`s
 * (`isReduceMotionEnabled` resolves `false`, `addEventListener` returns
 * `{ remove }`). `jest.spyOn` on an existing mock returns that same mock, and
 * `mockRestore` would wipe its implementation for every later test, so these
 * tests swap implementations and put the preset's back afterwards.
 */
const isReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as unknown as jest.Mock;
const addEventListener = AccessibilityInfo.addEventListener as unknown as jest.Mock;
const originalIsEnabled = isReduceMotionEnabled.getMockImplementation();
const originalAdd = addEventListener.getMockImplementation();

/** A platform answer the test resolves by hand. */
function pendingAnswer() {
  let resolve: (on: boolean) => void = () => {};
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  isReduceMotionEnabled.mockImplementation(() => promise);
  return { resolve: (on: boolean) => resolve(on) };
}

/** Capture the `reduceMotionChanged` listener and the subscription's `remove`. */
function captureListener() {
  const captured: { listener?: (on: boolean) => void; remove: jest.Mock } = { remove: jest.fn() };
  addEventListener.mockImplementation((event: string, listener: (on: boolean) => void) => {
    if (event === 'reduceMotionChanged') {
      captured.listener = listener;
    }
    return { remove: captured.remove };
  });
  return captured;
}

afterEach(() => {
  isReduceMotionEnabled.mockImplementation(originalIsEnabled);
  addEventListener.mockImplementation(originalAdd);
});

describe('useReducedMotion', () => {
  it('starts reduced until the platform answers, then follows a reduced answer', async () => {
    const answer = pendingAnswer();

    const { result } = await renderHook(() => useReducedMotion());

    // No animation until the platform says motion is fine.
    expect(result.current).toBe(true);

    await act(async () => {
      answer.resolve(true);
    });
    expect(result.current).toBe(true);
  });

  it('follows the platform answer when motion is allowed', async () => {
    const answer = pendingAnswer();
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    await act(async () => {
      answer.resolve(false);
    });
    expect(result.current).toBe(false);
  });

  it('follows reduceMotionChanged after the first answer', async () => {
    isReduceMotionEnabled.mockImplementation(() => Promise.resolve(false));
    const captured = captureListener();

    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    expect(addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));

    await act(async () => {
      captured.listener?.(true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      captured.listener?.(false);
    });
    expect(result.current).toBe(false);
  });

  it('ignores an answer or a change that arrives after unmount', async () => {
    const answer = pendingAnswer();
    const captured = captureListener();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result, unmount } = await renderHook(() => useReducedMotion());
    await unmount();

    await act(async () => {
      answer.resolve(false);
      captured.listener?.(false);
    });

    expect(result.current).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('removes its subscription on unmount', async () => {
    const captured = captureListener();

    const { unmount } = await renderHook(() => useReducedMotion());
    expect(captured.remove).not.toHaveBeenCalled();

    await unmount();

    expect(captured.remove).toHaveBeenCalledTimes(1);
  });

  it('tolerates addEventListener returning undefined (react-native-web without matchMedia)', async () => {
    isReduceMotionEnabled.mockImplementation(() => Promise.resolve(false));
    addEventListener.mockImplementation(() => undefined);

    const { result, unmount } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    await expect(unmount()).resolves.toBeUndefined();
  });
});
