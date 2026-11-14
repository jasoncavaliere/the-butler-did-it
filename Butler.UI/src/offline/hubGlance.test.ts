import type { ApiClient, ApiResult } from '../api/client';
import {
  GLANCE_INTERVAL_MS,
  HUB_GLANCED_EVENT,
  hubGlanceWrite,
  hubGlancedKey,
  isGlanceDue,
  readLastGlanceMs,
  reportHubGlance,
  writeLastGlanceMs,
} from './hubGlance';
import { resetSessionFallbackStorage, type LocalStorageLike } from './storage';

const noContent: ApiResult<unknown> = { ok: true, status: 204, data: undefined, etag: null };
const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'Network request failed' },
};
const refused: ApiResult<never> = {
  ok: false,
  error: { kind: 'problem', status: 401, title: 'Unauthorized' },
};

function fakeStorage(seed: Record<string, string> = {}): LocalStorageLike {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function fakeClient(answer: ApiResult<unknown> = noContent) {
  const update = jest.fn(async () => answer);
  const client: ApiClient = {
    baseUrl: 'http://api.test',
    get: jest.fn() as unknown as ApiClient['get'],
    update: update as unknown as ApiClient['update'],
  };
  return { client, update };
}

beforeEach(() => resetSessionFallbackStorage());
afterEach(() => resetSessionFallbackStorage());

describe('isGlanceDue', () => {
  it('is due when this device has never reported one', () => {
    expect(isGlanceDue(null, 0)).toBe(true);
  });

  it('is not due one millisecond inside the 10-minute window', () => {
    expect(isGlanceDue(1_000, 1_000 + GLANCE_INTERVAL_MS - 1)).toBe(false);
  });

  it('is due again at exactly 10 minutes', () => {
    expect(GLANCE_INTERVAL_MS).toBe(600_000);
    expect(isGlanceDue(1_000, 1_000 + GLANCE_INTERVAL_MS)).toBe(true);
  });
});

describe('the debounce stamp', () => {
  it('round-trips per household, under its own key (not the O2 glance cache)', () => {
    const storage = fakeStorage();
    writeLastGlanceMs('hh-1', 42, storage);

    expect(hubGlancedKey('hh-1')).toBe('butler.hubglanced.v1.hh-1');
    expect(readLastGlanceMs('hh-1', storage)).toBe(42);
    expect(readLastGlanceMs('hh-2', storage)).toBeNull();
  });

  it('reads garbage as never reported', () => {
    expect(readLastGlanceMs('hh-1', fakeStorage({ [hubGlancedKey('hh-1')]: 'soon' }))).toBeNull();
  });

  it('degrades to "never reported" when the store throws', () => {
    const broken: LocalStorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(() => writeLastGlanceMs('hh-1', 1, broken)).not.toThrow();
    expect(readLastGlanceMs('hh-1', broken)).toBeNull();
  });

  it('defaults to the session fallback store', () => {
    writeLastGlanceMs('hh-1', 7);
    expect(readLastGlanceMs('hh-1')).toBe(7);
  });
});

describe('hubGlanceWrite', () => {
  it('is a POST of hub-glanced to the household events route', () => {
    expect(HUB_GLANCED_EVENT).toBe('hub-glanced');
    expect(hubGlanceWrite('hh-1', 1_234)).toEqual({
      kind: 'hub-glance',
      dedupeKey: 'hub-glance|1234',
      method: 'POST',
      path: '/households/hh-1/events',
      body: { type: 'hub-glanced' },
    });
  });
});

describe('reportHubGlance', () => {
  it('posts directly when due and online, without touching the queue', async () => {
    const storage = fakeStorage();
    const { client, update } = fakeClient();
    const enqueue = jest.fn();

    expect(await reportHubGlance('hh-1', client, enqueue, 5_000, storage)).toBe('posted');

    expect(update).toHaveBeenCalledWith('/households/hh-1/events', { type: 'hub-glanced' }, { method: 'POST' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(readLastGlanceMs('hh-1', storage)).toBe(5_000);
  });

  it('skips within 10 minutes and posts again at 10', async () => {
    const storage = fakeStorage();
    const { client, update } = fakeClient();
    const enqueue = jest.fn();

    await reportHubGlance('hh-1', client, enqueue, 0, storage);
    expect(await reportHubGlance('hh-1', client, enqueue, GLANCE_INTERVAL_MS - 1, storage)).toBe('skipped');
    expect(update).toHaveBeenCalledTimes(1);

    expect(await reportHubGlance('hh-1', client, enqueue, GLANCE_INTERVAL_MS, storage)).toBe('posted');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('keeps the stamp per household', async () => {
    const storage = fakeStorage();
    const { client, update } = fakeClient();

    await reportHubGlance('hh-1', client, jest.fn(), 0, storage);
    expect(await reportHubGlance('hh-2', client, jest.fn(), 1, storage)).toBe('posted');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('a network failure enqueues a hub-glance write', async () => {
    const storage = fakeStorage();
    const { client } = fakeClient(unreachable);
    const enqueue = jest.fn();

    expect(await reportHubGlance('hh-1', client, enqueue, 9_000, storage)).toBe('queued');

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'hub-glance',
      dedupeKey: 'hub-glance|9000',
      method: 'POST',
      path: '/households/hh-1/events',
      body: { type: 'hub-glanced' },
    });
  });

  it('a refusal is dropped, not queued, and still stamps so the API is not hammered', async () => {
    const storage = fakeStorage();
    const { client, update } = fakeClient(refused);
    const enqueue = jest.fn();

    expect(await reportHubGlance('hh-1', client, enqueue, 0, storage)).toBe('dropped');
    expect(enqueue).not.toHaveBeenCalled();

    expect(await reportHubGlance('hh-1', client, enqueue, 1, storage)).toBe('skipped');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real clock and the session fallback store', async () => {
    const { client } = fakeClient();

    expect(await reportHubGlance('hh-1', client, jest.fn())).toBe('posted');
    expect(await reportHubGlance('hh-1', client, jest.fn())).toBe('skipped');
  });
});
