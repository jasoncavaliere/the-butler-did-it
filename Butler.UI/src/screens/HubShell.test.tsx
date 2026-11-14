import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { HubShell, revealAndFocus } from './HubShell';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import type { ParticipantSessionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { resetSessionFallbackStorage } from '../offline/storage';
import { currentWeekIso } from '../offline/weekIso';
import {
  OFFLINE_RETRY_MS,
  assignmentDedupeKey,
  readWriteQueue,
  saveWriteQueue,
} from '../offline/writeQueue';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider, useOrganizer } from '../state/OrganizerContext';

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

// The dataset guard (#100 D7) reads the API's dataset id before the hub shows
// anything; every fake client answers it with the same id, so the guard sees an
// unchanged dataset and stays out of the way unless a test says otherwise.
const DATASET_ID = 'ds-1';
const okDataset: ApiResult<unknown> = {
  ok: true,
  status: 200,
  data: { datasetId: DATASET_ID },
  etag: null,
};

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
      if (path === DATASET_PATH) {
        return okDataset;
      }
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
      if (path === DATASET_PATH) {
        return okDataset;
      }
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
    // No household means no queue, so there is no sync state to show either.
    expect(screen.queryByTestId('sync-indicator')).toBeNull();
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
        path === DATASET_PATH || path.includes('/carts/')
          ? Promise.resolve(path === DATASET_PATH ? okDataset : okCart)
          : pending.then((pair) => pair[call++]),
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
        path === DATASET_PATH || path.includes('/carts/')
          ? Promise.resolve(path === DATASET_PATH ? okDataset : okCart)
          : pending.then((pair) => pair[call++]),
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
    async function renderHubWithOrganizer(
      authProvider: IAuthProvider,
      hubProps: ComponentProps<typeof HubShell> = {},
    ) {
      return render(
        <HouseholdProvider initialHouseholdId="hh-1">
          <OrganizerProvider authProvider={authProvider}>
            <HubShell {...hubProps} />
          </OrganizerProvider>
        </HouseholdProvider>,
      );
    }

    it('passes onEditHousehold to the organizer bar', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);
      const onEditHousehold = jest.fn();

      await renderHubWithOrganizer(fakeProvider(), { onEditHousehold });
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

      // Hidden until an organizer signs in.
      expect(screen.queryByTestId('affordance-edit-household')).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByTestId('organizer-sign-in'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('affordance-edit-household'));
      });

      expect(onEditHousehold).toHaveBeenCalledTimes(1);
    });

    it('shows no Household button when the hub is not given onEditHousehold', async () => {
      const client = interactiveClient();
      useApiClientMock.mockReturnValue(client);

      await renderHubWithOrganizer(fakeProvider());
      await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
      await act(async () => {
        fireEvent.press(screen.getByTestId('organizer-sign-in'));
      });

      expect(screen.getByTestId('organizer-identity')).toBeOnTheScreen();
      expect(screen.queryByTestId('affordance-edit-household')).toBeNull();
    });

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

    /**
     * #105 AC24: on a paired hub the API client swaps from the organizer bearer
     * to the device header when the organizer signs out or the token expires
     * (the real client clears the organizer and retries as the device). The hub
     * keeps its household, tiles, and board, never shows its error state, and
     * hides the sensitive actions.
     */
    describe('participant-only mode on a paired hub (#105)', () => {
      const pinProvider = (): IAuthProvider => ({ ...fakeProvider(), kind: 'pin' });

      async function signInWithPin() {
        await act(async () => {
          fireEvent.press(screen.getByTestId('organizer-sign-in'));
        });
        for (const digit of '2468') {
          await act(async () => {
            fireEvent.press(screen.getByTestId(`pin-digit-${digit}`));
          });
        }
        await act(async () => {
          fireEvent.press(screen.getByTestId('pin-submit'));
        });
      }

      function expectParticipantOnly(deviceClient: ApiClient) {
        expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
        expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen();
        expect(screen.getByTestId('name-tile-p2')).toBeOnTheScreen();
        expect(screen.queryByTestId('hub-error')).toBeNull();
        expect(screen.queryByTestId('organizer-actions')).toBeNull();
        expect(screen.queryByTestId('affordance-confirm-order')).toBeNull();
        expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
        expect(deviceClient.get).toHaveBeenCalledWith('/households/hh-1');
      }

      it('paired hub keeps tiles and board after organizer sign-out, without hub-error or sensitive actions', async () => {
        const deviceClient = interactiveClient();
        const organizerClient = interactiveClient();
        useApiClientMock.mockImplementation(() => (useOrganizer().token ? organizerClient : deviceClient));

        await renderHubWithOrganizer(pinProvider());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        await signInWithPin();
        await waitFor(() => expect(screen.getByTestId('affordance-confirm-order')).toBeOnTheScreen());
        (deviceClient.get as jest.Mock).mockClear();

        await act(async () => {
          fireEvent.press(screen.getByTestId('organizer-sign-out'));
        });

        await waitFor(() => expect(deviceClient.get).toHaveBeenCalledWith('/households/hh-1'));
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        expectParticipantOnly(deviceClient);
      });

      it('paired hub keeps tiles and board after organizer token expiry, without hub-error or sensitive actions', async () => {
        const deviceClient = interactiveClient();
        const base = interactiveClient();
        const clear: { current: () => void } = { current: () => undefined };
        let expired = false;
        // Stands in for the real client: once the organizer token has expired it
        // is rejected, so the client clears the organizer and answers the request
        // as the device.
        const organizerClient: ApiClient = {
          ...base,
          update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) => {
            if (!expired) {
              return base.update(path, body, options);
            }
            clear.current();
            return deviceClient.update(path, body, options);
          }) as unknown as ApiClient['update'],
        };
        useApiClientMock.mockImplementation(() => {
          const { token, clearSession } = useOrganizer();
          clear.current = clearSession;
          return token ? organizerClient : deviceClient;
        });

        await renderHubWithOrganizer(pinProvider());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        await signInWithPin();
        await waitFor(() => expect(screen.getByTestId('affordance-confirm-order')).toBeOnTheScreen());
        (deviceClient.get as jest.Mock).mockClear();

        // The next write after the idle expiry: a participant taps their tile.
        expired = true;
        await pressTile('p1');

        await waitFor(() => expect(screen.queryByTestId('organizer-actions')).toBeNull());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        expectParticipantOnly(deviceClient);
        expect(screen.getByText("Alex's day")).toBeOnTheScreen();
      });
    });

    /**
     * #57: the hub wires only the Confirm order affordance, and it never confirms
     * anything itself - it moves the organizer to the cart's own Confirm button,
     * which keeps the final tap (G4). Edit roster (#167) and Household teardown
     * (#168) have no screen yet, so they are not rendered at all.
     */
    describe('organizer actions (#57)', () => {
      const SENSITIVE = [
        'affordance-edit-roster',
        'affordance-confirm-order',
        'affordance-household-teardown',
      ];

      // The mocked native View shares one `focus` jest.fn across every instance,
      // so each test spies afresh and identifies the target through the call's
      // `this` (mock.contexts).
      let focusSpy: jest.SpyInstance;
      beforeEach(() => {
        focusSpy = jest.spyOn(View.prototype as unknown as { focus: () => void }, 'focus');
        focusSpy.mockClear();
      });
      afterEach(() => {
        focusSpy.mockRestore();
      });

      /** Every POST the hub sent to a cart's confirm endpoint. */
      function confirmCalls(client: ApiClient) {
        return (client.update as jest.Mock).mock.calls.filter(
          ([path]) => typeof path === 'string' && path.endsWith('/confirm'),
        );
      }

      async function signIn() {
        await act(async () => {
          fireEvent.press(screen.getByTestId('organizer-sign-in'));
        });
      }

      it('a signed-in organizer sees Confirm order but no Edit roster or Household teardown', async () => {
        useApiClientMock.mockReturnValue(interactiveClient());

        await renderHubWithOrganizer(fakeProvider());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        await signIn();

        expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen();
        expect(screen.getByTestId('affordance-confirm-order')).toBeOnTheScreen();
        expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();
        expect(screen.queryByTestId('affordance-household-teardown')).toBeNull();
        expect(screen.queryByText('Edit roster')).toBeNull();
        expect(screen.queryByText('Delete household')).toBeNull();
      });

      it('a non-organizer sees no OrganizerBar actions', async () => {
        useApiClientMock.mockReturnValue(interactiveClient());

        await renderHubWithOrganizer(fakeProvider());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

        expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
        expect(screen.queryByTestId('organizer-actions')).toBeNull();
        for (const id of SENSITIVE) {
          expect(screen.queryByTestId(id)).toBeNull();
        }
      });

      it("Confirm order focuses the cart's own Confirm without confirming the order", async () => {
        const client = interactiveClient();
        useApiClientMock.mockReturnValue(client);

        await renderHubWithOrganizer(fakeProvider());
        await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
        await signIn();
        await waitFor(() => expect(screen.getByTestId('grocery-confirm')).toBeOnTheScreen());
        focusSpy.mockClear();

        await act(async () => {
          fireEvent.press(screen.getByTestId('affordance-confirm-order'));
        });

        expect(focusSpy).toHaveBeenCalledTimes(1);
        const target = focusSpy.mock.contexts[0] as { props: { testID?: string } };
        expect(target.props.testID).toBe('grocery-confirm');
        expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
        // Moving focus is all it does: no confirm is sent and the cart's own
        // Confirm button is still there, waiting for the organizer's tap.
        expect(confirmCalls(client)).toHaveLength(0);
        expect(screen.getByTestId('grocery-confirm')).toBeOnTheScreen();
      });

      it('Confirm order only reveals the cart when it has no Confirm to focus', async () => {
        const base = interactiveClient();
        const confirmedWeek: ApiResult<unknown> = {
          ok: false,
          error: { kind: 'http', status: 409, title: 'Confirmed' },
        };
        const client: ApiClient = {
          ...base,
          get: jest.fn(async (path: string, ...rest: unknown[]) =>
            path.includes('/carts/')
              ? confirmedWeek
              : (base.get as unknown as (p: string, ...r: unknown[]) => Promise<ApiResult<unknown>>)(
                  path,
                  ...rest,
                ),
          ) as unknown as ApiClient['get'],
        };
        useApiClientMock.mockReturnValue(client);

        await renderHubWithOrganizer(fakeProvider());
        await waitFor(() =>
          expect(screen.getByTestId('grocery-cart-week-confirmed')).toBeOnTheScreen(),
        );
        await signIn();
        expect(screen.queryByTestId('grocery-confirm')).toBeNull();
        focusSpy.mockClear();

        await act(async () => {
          fireEvent.press(screen.getByTestId('affordance-confirm-order'));
        });

        expect(focusSpy).not.toHaveBeenCalled();
        expect(confirmCalls(client)).toHaveLength(0);
        expect(screen.getByTestId('hub-groceries')).toBeOnTheScreen();
      });
    });
  });
});

