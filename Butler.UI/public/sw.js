/**
 * Butler hub service worker (O1 - PWA app shell).
 *
 * Ships from `public/`, which `expo export --platform web` copies verbatim into `dist/`, so a
 * plain export already emits `/sw.js` next to `/manifest.json`
 * (https://docs.expo.dev/guides/progressive-web-apps/).
 *
 * Scope of this worker is deliberately narrow: **static app-shell assets only**. It precaches the
 * exported HTML/JS/CSS/icon bundle so a second load of the hub succeeds with the network disabled.
 * It never caches API responses (that is O2 - offline data cache) and never queues writes (O3);
 * non-GET and cross-origin requests fall straight through to the network.
 *
 * Freshness: the precache block below is rewritten at build time by `scripts/pwa-export.js` with
 * the exporter's own content-hashed filenames plus a build id, so every deploy opens a new cache
 * and `activate` deletes the superseded one. Navigations are network-first, so a deployed HTML
 * change is picked up on the next online load and can never be pinned by this cache.
 */

/* butler-precache:begin */
const PRECACHE = { "version": "dev", "urls": ["/", "/index.html", "/manifest.json"] };
/* butler-precache:end */

const CACHE_PREFIX = 'butler-app-shell-';
const CACHE_NAME = CACHE_PREFIX + PRECACHE.version;

/** The two keys the shell HTML is cached under: the site root and the exported document. */
const APP_SHELL_URL = '/index.html';
const ROOT_URL = '/';

/** Same-origin paths that hold static, content-addressed export output. */
const STATIC_PATH_PREFIXES = ['/_expo/', '/assets/', '/icons/'];

/** Request destinations that are always static app-shell assets, never data. */
const STATIC_DESTINATIONS = ['script', 'style', 'font', 'image', 'manifest', 'worker'];

function isStaticAssetRequest(request, url) {
  if (PRECACHE.urls.includes(url.pathname)) return true;
  if (STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  return STATIC_DESTINATIONS.includes(request.destination);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE.urls);
      // A newly deployed shell should take over rather than wait for every tab to close; the
      // family tablet runs one long-lived tab that would otherwise never hand over.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/** Network-first: keeps a deploy from being pinned, but still renders offline from the precache. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Refresh both shell keys rather than the navigated route, so the offline copy stays
      // current without the cache growing a new entry for every path the family visits.
      await cache.put(APP_SHELL_URL, response.clone());
      await cache.put(ROOT_URL, response.clone());
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(APP_SHELL_URL));
    if (cached) return cached;
    throw new Error('Butler is offline and the app shell is not cached yet.');
  }
}

/** Cache-first: export filenames are content-hashed, so a cache hit is always the right bytes. */
async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type !== 'opaque') {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Writes are never served or queued here - that is the O3 write queue.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The API lives on its own origin; caching it is O2, not this ticket.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(handleStaticAsset(request));
  }
});
