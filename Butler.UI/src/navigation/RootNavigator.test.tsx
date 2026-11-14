import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RootNavigator } from './RootNavigator';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider } from '../auth/authProvider';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx; this client's
// writes resolve to nothing, so the real hook would have no result to read.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client whose `get` answers by path: /me, the household read, the roster, rooms, and chores. */
function pathAwareClient(): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.endsWith('/people') || path.endsWith('/rooms') || path.endsWith('/chores')) {
        return { ok: true, status: 200, data: [], etag: null };
      }
      if (path.includes('/insights')) {
        return {
          ok: true,
          status: 200,
          data: {
            windowStartWeekIso: '2026-W29',
            windowEndWeekIso: '2026-W29',
            windowWeeks: 1,
            members: [],
            weeks: [
              {
                weekIso: '2026-W29',
                totalEffort: 0,
                topContributorPersonId: null,
                topContributorShare: 0,
                completions: [],
              },
            ],
            glancesPerDay: [{ date: '2026-07-13', count: 0 }],
            cartsConfirmedPerMonth: [{ month: '2026-07', count: 0 }],
          },
          etag: null,
        };
      }
      if (path === '/me') {
        return { ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null };
      }
      return { ok: true, status: 200, data: { name: 'The Test Household' }, etag: null };
    }) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

/**
 * A client over a mutable people list for the Roster tests (#167): the roster
 * read and the single-person read answer from it, and a PUT or DELETE on a
 * person changes it, so the hub's next roster read sees the change.
 */
function rosterServerClient() {
  let people = [
    { personId: 'p1', displayName: 'Alex', claimColor: null, isChild: false },
    { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
  ];
  const base = pathAwareClient();
  const get = jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
    if (path === '/households/hh-77/people') {
      return { ok: true, status: 200, data: people, etag: null };
    }
    const id = /^\/households\/hh-77\/people\/(\w+)$/.exec(path)?.[1];
    if (id) {
      const person = people.find((p) => p.personId === id)!;
      return { ok: true, status: 200, data: { ...person, role: 'Participant', eTag: `W/"${id}"` }, etag: null };
    }
    return base.get(path);
  });
  const update = jest.fn(
    async (path: string, body: unknown, options?: { method?: string }): Promise<ApiResult<unknown>> => {
      const id = /^\/households\/hh-77\/people\/(\w+)$/.exec(path)?.[1];
      if (id && options?.method === 'DELETE') {
        people = people.filter((p) => p.personId !== id);
        return { ok: true, status: 204, data: undefined, etag: null };
      }
      if (id && options?.method === 'PUT') {
        const next = { personId: id, ...(body as { displayName: string; claimColor: null; isChild: boolean }) };
        people = people.map((p) => (p.personId === id ? next : p));
        return { ok: true, status: 200, data: { ...next, role: 'Participant', eTag: `W/"${id}-2"` }, etag: null };
      }
      // The board's generate: nothing to show.
      return { ok: false, error: { kind: 'network', status: 0, title: 'offline' } };
    },
  );
  const client: ApiClient = {
    baseUrl: base.baseUrl,
    get: get as unknown as ApiClient['get'],
    update: update as unknown as ApiClient['update'],
  };
  return { client, get, update };
}

const organizerAuth: IAuthProvider = {
  kind: 'fake',
  signIn: () =>
    Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
  signOut: () => Promise.resolve(),
};

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('RootNavigator', () => {
  it('routes to the onboarding flow when no household is selected', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());

    await render(
      <HouseholdProvider>
        <RootNavigator />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('step-household')).toBeOnTheScreen());
  });

  it('routes to the Home hub shell once a household is selected', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <RootNavigator />
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Test Household'),
    );
  });

  it('opens the Household screen from the organizer bar', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());
    const authProvider: IAuthProvider = {
      kind: 'fake',
      signIn: () =>
        Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
      signOut: () => Promise.resolve(),
    };

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={authProvider}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('affordance-edit-household'));
    });

    expect(await screen.findByTestId('household-editor')).toBeOnTheScreen();
  });

  it('opens the Insights screen from the organizer bar', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());
    const authProvider: IAuthProvider = {
      kind: 'fake',
      signIn: () =>
        Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
      signOut: () => Promise.resolve(),
    };

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={authProvider}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('affordance-insights'));
    });

    expect(await screen.findByTestId('insights-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('insights-chart-top-share')).toBeOnTheScreen();
  });

  it('opens the Your data page from the organizer bar', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());
    const authProvider: IAuthProvider = {
      kind: 'fake',
      signIn: () =>
        Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
      signOut: () => Promise.resolve(),
    };

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={authProvider}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('affordance-your-data'));
    });

    expect(await screen.findByTestId('your-data-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('your-data-stored')).toBeOnTheScreen();
  });

  it('opens the Roster screen from the organizer bar', async () => {
    const { client } = rosterServerClient();
    useApiClientMock.mockReturnValue(client);

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={organizerAuth}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await press('organizer-sign-in');
    await press('affordance-edit-roster');

    expect(await screen.findByTestId('roster-editor')).toBeOnTheScreen();
    expect(await screen.findByTestId('roster-person-p1')).toBeOnTheScreen();
  });

  it('shows roster changes on the hub after leaving the Roster screen', async () => {
    const { client, get } = rosterServerClient();
    useApiClientMock.mockReturnValue(client);
    const rosterReads = () =>
      get.mock.calls.filter(([path]) => path === '/households/hh-77/people').length;

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={organizerAuth}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('name-tile-p2')).toBeOnTheScreen();
    // The first focus on mount does not double the hub's initial load.
    expect(rosterReads()).toBe(1);
    await press('organizer-sign-in');
    await press('affordance-edit-roster');
    expect(await screen.findByTestId('roster-person-p2')).toBeOnTheScreen();

    // Rename Alex and remove Sam.
    await press('roster-edit-p1');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('input-person-name'), 'Alexis');
    });
    await press('roster-form-save');
    await press('roster-remove-p2');
    await press('roster-remove-confirm-p2');
    expect(screen.queryByTestId('roster-person-p2')).toBeNull();

    await press('roster-done');

    await waitFor(() => expect(screen.queryByTestId('roster-editor')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('name-tile-p2')).toBeNull());
    expect(screen.getByTestId('name-tile-p1')).toHaveTextContent('Alexis');
    expect(screen.queryByTestId('hub-loading')).toBeNull();
  });
});
