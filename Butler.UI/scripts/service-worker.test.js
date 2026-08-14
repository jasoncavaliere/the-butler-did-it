/**
 * Behavioural tests for the shipped service worker (`public/sw.js`, O1).
 *
 * The worker cannot be imported like app code - it runs in a worker scope against the Cache
 * Storage API - so it is evaluated here in a Node VM against a fake `self` / `caches` / `fetch`
 * and driven through the real lifecycle: install, activate, then fetches with the network up and
 * with the network cut. That is what "a second load of the hub succeeds with the network
 * disabled" means, asserted without a browser.
 *
 * It lives under `scripts/` rather than beside the worker because everything in `public/` is
 * copied verbatim into `dist/` by the export - a test file there would ship to production.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGIN = 'https://hub.example';
const SERVICE_WORKER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'sw.js'),
  'utf8'
);

const absolute = (url) => new URL(url, ORIGIN).href;

/** A Response stand-in: only the bits the worker touches. */
function makeResponse(body, { ok = true, type = 'basic' } = {}) {
  const response = { body, ok, type, clone: () => response };
  return response;
}

function makeRequest(url, { method = 'GET', mode = 'no-cors', destination = '' } = {}) {
  return { url: absolute(url), method, mode, destination };
}

const navigationRequest = (url) => makeRequest(url, { mode: 'navigate', destination: 'document' });

class FakeCache {
  constructor(fetchImpl) {
    this.entries = new Map();
    this.fetchImpl = fetchImpl;
  }

  static keyFor(request) {
    return absolute(typeof request === 'string' ? request : request.url);
  }

  async addAll(urls) {
    for (const url of urls) {
      const response = await this.fetchImpl(makeRequest(url));
      if (!response || !response.ok) throw new Error(`precache failed for ${url}`);
      this.entries.set(FakeCache.keyFor(url), response);
    }
  }

  async put(request, response) {
    this.entries.set(FakeCache.keyFor(request), response);
  }

  async match(request) {
    return this.entries.get(FakeCache.keyFor(request));
  }
}

/**
 * Boots the worker: evaluates `public/sw.js` in a VM and returns handles for driving it.
 * `network` is swapped per-test to simulate a working connection or a dead one.
 */
function bootServiceWorker({ seedCaches = {} } = {}) {
  const listeners = new Map();
  const store = new Map();
  let network = async (request) => makeResponse(`served:${FakeCache.keyFor(request)}`);

  const caches = {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new FakeCache((request) => network(request)));
      return store.get(name);
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
  for (const [name, urls] of Object.entries(seedCaches)) {
    const cache = new FakeCache(() => makeResponse('stale'));
    for (const url of urls) cache.entries.set(FakeCache.keyFor(url), makeResponse('stale'));
    store.set(name, cache);
  }

  const self = {
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    location: { origin: ORIGIN },
    skipWaiting: jest.fn(async () => {}),
    clients: { claim: jest.fn(async () => {}) },
  };

  vm.runInNewContext(SERVICE_WORKER_SOURCE, {
    self,
    caches,
    fetch: (request) => network(request),
    URL,
    Promise,
    Error,
    console,
  });

  async function dispatchLifecycle(type) {
    const pending = [];
    const event = { waitUntil: (promise) => pending.push(promise) };
    for (const handler of listeners.get(type) ?? []) handler(event);
    await Promise.all(pending);
  }

  async function dispatchFetch(request) {
    const event = { request, responded: false, respondWith: null };
    let responsePromise;
    event.respondWith = (promise) => {
      event.responded = true;
      responsePromise = promise;
    };
    for (const handler of listeners.get('fetch') ?? []) handler(event);
    return { handled: event.responded, response: responsePromise && (await responsePromise) };
  }

  return {
    self,
    store,
    install: () => dispatchLifecycle('install'),
    activate: () => dispatchLifecycle('activate'),
    fetch: dispatchFetch,
    fetchRejects: async (request) => {
      const event = { request, respondWith: (promise) => (event.promise = promise) };
      for (const handler of listeners.get('fetch') ?? []) handler(event);
      return event.promise;
    },
    goOffline: () => {
      network = async () => {
        throw new TypeError('Failed to fetch');
      };
    },
    setNetwork: (impl) => {
      network = impl;
    },
    currentCache: () => [...store.values()][0],
  };
}