describe('revealAndFocus', () => {
  it('scrolls the node into view, then focuses it without a second scroll', () => {
    const order: string[] = [];
    const node = {
      scrollIntoView: jest.fn(() => order.push('scroll')),
      focus: jest.fn(() => order.push('focus')),
    };

    revealAndFocus(node);

    expect(node.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(order).toEqual(['scroll', 'focus']);
  });

  it('tolerates a host with no scrollIntoView or focus', () => {
    expect(() => revealAndFocus(null)).not.toThrow();
    expect(() => revealAndFocus({})).not.toThrow();
    const onlyFocus = { focus: jest.fn() };
    revealAndFocus(onlyFocus);
    expect(onlyFocus.focus).toHaveBeenCalledTimes(1);
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

  afterEach(async () => {
    // Unmount before the stand-in event target goes away: the dataset guard
    // listens for reconnects for as long as the hub is mounted (#100 AC5), so
    // its unsubscribe has to find the stand-in still there.
    await cleanup();
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    for (const restore of reconnectCleanups) {
      restore();
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
    // A cached glance means the API did not answer, so the indicator says Offline
    // even though nothing told the browser it lost its network (O4).
    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Offline/);
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

    const reads = (dataset: boolean) =>
      (client.get as jest.Mock).mock.calls.filter(([path]: [string]) => (path === DATASET_PATH) === dataset)
        .length;
    const readsBefore = reads(false);
    const datasetReadsBefore = reads(true);
    await act(async () => {
      emitOnline();
    });

    // A healthy hub reloads nothing on a reconnect, so a stray `online` cannot
    // start a refetch storm on a device that is on all day. The one read it does
    // make is the dataset guard's (#100 AC5), which checks on every reconnect.
    await waitFor(() => expect(reads(true)).toBe(datasetReadsBefore + 1));
    expect(reads(false)).toBe(readsBefore);
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

/**
 * Epic 60 O4: the sync indicator lives in the hub header, reading the one write
 * queue the shell provides for the household.
 */
describe('HubShell sync indicator', () => {
  type HostNode = {
    props: { testID?: string; style?: unknown };
    parent: HostNode | null;
    children: (HostNode | string)[];
  };

  beforeEach(() => {
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

  /** Whether `node` sits inside the element with `testID`. */
  function isWithin(node: HostNode, testID: string): boolean {
    for (let at: HostNode | null = node.parent; at !== null; at = at.parent) {
      if (at.props.testID === testID) {
        return true;
      }
    }
    return false;
  }

  /**
   * Every way a style could lift an element out of the flow and over its
   * neighbours: absolute/fixed positioning, a stacking order, or a negative
   * margin or offset pulling it onto the region next to it.
   */
  function overlapStyles(node: HostNode): string[] {
    const style = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    const found: string[] = [];
    if (style.position === 'absolute' || style.position === 'fixed') {
      found.push(`position:${String(style.position)}`);
    }
    if (style.zIndex !== undefined) {
      found.push('zIndex');
    }
    for (const key of [
      'margin',
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'marginHorizontal',
      'marginVertical',
      'marginStart',
      'marginEnd',
      'top',
      'bottom',
      'left',
      'right',
      'start',
      'end',
    ]) {
      if (typeof style[key] === 'number' && (style[key] as number) < 0) {
        found.push(key);
      }
    }
    return found;
  }

  it('sync indicator sits in the header flow and overlaps neither the name tiles nor the board (AC5)', async () => {
    useApiClientMock.mockReturnValue(interactiveClient());

    await renderHub();
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

    const indicator = screen.getByTestId('sync-indicator') as unknown as HostNode;
    const shell = screen.getByTestId('hub-shell') as unknown as HostNode;
    const header = screen.getByTestId('hub-header') as unknown as HostNode;
    const tiles = screen.getByTestId('hub-name-tiles') as unknown as HostNode;
    const panel = screen.getByTestId('today-panel') as unknown as HostNode;

    // Inside the header, and not inside either region it must never cover.
    expect(isWithin(indicator, 'hub-header')).toBe(true);
    expect(within(screen.getByTestId('hub-name-tiles')).queryByTestId('sync-indicator')).toBeNull();
    expect(within(screen.getByTestId('today-panel')).queryByTestId('sync-indicator')).toBeNull();

    // In normal flow all the way up to the shell: nothing lifts it (or the
    // regions beside it) out of layout and onto its neighbours.
    const offending: string[] = [];
    for (let at: HostNode | null = indicator; at !== null && at !== shell; at = at.parent) {
      offending.push(...overlapStyles(at).map((s) => `${at?.props.testID ?? 'node'}:${s}`));
    }
    offending.push(...overlapStyles(tiles).map((s) => `hub-name-tiles:${s}`));
    offending.push(...overlapStyles(panel).map((s) => `today-panel:${s}`));
    expect(offending).toEqual([]);

    // ...and the header precedes the tiles, which precede the board, in the
    // shell's own column - so in flow, the header's box ends before theirs begin.
    const order = shell.children.filter((child): child is HostNode => typeof child !== 'string');
    const indexOf = (node: HostNode) => order.indexOf(node);
    expect(indexOf(header)).toBeGreaterThanOrEqual(0);
    expect(indexOf(header)).toBeLessThan(indexOf(tiles));
    expect(indexOf(tiles)).toBeLessThan(indexOf(panel));
  });

  it('hub header shows a queued write from storage and clears it after sync', async () => {
    const week = currentWeekIso();
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-complete',
        dedupeKey: assignmentDedupeKey(week, 'c1'),
        method: 'POST',
        path: `/households/hh-1/assignments/${week}/c1/complete`,
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: 0,
        status: 'pending',
      },
    ]);
    const client = clientWith({
      household: okHousehold('Home'),
      people: { ok: true, status: 200, data: [], etag: null },
    });
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    // One provider, one drain: the queued write replays through the hub's own
    // client exactly once, and the header confirms it.
    await waitFor(() =>
      expect(within(screen.getByTestId('hub-header')).getByTestId('sync-indicator-synced')).toHaveTextContent(
        /All synced\./,
      ),
    );
    expect(readWriteQueue('hh-1')).toEqual([]);
    const completes = (client.update as jest.Mock).mock.calls.filter(([path]: [string]) =>
      path.endsWith('/c1/complete'),
    );
    expect(completes).toHaveLength(1);
    expect(screen.queryByTestId('sync-indicator-pending')).toBeNull();
    // A live shell does no extra household read after a sync - only a degraded
    // one revives on a confirmation.
    const householdReads = (client.get as jest.Mock).mock.calls.filter(
      ([path]: [string]) => path === '/households/hh-1',
    );
    expect(householdReads).toHaveLength(1);
  });

  it('revives the shell when a queued write gets through after an API-only outage (no online event)', async () => {
    jest.useFakeTimers();
    const week = currentWeekIso();
    writeGlance(
      'hh-1',
      { household: { name: 'Cached Home', people: [] } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-complete',
        dedupeKey: assignmentDedupeKey(week, 'c1'),
        method: 'POST',
        path: `/households/hh-1/assignments/${week}/c1/complete`,
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: 0,
        status: 'pending',
      },
    ]);
    // Wifi stays up the whole time: only the API is down, so the browser never
    // fires `online`. The same client throughout, flipped mid-test.
    const api = { down: true };
    const live = clientWith({
      household: okHousehold('Live Home'),
      people: { ok: true, status: 200, data: [], etag: null },
    });
    const client: ApiClient = {
      baseUrl: live.baseUrl,
      get: jest.fn(async (path: string) =>
        api.down ? unreachable : live.get<unknown>(path),
      ) as unknown as ApiClient['get'],
      update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) =>
        api.down ? unreachable : live.update<unknown>(path, body, options),
      ) as unknown as ApiClient['update'],
    };
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    // The outage: cached glance, the write waiting, and the header says Offline.
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Cached Home');
    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Offline/);
    expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/);

    // The API comes back; the queue's backoff retry gets the write through.
    api.down = false;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    // The confirmation revived the shell: live data, no last-known line, Online.
    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Live Home');
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Online/);
    expect(screen.getByTestId('sync-indicator-synced')).toHaveTextContent(/All synced\./);
  });
});

