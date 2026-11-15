import { restoreNavigator, setNavigator } from './fakeServiceWorker.testing';
import { getWakeLock, requestScreenWakeLock, type WakeLockLike } from './wakeLock';

afterEach(() => {
  restoreNavigator();
});

describe('getWakeLock', () => {
  it('returns navigator.wakeLock when it can request', () => {
    const wakeLock = { request: jest.fn() };
    setNavigator({ wakeLock });

    expect(getWakeLock()).toBe(wakeLock);
  });

  it('is undefined without a wake lock (native, Jest, older browsers)', () => {
    setNavigator({});
    expect(getWakeLock()).toBeUndefined();

    setNavigator(undefined);
    expect(getWakeLock()).toBeUndefined();
  });

  it('is undefined when the wake lock has no request function', () => {
    setNavigator({ wakeLock: { request: 'nope' } });

    expect(getWakeLock()).toBeUndefined();
  });

  it('is undefined when reading navigator throws', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    expect(getWakeLock()).toBeUndefined();
  });
});

describe('requestScreenWakeLock', () => {
  it('acquires a screen lock and hands back the sentinel (AC1)', async () => {
    const sentinel = { released: false, release: jest.fn(async () => undefined) };
    const wakeLock: WakeLockLike = { request: jest.fn(async () => sentinel) };

    await expect(requestScreenWakeLock(wakeLock)).resolves.toEqual({ outcome: 'acquired', sentinel });
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
  });

  it('reports unsupported without a wake lock (AC3)', async () => {
    setNavigator({});

    await expect(requestScreenWakeLock()).resolves.toEqual({ outcome: 'unsupported' });
  });

  it('reads the ambient wake lock by default', async () => {
    const sentinel = { release: jest.fn(async () => undefined) };
    const request = jest.fn(async () => sentinel);
    setNavigator({ wakeLock: { request } });

    await expect(requestScreenWakeLock()).resolves.toEqual({ outcome: 'acquired', sentinel });
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('never rejects: a refused request is failed (AC3)', async () => {
    const wakeLock: WakeLockLike = {
      request: jest.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    };

    await expect(requestScreenWakeLock(wakeLock)).resolves.toEqual({ outcome: 'failed' });
  });

  it('never throws: a request that throws synchronously is failed (AC3)', async () => {
    const wakeLock = {
      request: jest.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as WakeLockLike;

    await expect(requestScreenWakeLock(wakeLock)).resolves.toEqual({ outcome: 'failed' });
  });
});
