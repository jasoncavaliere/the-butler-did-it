/**
 * Service worker registration (O1 - PWA installability).
 *
 * The hub is installed on the family tablet as a PWA, and a browser only offers the install
 * prompt once it has a manifest, a registered service worker, and an https (or localhost) origin.
 * The manifest ships from `public/manifest.json`; this module is the registration half.
 *
 * It is deliberately feature-detected rather than platform-switched: on iOS/Android (and in Jest)
 * there is no `navigator.serviceWorker`, so this is a no-op there without a `Platform.OS` branch.
 * Registration failures - an http origin, a blocked worker, a browser that refuses the scope - are
 * swallowed: an uninstallable hub is a degraded hub, never a broken one.
 */

/** Where the worker is served from. `public/sw.js` is copied to `dist/sw.js` by the export. */
export const SERVICE_WORKER_URL = '/sw.js';

export type ServiceWorkerOutcome = 'registered' | 'unsupported' | 'failed';

type ServiceWorkerRegistrar = {
  register: (url: string) => Promise<unknown>;
};

function getServiceWorkerContainer(): ServiceWorkerRegistrar | undefined {
  const container = globalThis.navigator?.serviceWorker as ServiceWorkerRegistrar | undefined;
  return typeof container?.register === 'function' ? container : undefined;
}

/**
 * Register the app-shell service worker. Always resolves - never rejects and never throws - so a
 * caller can fire it and forget it.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerOutcome> {
  const container = getServiceWorkerContainer();
  if (!container) return 'unsupported';

  try {
    await container.register(SERVICE_WORKER_URL);
    return 'registered';
  } catch {
    return 'failed';
  }
}
