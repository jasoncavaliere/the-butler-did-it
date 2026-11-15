import {
  FakeContainer,
  FakeRegistration,
  FakeWorker,
  flushPromises,
  memoryStorage,
  restoreNavigator,
  setNavigator,
} from './fakeServiceWorker.testing';
import {
  SKIP_WAITING_MESSAGE,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_NOTICE_KEY,
  applyWaitingWorker,
  clearUpdateNotice,
  defaultSessionStorage,
  getUpdateContainer,
  readUpdateNotice,
  resetServiceWorkerUpdateForTests,
  watchForWaitingWorker,
} from './serviceWorkerUpdate';

const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

beforeEach(() => {
  // Fake timers throughout, so a watcher's check interval never keeps Jest alive.
  jest.useFakeTimers();
  resetServiceWorkerUpdateForTests();
});

afterEach(() => {
  jest.useRealTimers();
  restoreNavigator();
  restoreGlobal('sessionStorage', originalSessionStorage);
  restoreGlobal('location', originalLocation);
});

describe('SKIP_WAITING_MESSAGE', () => {
  it('is the literal { type: SKIP_WAITING } the worker listens for (public/sw.js)', () => {
    expect(SKIP_WAITING_MESSAGE).toEqual({ type: 'SKIP_WAITING' });
  });
});

describe('getUpdateContainer', () => {
  it('returns the browser service worker container', () => {
    const container = new FakeContainer();
    setNavigator({ serviceWorker: container });
    expect(getUpdateContainer()).toBe(container);
  });

  it('is undefined without a navigator, a container, or a usable container', () => {
    setNavigator(undefined);
    expect(getUpdateContainer()).toBeUndefined();
    setNavigator({});
    expect(getUpdateContainer()).toBeUndefined();
    setNavigator({ serviceWorker: { ready: Promise.resolve({}) } });
    expect(getUpdateContainer()).toBeUndefined();
    setNavigator({ serviceWorker: { addEventListener: () => {} } });
    expect(getUpdateContainer()).toBeUndefined();
  });

  it('is undefined when probing the container throws', () => {
    setNavigator(
      Object.defineProperty({}, 'serviceWorker', {
        get() {
          throw new Error('SecurityError');
        },
      }),
    );
    expect(getUpdateContainer()).toBeUndefined();
  });
});

