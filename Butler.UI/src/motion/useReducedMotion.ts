import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the platform asks for reduced motion (prefers-reduced-motion).
 *
 * ADR-0006 gates every transition on this setting, and the chore celebration
 * (#119) is the first animation that reads it. It starts `true`, so nothing
 * animates until the platform has answered, then follows
 * `AccessibilityInfo.isReduceMotionEnabled()` and the `reduceMotionChanged`
 * event. On web, react-native-web answers both from
 * `matchMedia('(prefers-reduced-motion: reduce)')`; there,
 * `addEventListener` returns `undefined` when `matchMedia` is missing, so the
 * subscription is optional.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (active) {
        setReduced(on);
      }
    });
    const subscription: { remove: () => void } | undefined = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (on) => {
        if (active) {
          setReduced(on);
        }
      },
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}
