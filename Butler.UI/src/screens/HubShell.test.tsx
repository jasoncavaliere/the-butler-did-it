import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type { ParticipantSessionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type Responses = {
  household: ApiResult<unknown>;
  people: ApiResult<unknown>;
};

const okHousehold = (name: string): ApiResult<unknown> => ({
  ok: true,
  status: 200,
  data: { householdId: 'hh-1', name },
  etag: null,
});

const unreachable: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

// The chore board (C5) the today panel now renders reads the active chores and
// the C3 assignment set; these keep those reads calm and empty so the shell
// tests below stay focused on the shell itself.
const okChores: ApiResult<unknown> = { ok: true, status: 200, data: [], etag: null };
const okAssignments: ApiResult<unknown> = {
  ok: true,
  status: 200,
  data: { weekIso: '2026-W29', assignments: [], unassigned: [] },
  etag: null,
};

// The grocery region (G5) reads the week's building cart on mount; an empty cart
// keeps that read calm too.
const okCart: ApiResult<unknown> = {
  ok: true,
  status: 200,
  data: {
    weekIso: '2026-W29',
    status: 'Building',
    confirmedByPersonId: null,
    confirmedUtc: null,
    eTag: 'W/"cart-1"',
    items: [],
  },
  etag: null,
};

/** A client that answers the household read and the people (roster) read by path. */
function clientWith(responses: Responses): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.includes('/chores')) {
        return okChores;
      }
      if (path.includes('/carts/')) {
        return okCart;
      }
      return path.endsWith('/people') ? responses.people : responses.household;
    }) as unknown as ApiClient['get'],
    // The only write the shell tests exercise is the board's C3 generate.
    update: jest.fn(async (): Promise<ApiResult<unknown>> => okAssignments) as unknown as ApiClient['update'],
  };
}

function renderHub(householdId: string | null = 'hh-1') {
  return render(
    <HouseholdProvider initialHouseholdId={householdId}>
      <HubShell />
    </HouseholdProvider>,
  );
}

afterEach(() => {
  useApiClientMock.mockReset();
  jest.useRealTimers();
});

const roster = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
  { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
];

/**
 * A client whose roster read returns Alex + Sam and whose claim (POST
 * `.../people/{id}/claim`) mints a participant session for that person. When
 * `claimResult` is supplied, every claim resolves to it instead (used to force a
 * claim failure).
 */
function interactiveClient(claimResult?: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.includes('/chores')) {
        return okChores;
      }
      if (path.includes('/carts/')) {
        return okCart;
      }
      return path.endsWith('/people')
        ? { ok: true, status: 200, data: roster, etag: null }
        : okHousehold('Home');
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      // The board's C3 generate always succeeds with an empty set; claimResult
      // (when supplied) only forces the claim to fail.
      if (path.endsWith('/generate')) {
        return okAssignments;
      }
      if (claimResult) {
        return claimResult;
      }
      const id = /people\/([^/]+)\/claim$/.exec(path)?.[1] ?? '';
      const person = roster.find((r) => r.personId === id)!;
      const session: ParticipantSessionResponse = {
        householdId: 'hh-1',
        personId: person.personId,
        displayName: person.displayName,
        claimColor: person.claimColor,
        isChild: person.isChild,
        token: `tok-${id}`,
      };
      return { ok: true, status: 200, data: session, etag: null };
    }) as unknown as ApiClient['update'],
  };
}

async function pressTile(personId: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`name-tile-${personId}`));
  });
}