describe('HubShell dataset guard (#100 D7)', () => {
  let restores: (() => void)[] = [];
  let emitOnline: () => void = () => {};

  beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          entries.set(key, value);
        },
        removeItem: (key: string) => {
          entries.delete(key);
        },
      },
      configurable: true,
      writable: true,
    });
    resetSessionFallbackStorage();

    // Stand in for the browser's `online` event.
    restores = [];
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
    restores.push(() => {
      define('addEventListener', original.add);
      define('removeEventListener', original.remove);
    });
    emitOnline = () => {
      for (const listener of Array.from(listeners)) {
        listener();
      }
    };
  });

  afterEach(async () => {
    // Unmount while the stand-in event target is still there (see above).
    await cleanup();
    for (const restore of restores) {
      restore();
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    resetSessionFallbackStorage();
  });

  const week = currentWeekIso();
  const staleTap = {
    kind: 'chore-complete' as const,
    dedupeKey: assignmentDedupeKey(week, 'c1'),
    method: 'POST' as const,
    path: `/households/hh-1/assignments/${week}/c1/complete`,
    body: { personId: 'p1' },
    enqueuedAtMs: 1,
    attempts: 0,
    status: 'pending' as const,
  };

  /** What the hub saw before this boot: a cached glance, a queued tap, and dataset `ds-old`. */
  function seedPreviousSession(): void {
    writeGlance(
      'hh-1',
      { household: { name: 'Stale Home', people: roster } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    saveWriteQueue('hh-1', [staleTap]);
    globalThis.localStorage.setItem('butler.dataset.v1.hh-1', 'ds-old');
  }

  /**
   * A live API (`Live Home`, Alex + Sam) serving `api.datasetId`, or an
   * unreachable one while `api.down`. The same object throughout, so anything
   * that changes mid-test came from the hub, not from a new client.
   */
  function apiClient(api: { down: boolean; datasetId: string }): ApiClient {
    const live = clientWith({
      household: okHousehold('Live Home'),
      people: { ok: true, status: 200, data: roster, etag: null },
    });
    return {
      baseUrl: live.baseUrl,
      get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
        if (api.down) {
          return unreachable;
        }
        if (path === DATASET_PATH) {
          return { ok: true, status: 200, data: { datasetId: api.datasetId }, etag: null };
        }
        return live.get<unknown>(path);
      }) as unknown as ApiClient['get'],
      update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) =>
        api.down ? unreachable : live.update<unknown>(path, body, options),
      ) as unknown as ApiClient['update'],
    };
  }

  const completes = (client: ApiClient) =>
    (client.update as jest.Mock).mock.calls.filter(([path]: [string]) => path.endsWith('/c1/complete'));

  it('holds the hub on the dataset check before rendering the board or draining the queue', async () => {
    seedPreviousSession();
    let answer: (result: ApiResult<unknown>) => void = () => {};
    const live = apiClient({ down: false, datasetId: 'ds-old' });
    const client: ApiClient = {
      ...live,
      get: jest.fn((path: string) =>
        path === DATASET_PATH
          ? new Promise<ApiResult<unknown>>((resolve) => {
              answer = resolve;
            })
          : live.get<unknown>(path),
      ) as unknown as ApiClient['get'],
    };
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    // Only the placeholder: no household read, no board, no cached glance, and
    // the queued tap is not replayed while the check is open.
    expect(screen.getByTestId('hub-dataset-check')).toBeOnTheScreen();
    expect(within(screen.getByTestId('hub-dataset-check')).getByTestId('hub-loading')).toHaveTextContent(
      /Waking up the hub/,
    );
    expect(screen.queryByTestId('hub-shell')).toBeNull();
    expect((client.get as jest.Mock).mock.calls.map(([path]: [string]) => path)).toEqual([DATASET_PATH]);
    expect(client.update).not.toHaveBeenCalled();

    await act(async () => {
      answer({ ok: true, status: 200, data: { datasetId: 'ds-old' }, etag: null });
    });

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Live Home'));
    expect(screen.queryByTestId('hub-dataset-check')).toBeNull();
  });

  it('same dataset: the queued tap replays and the cache is kept', async () => {
    seedPreviousSession();
    const client = apiClient({ down: false, datasetId: 'ds-old' });
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    expect(completes(client)).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Live Home'));
    expect(readGlance('hh-1')?.household?.name).toBe('Live Home');
  });

  it('changed dataset on startup: stale cache gone, live household rendered, stale tap never replayed', async () => {
    seedPreviousSession();
    const client = apiClient({ down: false, datasetId: 'ds-new' });
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Live Home'));
    expect(screen.queryByText('Stale Home')).toBeNull();
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
    // The queue was emptied before anything could drain it: zero /complete sends.
    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(completes(client)).toHaveLength(0);
    expect(screen.queryByTestId('sync-indicator-pending')).toBeNull();
    // The cache now holds only what the new dataset served.
    expect(readGlance('hh-1')?.household?.name).toBe('Live Home');
    expect(globalThis.localStorage.getItem('butler.dataset.v1.hh-1')).toBe('ds-new');
  });

  it('API unreachable at startup: the cached glance renders and the queue is kept', async () => {
    seedPreviousSession();
    const client = apiClient({ down: true, datasetId: 'ds-new' });
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Stale Home'));
    expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/),
    );
    expect(readWriteQueue('hh-1')).toHaveLength(1);
    expect(completes(client)).toHaveLength(0);
    expect(globalThis.localStorage.getItem('butler.dataset.v1.hh-1')).toBe('ds-old');
  });

  it('a reconnect into a changed dataset clears the cache and queue and reloads the hub', async () => {
    seedPreviousSession();
    const api = { down: true, datasetId: 'ds-old' };
    const client = apiClient(api);
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Stale Home'));
    expect(readWriteQueue('hh-1')).toHaveLength(1);

    // The API was reseeded during the outage, then the network returns.
    api.down = false;
    api.datasetId = 'ds-new';
    await act(async () => {
      emitOnline();
    });

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Live Home'));
    expect(screen.queryByTestId('last-known-banner')).toBeNull();
    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(completes(client)).toHaveLength(0);
    expect(readGlance('hh-1')?.household?.name).toBe('Live Home');
  });
});
