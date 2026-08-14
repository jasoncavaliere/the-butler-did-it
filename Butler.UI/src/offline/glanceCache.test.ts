import {
  GLANCE_CACHE_PREFIX,
  defaultGlanceStorage,
  describeLastKnown,
  glanceCacheKey,
  readGlance,
  writeGlance,
  type GlanceStorage,
} from './glanceCache';
import type { RosterEntryResponse } from '../api/models';

const people: RosterEntryResponse[] = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
];

const board = {
  weekIso: '2026-W29',
  items: [
    {
      choreId: 'c1',
      title: 'Dishes',
      cadence: 'Daily',
      assignedPersonId: 'p1',
      status: 'Open' as const,
    },
  ],
};

/** An in-memory stand-in for Web Storage, with the raw map exposed to assert on. */
function fakeStorage(seed: Record<string, string> = {}): GlanceStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** Install (or remove, with `undefined`) an ambient `globalThis.localStorage`. */
function setGlobalStorage(storage: GlanceStorage | object | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  // Native (and Jest) have no Web Storage; tests that want one install it.
  setGlobalStorage(undefined);
});

afterEach(() => {
  setGlobalStorage(undefined);
});

describe('glanceCacheKey', () => {
  it('scopes the record by household id', () => {
    expect(glanceCacheKey('hh-1')).toBe(`${GLANCE_CACHE_PREFIX}hh-1`);
    expect(glanceCacheKey('hh-2')).not.toBe(glanceCacheKey('hh-1'));
  });
});