describe('HubShell', () => {
  it('renders the header with the household name from the household read', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('The Rivera Household'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub();

    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household'),
    );
    expect(screen.getByTestId('hub-date')).toBeOnTheScreen();
  });

  it('renders one name tile per roster person, honouring the claim colour', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: {
          ok: true,
          status: 200,
          data: [
            { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
            { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
          ],
          etag: null,
        },
      }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByText('Alex')).toBeOnTheScreen();
    expect(screen.getByTestId('name-tile-p2')).toBeOnTheScreen();
    expect(screen.getByText('Sam')).toBeOnTheScreen();
  });

  it('never renders an organizer/dev identity as a claimable member', async () => {
    // Defence in depth: even if an organizer-role identity reaches the client -
    // the synthetic "Development Organizer" dev identity carries the organizer
    // role - the hub must not render it as a claimable name tile. Admins
    // administer; members do the chores. The roster here deliberately carries both
    // a member (Alex) and the dev organizer so the guard is genuinely exercised:
    // the member renders, the organizer does not.
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: {
          ok: true,
          status: 200,
          data: [
            { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false, role: 'Participant' },
            {
              personId: 'dev-organizer',
              displayName: 'Development Organizer',
              claimColor: null,
              isChild: false,
              role: 'Organizer',
            },
          ],
          etag: null,
        },
      }),
    );

    await renderHub();

    // The chore-doing member is a tile; the dev organizer is nowhere on the wall.
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByText('Alex')).toBeOnTheScreen();
    expect(screen.queryByText('Development Organizer')).toBeNull();
    expect(screen.queryByTestId('name-tile-dev-organizer')).toBeNull();
  });

  it('fills the today panel with the chore board (C5), calm and empty when nothing is assigned', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub();

    // The panel is now filled by the board seam, so the T2 placeholder is gone;
    // with no assignments the board shows its own calm empty state.
    await waitFor(() => expect(screen.getByTestId('chore-board-empty')).toBeOnTheScreen());
    expect(screen.getByTestId('today-panel')).toBeOnTheScreen();
    expect(screen.queryByTestId('today-panel-empty')).toBeNull();
  });

  it('mounts the grocery cart (G5) as its own bounded region, below the today panel', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub();

    // The region is present and has settled on its own cart read - the shell only
    // mounts it, it fetches its own data.
    await waitFor(() => expect(screen.getByTestId('hub-groceries')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-cart')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('grocery-cart-list')).toBeOnTheScreen());
    // The fairness balance still renders alongside it.
    expect(screen.getByTestId('hub-balance')).toBeOnTheScreen();
  });

  it('shows a calm "no people" state when the roster is empty', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-no-people')).toBeOnTheScreen());
  });

  it('treats a roster read with no body as an empty roster', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: undefined, etag: null },
      }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-no-people')).toBeOnTheScreen());
  });

  it('shows the graceful unreachable state when the household read fails', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({ household: unreachable, people: { ok: true, status: 200, data: [], etag: null } }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());
    // The shell frame (header + today panel) still renders - never a blank screen.
    expect(screen.getByTestId('hub-shell')).toBeOnTheScreen();
    expect(screen.getByTestId('today-panel')).toBeOnTheScreen();
  });

  it('shows the graceful unreachable state when the roster read fails', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({ household: okHousehold('Home'), people: unreachable }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());
  });

  it('shows a no-household state when no household is selected', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub(null);

    await waitFor(() =>
      expect(screen.getByTestId('hub-error')).toHaveTextContent('No household is set up yet.'),
    );
  });

  it('shows the loading state until the reads resolve', async () => {
    let resolve: (value: [ApiResult<unknown>, ApiResult<unknown>]) => void = () => {};
    const pending = new Promise<[ApiResult<unknown>, ApiResult<unknown>]>((r) => {
      resolve = r;
    });
    let call = 0;
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      // Hand each of the two parallel reads one leg of the same pending pair;
      // the grocery region's cart read (which only fires once the shell is ready)
      // is answered separately so it cannot consume a leg.
      get: jest.fn((path: string) =>
        path.includes('/carts/') ? Promise.resolve(okCart) : pending.then((pair) => pair[call++]),
      ) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    await renderHub();

    expect(screen.getByTestId('hub-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve([okHousehold('Home'), { ok: true, status: 200, data: [], etag: null }]);
      await pending;
    });

    await waitFor(() => expect(screen.queryByTestId('hub-loading')).toBeNull());
  });

  it('ignores reads that resolve after the shell unmounts', async () => {
    let resolve: (value: [ApiResult<unknown>, ApiResult<unknown>]) => void = () => {};
    const pending = new Promise<[ApiResult<unknown>, ApiResult<unknown>]>((r) => {
      resolve = r;
    });
    let call = 0;
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      get: jest.fn((path: string) =>
        path.includes('/carts/') ? Promise.resolve(okCart) : pending.then((pair) => pair[call++]),
      ) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    const view = await renderHub();
    await act(async () => {
      view.unmount();
    });

    await act(async () => {
      resolve([okHousehold('Home'), { ok: true, status: 200, data: [], etag: null }]);
      await pending;
    });

    expect(screen.queryByTestId('hub-household-name')).toBeNull();
  });

  describe('tap-to-claim', () => {
    it('claim-sets-active: tapping a tile claims via T1 and marks that person active (glow)', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      await renderHub();
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      // Neutral glance to start: nothing highlighted.
      expect(screen.getByText('Today')).toBeOnTheScreen();
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: false,
      });

      await pressTile('p1');

      // The claim endpoint was called with an empty POST body - never a password.
      expect(client.update).toHaveBeenCalledWith(
        '/households/hh-1/people/p1/claim',
        {},
        { method: 'POST' },
      );
      // Alex is now the active participant: their tile is selected and the today
      // panel glows as their day.
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();
    });

    it('switch: tapping another name re-claims and moves the active glow', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      await renderHub();
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      await pressTile('p1');
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();

      await pressTile('p2');

      // The second claim went out for Sam, and the glow moved off Alex onto Sam.
      expect(client.update).toHaveBeenLastCalledWith(
        '/households/hh-1/people/p2/claim',
        {},
        { method: 'POST' },
      );
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: false,
      });
      expect(screen.getByTestId('name-tile-p2').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(screen.getByText("Sam's day")).toBeOnTheScreen();
      expect(screen.queryByText("Alex's day")).toBeNull();
    });

    it('idle-clear: no interaction past the idle interval returns to the neutral state', async () => {
      jest.useFakeTimers();
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      // A short configured interval keeps the test crisp; the default is
      // IDLE_TIMEOUT_MS.
      const idleTimeoutMs = 1_000;
      await render(
        <HouseholdProvider initialHouseholdId="hh-1">
          <HubShell idleTimeoutMs={idleTimeoutMs} />
        </HouseholdProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      await pressTile('p1');
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(idleTimeoutMs + 1);
      });

      // Back to the neutral glance: nothing highlighted.
      expect(screen.queryByText("Alex's day")).toBeNull();
      expect(screen.getByText('Today')).toBeOnTheScreen();
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: false,
      });
    });

    it('leaves the current state untouched when a claim fails - and never prompts', async () => {
      const client = interactiveClient(unreachable);
      useApiClientMock.mockReturnValue(client);

      await renderHub();
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      await pressTile('p1');

      // Exactly one claim went out (the board's C3 generate also uses update, so
      // filter to the claim call rather than counting every write).
      const claimCalls = (client.update as jest.Mock).mock.calls.filter(
        ([path]) => typeof path === 'string' && path.endsWith('/claim'),
      );
      expect(claimCalls).toHaveLength(1);
      // No participant became active; the glance stays neutral and no PIN/password
      // field is ever rendered.
      expect(screen.getByText('Today')).toBeOnTheScreen();
      expect(screen.queryByText("Alex's day")).toBeNull();
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: false,
      });
    });
  });

  describe('organizer sign-in independence (AC8)', () => {
    const ORGANIZER: OrganizerSession = {
      organizer: { subject: 'oid-1', name: 'Robin Organizer' },
      token: 'bearer-abc',
    };

    /** A fake auth provider injected through the real IAuthProvider seam. */
    function fakeProvider(overrides: Partial<IAuthProvider> = {}): IAuthProvider {
      return {
        kind: 'fake',
        signIn: overrides.signIn ?? (() => Promise.resolve(ORGANIZER)),
        signOut: overrides.signOut ?? (() => Promise.resolve()),
      };
    }

    /** Render the hub with both the household and a real organizer session context. */
    async function renderHubWithOrganizer(authProvider: IAuthProvider) {
      return render(
        <HouseholdProvider initialHouseholdId="hh-1">
          <OrganizerProvider authProvider={authProvider}>
            <HubShell />
          </OrganizerProvider>
        </HouseholdProvider>,
      );
    }

    it('leaves the active participant claim intact when an organizer signs in', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      await renderHubWithOrganizer(fakeProvider());
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      // A participant claims the device: Alex is active and their tile glows.
      await pressTile('p1');
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();

      // No organizer yet: the bar offers only the sign-in affordance.
      expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();

      // The organizer signs in on the same shared device.
      await act(async () => {
        fireEvent.press(screen.getByTestId('organizer-sign-in'));
      });

      // Organizer auth is now established - and completely independent of the
      // participant: Alex remains the active participant (tile still glowing,
      // today panel still "Alex's day"). Organizer sign-in never touched it.
      expect(screen.getByTestId('organizer-identity')).toHaveTextContent('Robin Organizer');
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();
    });

    it('leaves the active participant claim intact when an organizer signs out', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      await renderHubWithOrganizer(fakeProvider());
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      // Organizer signs in first, then a participant claims the device.
      await act(async () => {
        fireEvent.press(screen.getByTestId('organizer-sign-in'));
      });
      await pressTile('p1');
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();

      // The organizer signs out - the participant claim survives untouched.
      await act(async () => {
        fireEvent.press(screen.getByTestId('organizer-sign-out'));
      });

      expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(screen.getByText("Alex's day")).toBeOnTheScreen();
    });
  });
});

