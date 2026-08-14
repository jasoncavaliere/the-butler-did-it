import { useEffect } from 'react';

import { registerServiceWorker } from './registerServiceWorker';

/**
 * Registers the app-shell service worker once, when the app mounts (O1).
 *
 * `App.tsx` calls this so registration happens from the exported app itself rather than from a
 * script in the HTML template - which keeps it unit-testable and keeps the template to markup.
 * By the time React mounts, the bundle has already loaded, so this does not compete with the
 * first paint for bandwidth. Off web (and in Jest) `registerServiceWorker` is a no-op, and it
 * never rejects, so nothing here can break a mount.
 */
export function useServiceWorkerRegistration(): void {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
}