describe('watchForWaitingWorker', () => {
  it('reports a worker that installs while an older one controls the page (AC2)', async () => {
    const container = new FakeContainer();
    const onWaiting = jest.fn();
    watchForWaitingWorker(container, onWaiting);
    await flushPromises();

    const worker = container.registration.findUpdate() as FakeWorker;
    worker.moveTo('installing');
    expect(onWaiting).not.toHaveBeenCalled();
    worker.moveTo('installed');

    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(onWaiting).toHaveBeenCalledWith(worker);
  });

  it('reports a worker already waiting when it attaches (AC2)', async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const onWaiting = jest.fn();

    watchForWaitingWorker(new FakeContainer(registration), onWaiting);
    await flushPromises();

    expect(onWaiting).toHaveBeenCalledWith(registration.waiting);
  });

  it('reports nothing for a first install, when no worker controls the page (AC5)', async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const container = new FakeContainer(registration, null);
    const onWaiting = jest.fn();

    watchForWaitingWorker(container, onWaiting);
    await flushPromises();
    (registration.findUpdate() as FakeWorker).moveTo('installed');

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('ignores an updatefound with no installing worker', async () => {
    const container = new FakeContainer();
    const onWaiting = jest.fn();
    watchForWaitingWorker(container, onWaiting);
    await flushPromises();

    container.registration.findUpdate(null);

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('polls registration.update() on the interval and swallows a rejected check', async () => {
    const container = new FakeContainer();
    container.registration.update.mockRejectedValue(new Error('offline'));
    watchForWaitingWorker(container, jest.fn(), 1_000);
    await flushPromises();

    expect(container.registration.update).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    await flushPromises();
    jest.advanceTimersByTime(1_000);
    await flushPromises();

    expect(container.registration.update).toHaveBeenCalledTimes(2);
  });

  it('swallows an update() that throws synchronously', async () => {
    const container = new FakeContainer();
    container.registration.update.mockImplementation(() => {
      throw new Error('InvalidStateError');
    });
    watchForWaitingWorker(container, jest.fn(), 1_000);
    await flushPromises();

    jest.advanceTimersByTime(1_000);
    await flushPromises();

    expect(container.registration.update).toHaveBeenCalledTimes(1);
  });

  it('checks every UPDATE_CHECK_INTERVAL_MS by default', async () => {
    const container = new FakeContainer();
    watchForWaitingWorker(container, jest.fn());
    await flushPromises();

    jest.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
    await flushPromises();
    expect(container.registration.update).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(container.registration.update).toHaveBeenCalledTimes(1);
  });

  it('swallows a ready that rejects', async () => {
    const container = new FakeContainer();
    container.ready = Promise.reject(new Error('no worker'));
    const onWaiting = jest.fn();

    const dispose = watchForWaitingWorker(container, onWaiting);
    await flushPromises();
    dispose();

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('dispose removes its listeners and stops polling', async () => {
    const container = new FakeContainer();
    const onWaiting = jest.fn();
    const dispose = watchForWaitingWorker(container, onWaiting, 1_000);
    await flushPromises();
    const worker = container.registration.findUpdate() as FakeWorker;
    expect(container.registration.listenerCount('updatefound')).toBe(1);
    expect(worker.listenerCount('statechange')).toBe(1);

    dispose();
    worker.moveTo('installed');
    jest.advanceTimersByTime(5_000);
    await flushPromises();

    expect(container.registration.listenerCount('updatefound')).toBe(0);
    expect(worker.listenerCount('statechange')).toBe(0);
    expect(container.registration.update).not.toHaveBeenCalled();
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('a dispose before ready resolves never attaches', async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const container = new FakeContainer(registration);
    const onWaiting = jest.fn();

    watchForWaitingWorker(container, onWaiting)();
    await flushPromises();

    expect(onWaiting).not.toHaveBeenCalled();
    expect(registration.listenerCount('updatefound')).toBe(0);
  });
});

describe('applyWaitingWorker', () => {
  it('posts SKIP_WAITING, then reloads exactly once when the new worker takes control (AC3)', () => {
    const container = new FakeContainer();
    const worker = new FakeWorker('installed');
    const reload = jest.fn();
    const storage = memoryStorage();

    applyWaitingWorker(worker, container, reload, storage);

    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    expect(reload).not.toHaveBeenCalled();

    container.dispatch('controllerchange');
    container.dispatch('controllerchange');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.entries.get(UPDATE_NOTICE_KEY)).toBe('1');
  });

  it('listens for controllerchange before it posts, so a fast handover is not missed', () => {
    const container = new FakeContainer();
    const worker = new FakeWorker('installed');
    const reload = jest.fn();
    worker.postMessage.mockImplementation(() => container.dispatch('controllerchange'));

    applyWaitingWorker(worker, container, reload, memoryStorage());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('posts only once even when applied twice', () => {
    const container = new FakeContainer();
    const worker = new FakeWorker('installed');
    const reload = jest.fn();

    applyWaitingWorker(worker, container, reload, memoryStorage());
    applyWaitingWorker(worker, container, reload, memoryStorage());
    applyWaitingWorker(new FakeWorker('installed'), new FakeContainer(), reload, memoryStorage());

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(container.listenerCount('controllerchange')).toBe(1);
  });

  it('a first-install controllerchange never reloads (AC5)', () => {
    const container = new FakeContainer(new FakeRegistration(), null);
    const reload = jest.fn();
    // Nothing applied: the page never asked for a handover.
    container.dispatch('controllerchange');
    expect(reload).not.toHaveBeenCalled();
    expect(container.listenerCount('controllerchange')).toBe(0);
  });

  it('still reloads when the notice marker cannot be written, or there is no storage', () => {
    const container = new FakeContainer();
    const reload = jest.fn();
    const storage = memoryStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    applyWaitingWorker(new FakeWorker('installed'), container, reload, storage);
    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);

    resetServiceWorkerUpdateForTests();
    const second = new FakeContainer();
    applyWaitingWorker(new FakeWorker('installed'), second, reload, undefined);
    second.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('defaults to location.reload and session storage', () => {
    const reload = jest.fn();
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'location', { value: { reload }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });
    const container = new FakeContainer();

    applyWaitingWorker(new FakeWorker('installed'), container);
    container.dispatch('controllerchange');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.entries.get(UPDATE_NOTICE_KEY)).toBe('1');
  });

  it('the default reload is a no-op where there is no location', () => {
    Object.defineProperty(globalThis, 'location', { value: undefined, configurable: true, writable: true });
    const container = new FakeContainer();

    applyWaitingWorker(new FakeWorker('installed'), container, undefined, memoryStorage());

    expect(() => container.dispatch('controllerchange')).not.toThrow();
  });
});

describe('defaultSessionStorage', () => {
  it('returns usable session storage', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });
    expect(defaultSessionStorage()).toBe(storage);
  });

  it('is undefined when there is none, it is unusable, or probing it throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true, writable: true });
    expect(defaultSessionStorage()).toBeUndefined();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: { getItem: () => null },
      configurable: true,
      writable: true,
    });
    expect(defaultSessionStorage()).toBeUndefined();
    Object.defineProperty(globalThis, 'sessionStorage', {
      get() {
        throw new Error('SecurityError');
      },
      configurable: true,
    });
    expect(defaultSessionStorage()).toBeUndefined();
  });
});

describe('the update notice marker', () => {
  it('reads true only when the marker is set, and clears it', () => {
    const storage = memoryStorage();
    expect(readUpdateNotice(storage)).toBe(false);

    storage.entries.set(UPDATE_NOTICE_KEY, '1');
    expect(readUpdateNotice(storage)).toBe(true);
    // A read is pure: the marker is still there.
    expect(readUpdateNotice(storage)).toBe(true);

    clearUpdateNotice(storage);
    expect(storage.removeItem).toHaveBeenCalledWith(UPDATE_NOTICE_KEY);
    expect(readUpdateNotice(storage)).toBe(false);
  });

  it('degrades to "no notice" without storage, or when storage throws', () => {
    expect(readUpdateNotice(undefined)).toBe(false);
    expect(() => clearUpdateNotice(undefined)).not.toThrow();

    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    storage.removeItem.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readUpdateNotice(storage)).toBe(false);
    expect(() => clearUpdateNotice(storage)).not.toThrow();

    // A store without removeItem is left alone.
    expect(() => clearUpdateNotice({ getItem: () => '1', setItem: () => {} })).not.toThrow();
  });

  it('defaults to session storage', () => {
    const storage = memoryStorage();
    storage.entries.set(UPDATE_NOTICE_KEY, '1');
    Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });

    expect(readUpdateNotice()).toBe(true);
    clearUpdateNotice();
    expect(readUpdateNotice()).toBe(false);
  });
});
