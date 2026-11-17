import { render, screen, waitFor } from '@testing-library/react-native';

import App from './App';
import { resetSessionFallbackStorage, type LocalStorageLike } from './src/offline/storage';
import { currentWeekIso } from './src/offline/weekIso';
import { HUB_PAIRING_KEY } from './src/state/hubPairingStorage';

/**
 * #316: a hub built with `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID` opens the seeded demo
 * household when nothing is stored, instead of the setup wizard. Each test
 * renders a fresh <App /> the way a reload does, over whatever is already in
 * the browser's storage, with fetch routed by URL path (the pattern of
 * App.pairing.test.tsx).
 */

const DEMO_ID = 'demo-household';
const DEMO_NAME = 'The Parker Household';

/** An in-memory stand-in for Web Storage, with the raw map exposed to assert on. */
function fakeStorage(seed: Record<string, string> = {}): LocalStorageLike & {
  entries: Map<string, string>;
} {
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

function setGlobalStorage(storage: LocalStorageLike | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function respond(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

type Call = { method: string; path: string; headers: Record<string, string> };

type Household = {
  id: string;
  name: string;
  people: { personId: string; displayName: string; claimColor: string | null; isChild: boolean }[];
};

const PARKERS: Household = {
  id: DEMO_ID,
  name: DEMO_NAME,
  people: [
    { personId: 'maria', displayName: 'Maria', claimColor: '#B0206F', isChild: false },
    { personId: 'dan', displayName: 'Dan', claimColor: null, isChild: false },
    { personId: 'ava', displayName: 'Ava', claimColor: null, isChild: true },
    { personId: 'leo', displayName: 'Leo', claimColor: null, isChild: true },
  ],
};

const HOME: Household = {
  id: 'hh-1',
  name: 'Home',
  people: [{ personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false }],
};

/**
 * A fetch that answers the hub's reads by path for each given household and
 * records the method of every call. `deviceRejected` makes a household-scoped
 * read that carries the device token answer 401, the way the API answers a token
 * that `demo reset` wiped.
 */
function routedFetch(households: Household[], { deviceRejected = false } = {}) {
  const calls: Call[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://hub.test').pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: (init.method ?? 'GET').toUpperCase(), path, headers });

    if (path.endsWith('/me')) {
      return respond(200, { subject: 'dev-organizer', name: 'Dev Organizer' });
    }
    if (path.endsWith('/api/system/dataset')) {
      return respond(200, { datasetId: 'ds-1' });
    }
    for (const household of households) {
      const base = `/households/${household.id}`;
      if (!path.includes(`${base}`)) {
        continue;
      }
      if (deviceRejected && headers['X-Device-Token']) {
        return respond(401);
      }
      if (path.endsWith(base)) {
        return respond(200, { householdId: household.id, name: household.name });
      }
      if (path.endsWith(`${base}/people`)) {
        return respond(200, household.people);
      }
      if (path.endsWith(`${base}/chores`)) {
        return respond(200, []);
      }
      if (path.endsWith(`/assignments/${currentWeekIso()}`)) {
        return respond(200, {
          weekIso: currentWeekIso(),
          currentWeekIso: currentWeekIso(),
          assignments: [],
          unassigned: [],
        });
      }
      if (path.endsWith('/carts/current')) {
        return respond(200, {
          weekIso: currentWeekIso(),
          status: 'Building',
          confirmedByPersonId: null,
          confirmedUtc: null,
          eTag: 'W/"cart-1"',
          items: [],
          estimatedTotal: 0,
          customItemCount: 0,
        });
      }
      if (path.endsWith('/fairness')) {
        return respond(200, { weekIso: currentWeekIso(), members: [] });
      }
      if (path.endsWith('/events')) {
        return respond(204);
      }
    }
    return respond(404);
  });
  return { fetchMock, calls };
}

/** True when any call created a household (`POST .../households`). */
function createdHousehold(calls: Call[]): boolean {
  return calls.some((call) => call.method === 'POST' && /\/households\/?$/.test(call.path));
}

const STORED = JSON.stringify({ householdId: 'hh-1', deviceToken: 'dev-1' });

describe('App demo household startup (#316)', () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setGlobalStorage(undefined);
    resetSessionFallbackStorage();
    jest.restoreAllMocks();
    if (savedEnv === undefined) {
      delete process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID;
    } else {
      process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = savedEnv;
    }
  });

  it('AC1: with EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household and nothing stored, the hub opens demo-household and shows The Parker Household without setup or a household create', async () => {
    process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = DEMO_ID;
    const storage = fakeStorage();
    setGlobalStorage(storage);
    const { fetchMock, calls } = routedFetch([PARKERS]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent(DEMO_NAME),
    );
    await waitFor(() => expect(screen.getByTestId('name-tile-maria')).toBeOnTheScreen());
    expect(screen.queryByText('Create your household')).toBeNull();
    expect(screen.queryByTestId('input-household-name')).toBeNull();
    expect(calls.some((call) => call.method === 'GET' && call.path.endsWith(`/households/${DEMO_ID}`))).toBe(
      true,
    );
    expect(createdHousehold(calls)).toBe(false);
    // Opening the demo household does not pair the hub: nothing is stored.
    expect(storage.entries.has(HUB_PAIRING_KEY)).toBe(false);
  });

  it('AC2: a stored pairing wins over EXPO_PUBLIC_DEMO_HOUSEHOLD_ID', async () => {
    process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = DEMO_ID;
    setGlobalStorage(fakeStorage({ [HUB_PAIRING_KEY]: STORED }));
    const { fetchMock, calls } = routedFetch([HOME, PARKERS]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home'));
    expect(calls.some((call) => call.path.includes(`/households/${DEMO_ID}`))).toBe(false);
    const householdRead = calls.find((call) => call.path.endsWith('/households/hh-1'));
    expect(householdRead?.headers['X-Device-Token']).toBe('dev-1');
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
  ])(
    'AC3: without EXPO_PUBLIC_DEMO_HOUSEHOLD_ID (%s), nothing stored shows the setup wizard',
    async (_label, value) => {
      if (value === undefined) {
        delete process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID;
      } else {
        process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = value;
      }
      setGlobalStorage(fakeStorage());
      const { fetchMock, calls } = routedFetch([PARKERS]);
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await render(<App />);

      expect(await screen.findByText('Create your household')).toBeOnTheScreen();
      expect(screen.queryByTestId('hub-household-name')).toBeNull();
      expect(calls.some((call) => call.path.includes(`/households/${DEMO_ID}`))).toBe(false);
    },
  );

  it('AC6: after a reset, a stored pairing whose device token the API refuses falls back to demo-household, not setup', async () => {
    process.env.EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = DEMO_ID;
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: STORED });
    setGlobalStorage(storage);
    const { fetchMock, calls } = routedFetch([HOME, PARKERS], { deviceRejected: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent(DEMO_NAME),
    );
    await waitFor(() => expect(storage.entries.has(HUB_PAIRING_KEY)).toBe(false));
    expect(screen.queryByText('Create your household')).toBeNull();
    // The demo household is read without the refused device token.
    const demoRead = calls.find((call) => call.path.endsWith(`/households/${DEMO_ID}`));
    expect(demoRead?.headers['X-Device-Token']).toBeUndefined();
    expect(createdHousehold(calls)).toBe(false);
  });
});
