import { datasetIdKey, readLastSeenDatasetId, writeLastSeenDatasetId } from './datasetGuard';
import { forgetHouseholdOffline } from './forgetHousehold';
import { readGlance, writeGlance } from './glanceCache';
import { resetSessionFallbackStorage, type LocalStorageLike } from './storage';
import { currentWeekIso } from './weekIso';
import { assignmentDedupeKey, enqueueWrite, readWriteQueue, type WriteRequest } from './writeQueue';

const WEEK = currentWeekIso();

/** Install an in-memory `globalThis.localStorage` and hand back its raw map. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage: LocalStorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  return map;
}

function completion(householdId: string, choreId: string): WriteRequest {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/${householdId}/assignments/${WEEK}/${choreId}/complete`,
    body: { personId: 'p1' },
  };
}

/** Seed a household with a cached glance and one queued write. */
function seedHousehold(householdId: string): void {
  writeGlance(householdId, { household: { name: `Home ${householdId}`, people: [] } });
  enqueueWrite(householdId, completion(householdId, 'c1'));
}

let map: Map<string, string>;

beforeEach(() => {
  map = installStorage();
  resetSessionFallbackStorage();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  resetSessionFallbackStorage();
});

describe('forgetHouseholdOffline (#168)', () => {
  it("clears only that household's write queue and glance", () => {
    seedHousehold('hh-a');
    seedHousehold('hh-b');
    expect(readGlance('hh-a')).not.toBeNull();
    expect(readWriteQueue('hh-a')).toHaveLength(1);

    forgetHouseholdOffline('hh-a');

    expect(readGlance('hh-a')).toBeNull();
    expect(readWriteQueue('hh-a')).toEqual([]);
    expect(readGlance('hh-b')?.household?.name).toBe('Home hh-b');
    expect(readWriteQueue('hh-b')).toHaveLength(1);
  });

  it('leaves the last-seen dataset id alone', () => {
    seedHousehold('hh-a');
    writeLastSeenDatasetId('hh-a', 'ds-a');

    forgetHouseholdOffline('hh-a');

    expect(readLastSeenDatasetId('hh-a')).toBe('ds-a');
    expect(map.get(datasetIdKey('hh-a'))).toBe('ds-a');
  });

  it('is a no-op for a household with nothing stored', () => {
    expect(() => forgetHouseholdOffline('hh-none')).not.toThrow();
    expect(readGlance('hh-none')).toBeNull();
    expect(readWriteQueue('hh-none')).toEqual([]);
  });
});
