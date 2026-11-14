import type { LocalStorageLike } from '../offline/storage';
import { clearHubPairing, HUB_PAIRING_KEY, readHubPairing, writeHubPairing } from './hubPairingStorage';

/** An in-memory stand-in for Web Storage, with the raw map exposed to assert on. */
function fakeStorage(
  seed: Record<string, string> = {},
): LocalStorageLike & { entries: Map<string, string> } {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** A store whose every operation throws (quota, private mode, a disabled store). */
const throwingStorage: LocalStorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** Install (or remove, with `undefined`) an ambient `globalThis.localStorage`. */
function setGlobalStorage(storage: LocalStorageLike | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  setGlobalStorage(undefined);
});

afterEach(() => {
  setGlobalStorage(undefined);
});

describe('hubPairingStorage (#188)', () => {
  it('round-trips a pairing through the versioned key', () => {
    const storage = fakeStorage();

    writeHubPairing({ householdId: 'hh-1', deviceToken: 'dev-1' }, storage);

    expect(JSON.parse(storage.entries.get(HUB_PAIRING_KEY) ?? '')).toEqual({
      householdId: 'hh-1',
      deviceToken: 'dev-1',
    });
    expect(readHubPairing(storage)).toEqual({ householdId: 'hh-1', deviceToken: 'dev-1' });
    expect(HUB_PAIRING_KEY).toBe('butler.hubPairing.v1');
  });

  it('writes only the two pairing fields, whatever else the input carries', () => {
    const storage = fakeStorage();
    const pairing = { householdId: 'hh-1', deviceToken: 'dev-1', organizerToken: 'secret' };

    writeHubPairing(pairing, storage);

    expect(Object.keys(JSON.parse(storage.entries.get(HUB_PAIRING_KEY) ?? '')).sort()).toEqual([
      'deviceToken',
      'householdId',
    ]);
  });

  it('uses the ambient localStorage by default', () => {
    const storage = fakeStorage();
    setGlobalStorage(storage);

    writeHubPairing({ householdId: 'hh-2', deviceToken: 'dev-2' });
    expect(readHubPairing()).toEqual({ householdId: 'hh-2', deviceToken: 'dev-2' });

    clearHubPairing();
    expect(storage.entries.has(HUB_PAIRING_KEY)).toBe(false);
    expect(readHubPairing()).toBeNull();
  });

  it('reads null when there is no record', () => {
    expect(readHubPairing(fakeStorage())).toBeNull();
  });

  it.each([
    ['unparseable JSON', '{not json'],
    ['a null record', 'null'],
    ['an array', '["hh-1","dev-1"]'],
    ['a missing device token', JSON.stringify({ householdId: 'hh-1' })],
    ['a missing household id', JSON.stringify({ deviceToken: 'dev-1' })],
    ['an empty device token', JSON.stringify({ householdId: 'hh-1', deviceToken: '' })],
    ['an empty household id', JSON.stringify({ householdId: '', deviceToken: 'dev-1' })],
    ['a non-string field', JSON.stringify({ householdId: 7, deviceToken: 'dev-1' })],
  ])('reads null for %s', (_label, raw) => {
    expect(readHubPairing(fakeStorage({ [HUB_PAIRING_KEY]: raw }))).toBeNull();
  });

  it('returns only the two pairing fields from a record carrying more', () => {
    const storage = fakeStorage({
      [HUB_PAIRING_KEY]: JSON.stringify({ householdId: 'hh-1', deviceToken: 'dev-1', extra: true }),
    });

    expect(readHubPairing(storage)).toEqual({ householdId: 'hh-1', deviceToken: 'dev-1' });
  });

  it('degrades without throwing when there is no storage', () => {
    expect(readHubPairing(undefined)).toBeNull();
    expect(() => writeHubPairing({ householdId: 'hh-1', deviceToken: 'dev-1' }, undefined)).not.toThrow();
    expect(() => clearHubPairing(undefined)).not.toThrow();
    // ...and by default, where Jest (like native) has no Web Storage.
    expect(readHubPairing()).toBeNull();
    expect(() => writeHubPairing({ householdId: 'hh-1', deviceToken: 'dev-1' })).not.toThrow();
    expect(() => clearHubPairing()).not.toThrow();
  });

  it('degrades without throwing when reading localStorage itself throws (privacy mode)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: access to localStorage is denied');
      },
      configurable: true,
    });

    expect(readHubPairing()).toBeNull();
    expect(() => writeHubPairing({ householdId: 'hh-1', deviceToken: 'dev-1' })).not.toThrow();
    expect(() => clearHubPairing()).not.toThrow();
  });

  it('degrades without throwing when getItem, setItem and removeItem throw', () => {
    expect(readHubPairing(throwingStorage)).toBeNull();
    expect(() =>
      writeHubPairing({ householdId: 'hh-1', deviceToken: 'dev-1' }, throwingStorage),
    ).not.toThrow();
    expect(() => clearHubPairing(throwingStorage)).not.toThrow();
  });

  it('clears by overwriting with null when the store has no removeItem', () => {
    const entries = new Map<string, string>([
      [HUB_PAIRING_KEY, JSON.stringify({ householdId: 'hh-1', deviceToken: 'dev-1' })],
    ]);
    const storage: LocalStorageLike = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
    };

    clearHubPairing(storage);

    expect(entries.get(HUB_PAIRING_KEY)).toBe('null');
    expect(readHubPairing(storage)).toBeNull();
  });
});