/**
 * Epic 60 O2: the glance survives an outage. The hub caches the household and
 * its people on every successful load, renders the real name tiles from that
 * cache when the API is unreachable, and says so while it does.
 */
describe('HubShell offline cache', () => {
  /** An in-memory stand-in for the browser storage the cache writes to. */
  function installStorage(): void {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          entries.set(key, value);
        },
      },
      configurable: true,
      writable: true,
    });
  }

  let reconnectCleanups: (() => void)[] = [];

  /**
   * Stand in for the browser's `online` event, which this test environment does
   * not provide. Returns a function that fires a reconnect at whatever the hub
   * subscribed, so a test can prove the wall recovers with nobody touching it.
   */
  function installReconnect(): () => void {
    const listeners = new Set<() => void>();
    const original = {
      add: (globalThis as { addEventListener?: unknown }).addEventListener,
      remove: (globalThis as { removeEventListener?: unknown }).removeEventListener,
    };
    const define = (name: string, value: unknown) =>
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

    define('addEventListener', (type: string, listener: () => void) => {
      if (type === 'online') {
        listeners.add(listener);
      }
    });
    define('removeEventListener', (type: string, listener: () => void) => {
      if (type === 'online') {
        listeners.delete(listener);
      }
    });

    reconnectCleanups.push(() => {
      define('addEventListener', original.add);
      define('removeEventListener', original.remove);
    });

    return () => {
      for (const listener of Array.from(listeners)) {
        listener();
      }
    };
  }

  beforeEach(() => {
    installStorage();
    reconnectCleanups = [];
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    for (const cleanup of reconnectCleanups) {
      cleanup();
    }
    useApiClientMock.mockReset();
  });

  const cachedPeople = [
    { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
    { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
  ];

  const cachedBoard = {
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

  /** A client whose every call fails the way an unreachable API does. */
  function offlineClient(): ApiClient {
    return {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => unreachable) as unknown as ApiClient['get'],
      update: jest.fn(async () => unreachable) as unknown as ApiClient['update'],
    };
  }

  it('cache-write-on-successful-load: a live load caches the household and its people', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('The Rivera Household'),
        people: { ok: true, status: 200, data: cachedPeople, etag: null },
      }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(readGlance('hh-1')?.household).toEqual({
      name: 'The Rivera Household',
      people: cachedPeople,
    });
    // Nothing was served from cache, so the hub does not claim it was.
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
  });

  it('render-from-cache-when-offline: name tiles render from cache, marked last-known', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'The Rivera Household', people: cachedPeople }, board: cachedBoard },
      undefined,
      new Date(Date.now() - 12 * 60_000).toISOString(),
    );
    useApiClientMock.mockReturnValue(offlineClient());

    await renderHub();

    // Real tiles and a real household name, not an error or an empty wall.
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household');
    expect(screen.getByText('Sam')).toBeOnTheScreen();
    expect(screen.queryByTestId('hub-error')).toBeNull();
    // ...and today's board comes back from the same cache.
    expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen();
    // The view never pretends to be live.
    expect(screen.getByTestId('last-known-banner')).toHaveTextContent(
      'Showing last-known - saved 12 minutes ago',
    );
  });

  it('falls back to cache when it is the roster read that cannot be reached', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'Home', people: cachedPeople } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    useApiClientMock.mockReturnValue(
      clientWith({ household: okHousehold('Home'), people: unreachable }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();
  });

  it('marks the hub last-known when only the board fell back', async () => {
    writeGlance('hh-1', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');
    // The shell's reads succeed; the board's C3 generate is the one that cannot
    // reach the API.
    const client: ApiClient = {
      ...clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: cachedPeople, etag: null },
      }),
      update: jest.fn(async () => unreachable) as unknown as ApiClient['update'],
    };
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();
  });

  /**
   * A client that fails like an unreachable API or answers like a live one,
   * switched by `state.offline` mid-test - the same object throughout, so a
   * refetch can only have come from the reconnect signal, not from a new client.
   */
  function flippableClient(state: { offline: boolean }, liveName: string): ApiClient {
    const live = clientWith({
      household: okHousehold(liveName),
      people: { ok: true, status: 200, data: cachedPeople, etag: null },
    });
    return {
      baseUrl: live.baseUrl,
      get: jest.fn(async (path: string) =>
        state.offline ? unreachable : live.get<unknown>(path),
      ) as unknown as ApiClient['get'],
      update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) =>
        state.offline ? unreachable : live.update<unknown>(path, body, options),
      ) as unknown as ApiClient['update'],
    };
  }

  it('reconnect-refreshes-the-hub: an online event reloads the glance with nobody touching the wall', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'Stale Name', people: cachedPeople }, board: cachedBoard },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    const emitOnline = installReconnect();
    const state = { offline: true };
    useApiClientMock.mockReturnValue(flippableClient(state, 'The Rivera Household'));

    await renderHub();

    // The outage: the cached glance, honestly marked.
    await waitFor(() => expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen());
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Stale Name');

    // The network returns. No reload, no rerender, no new client - just the event.
    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    // The live household replaces the cached one...
    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household'),
    );
    // ...the last-known indication clears (AC-5)...
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
    // ...and the cache carries the live data under a newer stamp (AC-4).
    const refreshed = readGlance('hh-1');
    expect(refreshed?.household?.name).toBe('The Rivera Household');
    expect(Date.parse(refreshed?.cachedAtIso ?? '')).toBeGreaterThan(
      Date.parse('2026-07-20T09:00:00.000Z'),
    );
  });

  it('reconnect-refreshes-the-hub: an online event recovers a hub that had nothing cached', async () => {
    const emitOnline = installReconnect();
    const state = { offline: true };
    useApiClientMock.mockReturnValue(flippableClient(state, 'Home'));

    await renderHub();

    // Nothing cached, so the outage is the plain error state.
    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());

    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    // The wall comes back by itself rather than holding an error until someone
    // notices and reloads it.
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    expect(screen.queryByTestId('hub-error')).toBeNull();
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
  });

  it('does not listen for a reconnect while the hub is live', async () => {
    const emitOnline = installReconnect();
    const client = clientWith({
      household: okHousehold('Home'),
      people: { ok: true, status: 200, data: cachedPeople, etag: null },
    });
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

    const readsBefore = (client.get as jest.Mock).mock.calls.length;
    await act(async () => {
      emitOnline();
    });

    // A healthy hub subscribes to nothing, so a stray reconnect cannot start a
    // refetch storm on a device that is on all day.
    expect((client.get as jest.Mock).mock.calls.length).toBe(readsBefore);
  });

  it('cache-refresh-on-a-later-load: the live data returns, the indication clears, the stamp moves', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'Stale Name', people: cachedPeople }, board: cachedBoard },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    useApiClientMock.mockReturnValue(offlineClient());

    const view = await renderHub();
    await waitFor(() => expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen());

    // The network comes back: a fresh client re-runs the load.
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('The Rivera Household'),
        people: { ok: true, status: 200, data: cachedPeople, etag: null },
      }),
    );
    await act(async () => {
      view.rerender(
        <HouseholdProvider initialHouseholdId="hh-1">
          <HubShell />
        </HouseholdProvider>,
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household'),
    );
    // The indication clears...
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
    // ...and the cache now holds the live data under a newer stamp.
    const refreshed = readGlance('hh-1');
    expect(refreshed?.household?.name).toBe('The Rivera Household');
    expect(Date.parse(refreshed?.cachedAtIso ?? '')).toBeGreaterThan(
      Date.parse('2026-07-20T09:00:00.000Z'),
    );
  });

  it('keeps the error state when a reachable service fails, cache or not', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'Home', people: cachedPeople } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    useApiClientMock.mockReturnValue(
      clientWith({
        household: {
          ok: false,
          error: { kind: 'problem', status: 403, title: 'Forbidden', detail: 'Not your household.' },
        },
        people: { ok: true, status: 200, data: cachedPeople, etag: null },
      }),
    );

    await renderHub();

    // A real answer from a reachable service is not something the cache hides.
    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());
    expect(screen.getByTestId('hub-error')).toHaveTextContent('Not your household.');
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
  });

  it('shows the offline error when there is nothing cached to fall back to', async () => {
    useApiClientMock.mockReturnValue(offlineClient());

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
  });

  it('never renders another household from cache', async () => {
    writeGlance(
      'hh-2',
      { household: { name: 'Lake House', people: cachedPeople } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    useApiClientMock.mockReturnValue(offlineClient());

    await renderHub();

    // hh-1 is the active household and has no cache of its own; hh-2's is never
    // borrowed, no matter that it is the only thing stored.
    await waitFor(() => expect(screen.getByTestId('hub-error')).toBeOnTheScreen());
    expect(screen.queryByText('Lake House')).toBeNull();
    expect(screen.queryByTestId('name-tile-p1')).toBeNull();
  });
});
