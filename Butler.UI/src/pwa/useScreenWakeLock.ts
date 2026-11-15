import { useEffect, useState } from 'react';

import { defaultVisibilityTarget, type VisibilityTarget } from '../offline/visibilityTarget';
import {
  getWakeLock,
  requestScreenWakeLock,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from './wakeLock';

/**
 * Keeps the hub tablet's screen on (#109).
 *
 * Asks for a screen wake lock when the hub mounts, and again each time the page
 * becomes visible: the browser drops the lock whenever the page is hidden (a tab
 * switch, the screen turned off by hand), and does not give it back by itself.
 * Only the newest lock is kept; an older one still held is released, and so is
 * the one held when the hub unmounts - including a lock that arrives after it.
 *
 * Feature-detected like `useHubGlance`: without `navigator.wakeLock`
 * (native, older browsers, Jest) it does nothing, and without a document it
 * asks once on mount and listens for nothing. A refused request is silent - no
 * log, no UI. `options` lets a test inject the wake lock and the document.
 */
export function useScreenWakeLock(
  options: { wakeLock?: WakeLockLike; target?: VisibilityTarget } = {},
): void {
  const [wakeLock] = useState(() => options.wakeLock ?? getWakeLock());
  const target = options.target ?? defaultVisibilityTarget();

  useEffect(() => {
    if (!wakeLock) {
      return undefined;
    }
    let disposed = false;
    let held: WakeLockSentinelLike | null = null;

    const acquire = () => {
      void requestScreenWakeLock(wakeLock).then((result) => {
        if (result.outcome !== 'acquired') {
          return;
        }
        if (disposed) {
          releaseQuietly(result.sentinel);
          return;
        }
        const previous = held;
        held = result.sentinel;
        if (previous !== null) {
          releaseQuietly(previous);
        }
      });
    };

    acquire();
    const onVisibilityChange = () => {
      if (target?.visibilityState === 'visible') {
        acquire();
      }
    };
    target?.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      target?.removeEventListener('visibilitychange', onVisibilityChange);
      if (held !== null) {
        releaseQuietly(held);
        held = null;
      }
    };
  }, [wakeLock, target]);
}

/** Release `sentinel` unless the browser already did; never throws or rejects. */
function releaseQuietly(sentinel: WakeLockSentinelLike): void {
  if (sentinel.released === true) {
    return;
  }
  try {
    Promise.resolve(sentinel.release()).catch(() => undefined);
  } catch {
    // A sentinel that throws on release is already gone; nothing to do.
  }
}
