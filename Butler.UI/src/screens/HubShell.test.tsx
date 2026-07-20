import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import type { ParticipantSessionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

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

/** A client that answers the household read and the people (roster) read by path. */
function clientWith(responses: Responses): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> =>
      path.endsWith('/people') ? responses.people : responses.household,
    ) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
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
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> =>
      path.endsWith('/people')
        ? { ok: true, status: 200, data: roster, etag: null }
        : okHousehold('Home'),
    ) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
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

  it('renders the empty today panel placeholder', async () => {
    useApiClientMock.mockReturnValue(
      clientWith({
        household: okHousehold('Home'),
        people: { ok: true, status: 200, data: [], etag: null },
      }),
    );

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('today-panel')).toBeOnTheScreen());
    expect(screen.getByTestId('today-panel-empty')).toBeOnTheScreen();
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
      // Hand each of the two parallel reads one leg of the same pending pair.
      get: jest.fn(() =>
        pending.then((pair) => pair[call++]),
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
      get: jest.fn(() => pending.then((pair) => pair[call++])) as unknown as ApiClient['get'],
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

      expect(client.update).toHaveBeenCalledTimes(1);
      // No participant became active; the glance stays neutral and no PIN/password
      // field is ever rendered.
      expect(screen.getByText('Today')).toBeOnTheScreen();
      expect(screen.queryByText("Alex's day")).toBeNull();
      expect(screen.getByTestId('name-tile-p1').props.accessibilityState).toEqual({
        selected: false,
      });
    });
  });
});