describe('the app-shell service worker', () => {
  it('precaches the app shell on install and takes over immediately', async () => {
    const worker = bootServiceWorker();

    await worker.install();

    const cached = [...worker.currentCache().entries.keys()];
    expect(cached).toContain(absolute('/'));
    expect(cached).toContain(absolute('/index.html'));
    expect(cached).toContain(absolute('/manifest.json'));
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  it('serves a second load from cache with the network disabled', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    await worker.activate();

    worker.goOffline();
    const { handled, response } = await worker.fetch(navigationRequest('/'));

    // The network is dead, so anything returned at all came out of the install-time precache.
    expect(handled).toBe(true);
    expect(response.body).toBe(`served:${ORIGIN}/`);
  });

  it('falls back to the cached app shell for a route it never cached', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    worker.goOffline();

    const { response } = await worker.fetch(navigationRequest('/settings'));

    expect(response.body).toBe(`served:${ORIGIN}/index.html`);
  });

  it('serves precached static assets offline without touching the network', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    const bundle = makeRequest('/_expo/static/js/web/index-abc.js', { destination: 'script' });
    await worker.fetch(bundle); // first load: fetched and cached at runtime
    worker.goOffline();

    const { handled, response } = await worker.fetch(bundle);

    expect(handled).toBe(true);
    expect(response.body).toBe(`served:${ORIGIN}/_expo/static/js/web/index-abc.js`);
  });

  it('refreshes the cached shell from the network while it is up', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    worker.setNetwork(async () => makeResponse('freshly-deployed-html'));

    const online = await worker.fetch(navigationRequest('/'));
    expect(online.response.body).toBe('freshly-deployed-html');

    worker.goOffline();
    const offline = await worker.fetch(navigationRequest('/'));
    expect(offline.response.body).toBe('freshly-deployed-html');
  });

  it('surfaces a real failure when offline with nothing cached at all', async () => {
    const worker = bootServiceWorker();
    worker.goOffline();

    await expect(worker.fetchRejects(navigationRequest('/'))).rejects.toThrow(/offline/i);
  });

  it('does not cache a response the server refused', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    worker.setNetwork(async () => makeResponse('not-found', { ok: false }));

    await worker.fetch(makeRequest('/icons/icon-192.png', { destination: 'image' }));

    expect(worker.currentCache().entries.has(absolute('/icons/icon-192.png'))).toBe(false);
  });

  it('does not cache an opaque cross-origin-embedded response', async () => {
    const worker = bootServiceWorker();
    await worker.install();
    worker.setNetwork(async () => makeResponse('opaque-bytes', { type: 'opaque' }));

    await worker.fetch(makeRequest('/assets/font.woff2', { destination: 'font' }));

    expect(worker.currentCache().entries.has(absolute('/assets/font.woff2'))).toBe(false);
  });

  it('leaves writes, API reads, and other origins to the network', async () => {
    const worker = bootServiceWorker();
    await worker.install();

    const write = await worker.fetch(makeRequest('/index.html', { method: 'POST' }));
    const api = await worker.fetch({ url: 'https://api.butler.example/households', method: 'GET', mode: 'cors', destination: '' });
    const data = await worker.fetch(makeRequest('/households/hh-1/people', { mode: 'cors' }));

    // Untouched by the worker: the O2 data cache and the O3 write queue own these.
    expect(write.handled).toBe(false);
    expect(api.handled).toBe(false);
    expect(data.handled).toBe(false);
  });

  it('evicts a previous deploy cache on activate and claims open tabs', async () => {
    const worker = bootServiceWorker({
      seedCaches: { 'butler-app-shell-old': ['/index.html'], 'unrelated-cache': ['/keep'] },
    });
    await worker.install();

    await worker.activate();

    const names = [...worker.store.keys()];
    expect(names).not.toContain('butler-app-shell-old');
    expect(names).toContain('unrelated-cache');
    expect(names.some((name) => name.startsWith('butler-app-shell-'))).toBe(true);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });
});
