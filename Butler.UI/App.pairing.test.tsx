import { render, screen, waitFor } from '@testing-library/react-native';

import App from './App';
import { resetSessionFallbackStorage, type LocalStorageLike } from './src/offline/storage';
import { currentWeekIso } from './src/offline/weekIso';
import { HUB_PAIRING_KEY } from './src/state/hubPairingStorage';

/**
 * #188: a paired hub survives a page reload. Each test renders a fresh <App />
 * the way a reload does - a new React tree over whatever is already in the
 * browser's storage - with fetch routed by URL path.
 */

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

type Call = { path: string; headers: Record<string, string> };

/**
 * A fetch that answers the hub's reads by path. `deviceRejected` makes every
 * household-scoped read that carries the device token answer 401, the way the
 * API answers a revoked or unknown token on an endpoint that admits the device.
 */
function routedFetch({ deviceRejected = false }: { deviceRejected?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://hub.test').pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ path, headers });

    if (path.endsWith('/me')) {
      return respond(200, { subject: 'dev-organizer', name: 'Dev Organizer' });
    }
    if (path.endsWith('/api/system/dataset')) {
      return respond(200, { datasetId: 'ds-1' });
    }
    if (path.endsWith('/households/hh-1')) {
      if (deviceRejected && headers['X-Device-Token']) {
        return respond(401);
      }
      return respond(200, { householdId: 'hh-1', name: 'Home' });
    }
    if (path.endsWith('/households/hh-1/people')) {
      return respond(200, [
        { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
        { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
      ]);
    }
    if (path.endsWith('/households/hh-1/chores')) {
      return respond(200, [
        {
          choreId: 'c1',
          title: 'Dishes',
          roomId: 'r1',
          cadence: 'Daily',
          effort: 1,
          minAge: null,
          active: true,
          eTag: 'e1',
        },
      ]);
    }
    // The board's lazy week read (#110), `GET .../assignments/{weekIso}`.
    if (path.endsWith(`/assignments/${currentWeekIso()}`)) {
      return respond(200, {
        weekIso: currentWeekIso(),
        currentWeekIso: currentWeekIso(),
        assignments: [{ choreId: 'c1', assignedPersonId: 'p1', effort: 1, status: 'Open' }],
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
    return respond(404);
  });
  return { fetchMock, calls };
}

const STORED = JSON.stringify({ householdId: 'hh-1', deviceToken: 'dev-1' });

describe('App hub pairing across a reload (#188)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setGlobalStorage(undefined);
    resetSessionFallbackStorage();
    jest.restoreAllMocks();
  });

  it('restores a stored pairing on reload and sends the device token on X-Device-Token', async () => {
    setGlobalStorage(fakeStorage({ [HUB_PAIRING_KEY]: STORED }));
    const { fetchMock, calls } = routedFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home'));
    const householdRead = calls.find((call) => call.path.endsWith('/households/hh-1'));
    expect(householdRead?.headers['X-Device-Token']).toBe('dev-1');
  });

  it('a reloaded paired hub shows the household name tiles and chores without organizer sign-in', async () => {
    setGlobalStorage(fakeStorage({ [HUB_PAIRING_KEY]: STORED }));
    const { fetchMock } = routedFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByTestId('name-tile-p2')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.queryByText('Create your household')).toBeNull();
  });

  it('restores no organizer session on reload (no Authorization header, organizer sign-in shown)', async () => {
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: STORED });
    setGlobalStorage(storage);
    const { fetchMock, calls } = routedFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
    expect(screen.queryByTestId('organizer-actions')).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers.Authorization).toBeUndefined();
    }
    // The pairing record is the only thing this ticket stores, and it holds no organizer.
    expect(Object.keys(JSON.parse(storage.entries.get(HUB_PAIRING_KEY) ?? '{}')).sort()).toEqual([
      'deviceToken',
      'householdId',
    ]);
  });

  it('a stored token the API refuses (401) clears the stored pairing and shows the unpaired setup route', async () => {
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: STORED });
    setGlobalStorage(storage);
    const { fetchMock } = routedFetch({ deviceRejected: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    expect(await screen.findByText('Create your household')).toBeOnTheScreen();
    await waitFor(() => expect(storage.entries.has(HUB_PAIRING_KEY)).toBe(false));
    expect(screen.queryByTestId('hub-household-name')).toBeNull();
  });

  it('with localStorage blocked the app renders the setup flow as today', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: access to localStorage is denied');
      },
      configurable: true,
    });
    const { fetchMock } = routedFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await render(<App />);

    expect(await screen.findByText('Create your household')).toBeOnTheScreen();
  });
});
