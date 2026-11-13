import { useEffect, useState } from 'react';

import { defaultReconnectTarget, type ReconnectTarget } from './useReconnect';

/**
 * Whether the browser believes it has a network (Epic 60 O4).
 *
 * The sync indicator's connection state starts here: the browser's
 * `navigator.onLine` for the first render, then its `online` and `offline`
 * events. It is one input only - a browser can report `online` while the API is
 * still unreachable - so the indicator combines it with what the queue and the
 * hub's loads actually saw.
 *
 * Like {@link useReconnectSignal} it is feature-detected rather than
 * platform-switched: without an event target (native, Jest without a stub) it is
 * inert and reports online, and only an explicit `navigator.onLine === false`
 * starts it offline. It is never a load-effect dependency - it decides what the
 * indicator says, not when anything refetches.
 */

/** The browser's starting answer: offline only when it says so outright. */
export function initialBrowserOnline(): boolean {
  try {
    const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
    return nav?.onLine !== false;
  } catch {
    return true;
  }
}

/** Track the browser's online/offline events, starting from `navigator.onLine`. */
export function useBrowserOnline(
  target: ReconnectTarget | undefined = defaultReconnectTarget(),
): boolean {
  const [online, setOnline] = useState(initialBrowserOnline);

  useEffect(() => {
    if (!target) {
      return undefined;
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    // Unsubscribe through the same remover that existed when we subscribed: the
    // ambient target's methods can be swapped out underneath a long-lived hub
    // (a test stub restored first, a polyfill), and cleanup must not throw then.
    const remove = target.removeEventListener.bind(target);
    target.addEventListener('online', onOnline);
    target.addEventListener('offline', onOffline);
    return () => {
      remove('online', onOnline);
      remove('offline', onOffline);
    };
  }, [target]);

  return online;
}