describe('writeGlance / readGlance', () => {
  it('cache-write-on-successful-load: stores the glance with a freshness stamp', () => {
    const storage = fakeStorage();

    const written = writeGlance('hh-1', { household: { name: 'Home', people } }, storage, '2026-07-20T09:00:00.000Z');

    expect(written).toEqual({
      householdId: 'hh-1',
      household: { name: 'Home', people },
      board: null,
      cachedAtIso: '2026-07-20T09:00:00.000Z',
    });
    expect(storage.entries.has(glanceCacheKey('hh-1'))).toBe(true);
    expect(readGlance('hh-1', storage)).toEqual(written);
  });

  it('merges the two halves so the shell and the board never erase each other', () => {
    const storage = fakeStorage();

    writeGlance('hh-1', { household: { name: 'Home', people } }, storage, '2026-07-20T09:00:00.000Z');
    writeGlance('hh-1', { board }, storage, '2026-07-20T09:05:00.000Z');

    expect(readGlance('hh-1', storage)).toEqual({
      householdId: 'hh-1',
      household: { name: 'Home', people },
      board,
      cachedAtIso: '2026-07-20T09:05:00.000Z',
    });
  });

  it('cache-refresh-on-reconnect: re-stamps and replaces the refreshed half only', () => {
    const storage = fakeStorage();
    writeGlance('hh-1', { household: { name: 'Home', people } }, storage, '2026-07-20T09:00:00.000Z');
    writeGlance('hh-1', { board }, storage, '2026-07-20T09:05:00.000Z');

    writeGlance('hh-1', { household: { name: 'Renamed', people: [] } }, storage, '2026-07-20T10:00:00.000Z');

    expect(readGlance('hh-1', storage)).toEqual({
      householdId: 'hh-1',
      household: { name: 'Renamed', people: [] },
      // Untouched by this write, so the last-known board survives the refresh.
      board,
      cachedAtIso: '2026-07-20T10:00:00.000Z',
    });
  });

  it('stamps the write with the current time when no clock is supplied', () => {
    const storage = fakeStorage();
    const before = Date.now();

    const written = writeGlance('hh-1', { board }, storage);

    expect(Date.parse(written?.cachedAtIso ?? '')).toBeGreaterThanOrEqual(before);
  });

  it('keeps households apart: each writes and reads its own record', () => {
    const storage = fakeStorage();

    writeGlance('hh-1', { household: { name: 'Home', people } }, storage, '2026-07-20T09:00:00.000Z');
    writeGlance('hh-2', { household: { name: 'Lake House', people: [] } }, storage, '2026-07-20T09:00:00.000Z');

    expect(readGlance('hh-1', storage)?.household?.name).toBe('Home');
    expect(readGlance('hh-2', storage)?.household?.name).toBe('Lake House');
  });

  it('never displays another household: a mismatched record reads as no cache', () => {
    // A record for hh-2 parked under hh-1's key (a stale/renamed household).
    const storage = fakeStorage({
      [glanceCacheKey('hh-1')]: JSON.stringify({
        householdId: 'hh-2',
        household: { name: 'Lake House', people: [] },
        board,
        cachedAtIso: '2026-07-20T09:00:00.000Z',
      }),
    });

    expect(readGlance('hh-1', storage)).toBeNull();
  });

  it('reads as no cache when nothing has been stored', () => {
    expect(readGlance('hh-1', fakeStorage())).toBeNull();
  });

  it.each([
    ['unparseable', '{not json'],
    ['a non-object', '42'],
    ['a null document', 'null'],
    ['a record with no household id', JSON.stringify({ cachedAtIso: '2026-07-20T09:00:00.000Z' })],
    ['a record with no freshness stamp', JSON.stringify({ householdId: 'hh-1' })],
  ])('reads as no cache when the entry is %s', (_label, raw) => {
    expect(readGlance('hh-1', fakeStorage({ [glanceCacheKey('hh-1')]: raw }))).toBeNull();
  });

  it('rejects the whole record when an identifying field is the wrong type', () => {
    // No usable household id or freshness stamp means there is nothing to key the
    // record to or to date it by, so it cannot be shown as last-known at all.
    const storage = fakeStorage({
      [glanceCacheKey('hh-1')]: JSON.stringify({
        householdId: 7,
        cachedAtIso: '2026-07-20T09:00:00.000Z',
        household: { name: 'Home', people },
      }),
    });

    expect(readGlance('hh-1', storage)).toBeNull();
  });

  it('rejects the whole record when the freshness stamp is not a string', () => {
    const storage = fakeStorage({
      [glanceCacheKey('hh-1')]: JSON.stringify({
        householdId: 'hh-1',
        cachedAtIso: 1_753_000_000_000,
        household: { name: 'Home', people },
      }),
    });

    expect(readGlance('hh-1', storage)).toBeNull();
  });

  /**
   * A malformed half must read as *absent*, never as junk: junk reaches `.map()`
   * inside a render and throws, which is exactly the crash the cache exists to
   * avoid. Storage is hand-editable and survives schema changes, so nothing in it
   * is trusted on the way out.
   */
  describe('a malformed half degrades to no cache instead of crashing a render', () => {
    /** Seed a record whose halves are exactly as given, bypassing `writeGlance`. */
    function seedRaw(halves: { household?: unknown; board?: unknown }) {
      return fakeStorage({
        [glanceCacheKey('hh-1')]: JSON.stringify({
          householdId: 'hh-1',
          cachedAtIso: '2026-07-20T09:00:00.000Z',
          ...halves,
        }),
      });
    }

    it.each([
      ['absent', undefined],
      ['null', null],
      ['not an object', 'Home'],
      ['an array', []],
      ['missing its name', { people }],
      ['carrying a non-string name', { name: 42, people }],
      ['carrying a non-array roster', { name: 'Home', people: { p1: 'Alex' } }],
      ['carrying a non-object person', { name: 'Home', people: ['Alex'] }],
      ['carrying a person with no id', { name: 'Home', people: [{ displayName: 'Alex' }] }],
      ['carrying a person with no display name', { name: 'Home', people: [{ personId: 'p1' }] }],
      [
        'carrying a person whose id is not a string',
        { name: 'Home', people: [{ personId: 1, displayName: 'Alex' }] },
      ],
    ])('reads the household half as absent when it is %s', (_label, household) => {
      expect(readGlance('hh-1', seedRaw({ household, board }))?.household).toBeNull();
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['not an object', '2026-W29'],
      ['an array', []],
      ['missing its week', { items: board.items }],
      ['carrying a non-string week', { weekIso: 29, items: board.items }],
      ['carrying a non-array item list', { weekIso: '2026-W29', items: { c1: 'Dishes' } }],
      ['carrying a non-object row', { weekIso: '2026-W29', items: ['Dishes'] }],
      [
        'carrying a row with no chore id',
        {
          weekIso: '2026-W29',
          items: [{ title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' }],
        },
      ],
      [
        'carrying a row with no title',
        {
          weekIso: '2026-W29',
          items: [{ choreId: 'c1', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' }],
        },
      ],
      [
        'carrying a row with no cadence',
        {
          weekIso: '2026-W29',
          items: [{ choreId: 'c1', title: 'Dishes', assignedPersonId: 'p1', status: 'Open' }],
        },
      ],
      [
        'carrying a row with no assignee',
        {
          weekIso: '2026-W29',
          items: [{ choreId: 'c1', title: 'Dishes', cadence: 'Daily', status: 'Open' }],
        },
      ],
      [
        'carrying a row with an unknown status',
        {
          weekIso: '2026-W29',
          items: [
            {
              choreId: 'c1',
              title: 'Dishes',
              cadence: 'Daily',
              assignedPersonId: 'p1',
              status: 'Halfway',
            },
          ],
        },
      ],
    ])('reads the board half as absent when it is %s', (_label, malformed) => {
      expect(readGlance('hh-1', seedRaw({ household: { name: 'Home', people }, board: malformed }))?.board).toBeNull();
    });

    it('serves the good half when only the other one is malformed', () => {
      // Per-half validation is what keeps a partially corrupt record useful: the
      // board still renders while the tiles fall back to their normal path.
      const snapshot = readGlance('hh-1', seedRaw({ household: { name: 42 }, board }));

      expect(snapshot?.household).toBeNull();
      expect(snapshot?.board).toEqual(board);
    });

    it('keeps the extra fields a roster entry carries (claim colour, child flag)', () => {
      // The name tiles read `claimColor` and `isChild`; validation must not strip
      // what it does not itself check.
      const snapshot = readGlance('hh-1', seedRaw({ household: { name: 'Home', people } }));

      expect(snapshot?.household?.people).toEqual(people);
    });

    it('drops nothing from a record it wrote itself', () => {
      const storage = fakeStorage();
      writeGlance(
        'hh-1',
        { household: { name: 'Home', people }, board },
        storage,
        '2026-07-20T09:00:00.000Z',
      );

      expect(readGlance('hh-1', storage)).toEqual({
        householdId: 'hh-1',
        household: { name: 'Home', people },
        board,
        cachedAtIso: '2026-07-20T09:00:00.000Z',
      });
    });
  });

  it('reads as no cache when storage itself throws', () => {
    const storage: GlanceStorage = {
      getItem: () => {
        throw new Error('access denied');
      },
      setItem: () => undefined,
    };

    expect(readGlance('hh-1', storage)).toBeNull();
  });

  it('swallows a failed write (quota, private mode) instead of breaking the load', () => {
    const storage: GlanceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(writeGlance('hh-1', { board }, storage, '2026-07-20T09:00:00.000Z')).toBeNull();
  });

  it('no-ops with no storage at all (native, or a browser that blocks it)', () => {
    expect(readGlance('hh-1')).toBeNull();
    expect(writeGlance('hh-1', { board })).toBeNull();
  });

  it('uses the ambient browser storage when one is present', () => {
    const storage = fakeStorage();
    setGlobalStorage(storage);

    writeGlance('hh-1', { board }, undefined, '2026-07-20T09:00:00.000Z');

    expect(readGlance('hh-1')?.board).toEqual(board);
  });
});

describe('defaultGlanceStorage', () => {
  it('finds an ambient Web Storage', () => {
    const storage = fakeStorage();
    setGlobalStorage(storage);

    expect(defaultGlanceStorage()).toBe(storage);
  });

  it('is undefined with no storage', () => {
    expect(defaultGlanceStorage()).toBeUndefined();
  });

  it('is undefined when the ambient object is not usable storage', () => {
    setGlobalStorage({ getItem: () => null });

    expect(defaultGlanceStorage()).toBeUndefined();
  });

  it('is undefined when reading `localStorage` itself throws (privacy mode)', () => {
    // In a browser with storage blocked, the *property access* throws
    // `SecurityError` - so merely looking for storage has to be guarded, or the
    // failure escapes the load's promise chain instead of degrading to no cache.
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: access to localStorage is denied');
      },
      configurable: true,
    });

    expect(defaultGlanceStorage()).toBeUndefined();
    // ...and the whole cache no-ops through that same guard, rather than throwing.
    expect(readGlance('hh-1')).toBeNull();
    expect(writeGlance('hh-1', { board })).toBeNull();
  });
});

describe('describeLastKnown', () => {
  const stamp = '2026-07-20T09:00:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it.each([
    ['a clock skewed into the future', '2026-07-20T08:59:00.000Z', 'Showing last-known - saved moments ago'],
    ['seconds', '2026-07-20T09:00:30.000Z', 'Showing last-known - saved moments ago'],
    ['one minute', '2026-07-20T09:01:00.000Z', 'Showing last-known - saved 1 minute ago'],
    ['minutes', '2026-07-20T09:12:00.000Z', 'Showing last-known - saved 12 minutes ago'],
    ['one hour', '2026-07-20T10:00:00.000Z', 'Showing last-known - saved 1 hour ago'],
    ['hours', '2026-07-20T12:30:00.000Z', 'Showing last-known - saved 3 hours ago'],
    ['one day', '2026-07-21T09:00:00.000Z', 'Showing last-known - saved 1 day ago'],
    ['days', '2026-07-22T21:00:00.000Z', 'Showing last-known - saved 2 days ago'],
  ])('describes %s', (_label, now, expected) => {
    expect(describeLastKnown(stamp, at(now))).toBe(expected);
  });

  it('still says the view is last-known when the stamp is unreadable', () => {
    expect(describeLastKnown('not-a-date', at('2026-07-20T09:00:00.000Z'))).toBe('Showing last-known');
  });

  it('measures against now by default', () => {
    expect(describeLastKnown(new Date().toISOString())).toBe('Showing last-known - saved moments ago');
  });
});
