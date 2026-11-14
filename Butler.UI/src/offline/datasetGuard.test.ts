import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import {
  DATASET_ID_PREFIX,
  checkDataset,
  datasetIdKey,
  readLastSeenDatasetId,
  writeLastSeenDatasetId,
} from './datasetGuard';
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

/** A client whose dataset read answers `result`. */
function datasetClient(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string) => {
      expect(path).toBe(DATASET_PATH);
      return result;
    }) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

const answering = (datasetId: string) =>
  datasetClient({ ok: true, status: 200, data: { datasetId }, etag: null });

/** Seed a household with a cached glance and one queued write. */
function seedHousehold(householdId: string): void {
  writeGlance(householdId, { household: { name: `Home ${householdId}`, people: [] } });
  enqueueWrite(householdId, completion(householdId, 'c1'));
}

beforeEach(() => {
  installStorage();
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

describe('last-seen dataset id', () => {
  it('is stored per household under a versioned key', () => {
    expect(datasetIdKey('hh-1')).toBe(`${DATASET_ID_PREFIX}hh-1`);
    expect(DATASET_ID_PREFIX).toBe('butler.dataset.v1.');

    writeLastSeenDatasetId('hh-1', 'ds-a');

    expect(readLastSeenDatasetId('hh-1')).toBe('ds-a');
    expect(readLastSeenDatasetId('hh-2')).toBeNull();
  });

  it('reads an empty record as none', () => {
    writeLastSeenDatasetId('hh-1', '');

    expect(readLastSeenDatasetId('hh-1')).toBeNull();
  });

  it('tolerates a store that throws', () => {
    const throwing: LocalStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readLastSeenDatasetId('hh-1', throwing)).toBeNull();
    expect(() => writeLastSeenDatasetId('hh-1', 'ds-a', throwing)).not.toThrow();
  });
});

describe('checkDataset', () => {
  it('first-seen stores the id and keeps everything', async () => {
    seedHousehold('hh-1');

    await expect(checkDataset('hh-1', answering('ds-a'))).resolves.toBe('first-seen');

    expect(readLastSeenDatasetId('hh-1')).toBe('ds-a');
    expect(readWriteQueue('hh-1')).toHaveLength(1);
    expect(readGlance('hh-1')).not.toBeNull();
  });

  it('same id keeps the glance and the write queue', async () => {
    seedHousehold('hh-1');
    writeLastSeenDatasetId('hh-1', 'ds-a');

    await expect(checkDataset('hh-1', answering('ds-a'))).resolves.toBe('unchanged');

    expect(readWriteQueue('hh-1')).toHaveLength(1);
    expect(readGlance('hh-1')?.household?.name).toBe('Home hh-1');
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-a');
  });

  it("changed id clears the household's glance and write queue, then stores the new id", async () => {
    seedHousehold('hh-1');
    writeLastSeenDatasetId('hh-1', 'ds-a');

    await expect(checkDataset('hh-1', answering('ds-b'))).resolves.toBe('changed');

    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(readGlance('hh-1')).toBeNull();
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-b');
    // A second check against the same API now agrees: nothing is cleared twice.
    await expect(checkDataset('hh-1', answering('ds-b'))).resolves.toBe('unchanged');
  });

  it("clearing one household leaves another household's records alone", async () => {
    seedHousehold('hh-1');
    seedHousehold('hh-2');
    writeLastSeenDatasetId('hh-1', 'ds-a');
    writeLastSeenDatasetId('hh-2', 'ds-a');

    await checkDataset('hh-1', answering('ds-b'));

    expect(readWriteQueue('hh-2')).toHaveLength(1);
    expect(readGlance('hh-2')).not.toBeNull();
    expect(readLastSeenDatasetId('hh-2')).toBe('ds-a');
  });

  it.each<[string, ApiResult<unknown>]>([
    ['a network failure', { ok: false, error: { kind: 'network', status: 0, title: 'down' } }],
    ['a proxy 502', { ok: false, error: { kind: 'http', status: 502, title: 'Bad Gateway' } }],
    ['a malformed body', { ok: true, status: 200, data: { nope: true }, etag: null }],
  ])('%s is unverified and clears nothing', async (_label, result) => {
    seedHousehold('hh-1');
    writeLastSeenDatasetId('hh-1', 'ds-a');

    await expect(checkDataset('hh-1', datasetClient(result))).resolves.toBe('unverified');

    expect(readWriteQueue('hh-1')).toHaveLength(1);
    expect(readGlance('hh-1')).not.toBeNull();
    expect(readLastSeenDatasetId('hh-1')).toBe('ds-a');
  });
});
