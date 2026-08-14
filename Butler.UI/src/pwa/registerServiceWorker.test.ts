import { registerServiceWorker, SERVICE_WORKER_URL } from './registerServiceWorker';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

describe('registerServiceWorker', () => {
  it('registers the app-shell worker on a browser that supports it', async () => {
    const register = jest.fn(async () => ({ scope: '/' }));
    setNavigator({ serviceWorker: { register } });

    await expect(registerServiceWorker()).resolves.toBe('registered');
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
  });

  it('is a no-op where the browser has no service worker support', async () => {
    setNavigator({});

    await expect(registerServiceWorker()).resolves.toBe('unsupported');
  });

  it('is a no-op off web, where there is no navigator at all', async () => {
    setNavigator(undefined);

    await expect(registerServiceWorker()).resolves.toBe('unsupported');
  });

  it('is a no-op when the container exposes no register function', async () => {
    setNavigator({ serviceWorker: {} });

    await expect(registerServiceWorker()).resolves.toBe('unsupported');
  });

  it('degrades gracefully when the browser refuses the registration', async () => {
    // An http origin, a blocked worker, or a scope the browser rejects - the hub still runs.
    const register = jest.fn(async () => {
      throw new Error('SecurityError: an SSL certificate error occurred');
    });
    setNavigator({ serviceWorker: { register } });

    await expect(registerServiceWorker()).resolves.toBe('failed');
  });
});
