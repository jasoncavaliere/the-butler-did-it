import { useEffect, useRef } from 'react';

import { initialBrowserOnline } from '../offline/useBrowserOnline';

/**
 * The hub's last-resort watchdog (#109).
 *
 * The automatic retry (`useAutoRetrySignal`) and the reconnect signal bring a
 * hub back from an outage the page can recover from. Some it cannot: a wedged
 * page, a leaked socket, a bad state no reload of the reads will clear. On a
 * tablet nobody reloads by hand, the page itself has to.
 *
 * So once the hub has been in an error state for {@link WATCHDOG_RELOAD_AFTER_MS}
 * without a break, while the browser reports a network and no write is waiting
 * to sync, the watchdog reloads the page once. Any of the three dropping clears
 * the timer, so the five minutes must be continuous. Offline it never reloads -
 * a reload with no network would only land on the service worker's shell - and
 * with a write queued it never reloads at all, however long the error lasts, so
 * a reload can never cost a tap that has not synced. The network is checked
 * again at fire time, since the live online signal can lag an `offline` event.
 *
 * Off web there is no `location.reload`, so the reload is a no-op there.
 * `options` lets a test inject the reload and the threshold.
 */

/** How long the hub must stay in error (online, queue empty) before a reload. */
export const WATCHDOG_RELOAD_AFTER_MS = 5 * 60_000;

/** Reload the page, where there is one; never throws. */
export function defaultReload(): void {
  try {
    (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
  } catch {
    // No reload to make (native) or one the page refused: stay up.
  }
}

export function useHubWatchdog(
  conditions: { inError: boolean; online: boolean; queueEmpty: boolean },
  options: { reload?: () => void; thresholdMs?: number } = {},
): void {
  const { inError, online, queueEmpty } = conditions;
  const { reload = defaultReload, thresholdMs = WATCHDOG_RELOAD_AFTER_MS } = options;

  // Held in a ref so a new reload identity does not restart the five minutes.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const armed = inError && online && queueEmpty;

  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (initialBrowserOnline()) {
        reloadRef.current();
      }
    }, thresholdMs);
    return () => clearTimeout(timer);
  }, [armed, thresholdMs]);
}
