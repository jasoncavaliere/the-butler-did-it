import { useEffect, useRef } from 'react';

import type { ApiClient } from '../api/client';
import { reportHubGlance } from './hubGlance';
import { defaultVisibilityTarget, type VisibilityTarget } from './visibilityTarget';
import type { WriteRequest } from './writeQueue';

/**
 * Reports a hub glance (#122) when the hub mounts and whenever the page becomes
 * visible again. The 10-minute debounce lives in {@link reportHubGlance}, so this
 * hook only decides *when to ask*.
 *
 * Feature-detected like `useReconnect`: without a document (native, or Jest
 * without a stub) it still reports on mount but listens for nothing.
 */

// Re-exported: the visibility seam started here, and the wake lock (#109) shares it.
export { defaultVisibilityTarget, type VisibilityTarget };

/** Report a glance on mount and on each return to visibility. */
export function useHubGlance(
  householdId: string,
  client: ApiClient,
  enqueue: (request: WriteRequest) => void,
  target: VisibilityTarget | undefined = defaultVisibilityTarget(),
): void {
  // Held in refs so a new client or enqueue identity does not re-report.
  const clientRef = useRef(client);
  const enqueueRef = useRef(enqueue);
  useEffect(() => {
    clientRef.current = client;
    enqueueRef.current = enqueue;
  }, [client, enqueue]);

  useEffect(() => {
    const report = () => {
      void reportHubGlance(householdId, clientRef.current, (request) => enqueueRef.current(request));
    };
    report();
    if (!target) {
      return undefined;
    }
    const onVisibilityChange = () => {
      if (target.visibilityState === 'visible') {
        report();
      }
    };
    target.addEventListener('visibilitychange', onVisibilityChange);
    return () => target.removeEventListener('visibilitychange', onVisibilityChange);
  }, [householdId, target]);
}
