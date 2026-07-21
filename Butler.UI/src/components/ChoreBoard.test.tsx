import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ChoreBoard } from './ChoreBoard';
import type { ApiClient, ApiResult } from '../api/client';
import type {
  AssignmentView,
  ChoreResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const WEEK = '2026-W29';

const roster: RosterEntryResponse[] = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
  { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
];

// c1/c3 are daily -> "Today"; c2/c4 are weekly -> "This week".
const chores: ChoreResponse[] = [
  { choreId: 'c1', title: 'Dishes', roomId: 'r1', cadence: 'Daily', effort: 1, minAge: null, active: true, etag: 'e1' },
  { choreId: 'c2', title: 'Vacuum', roomId: 'r1', cadence: 'Weekly', effort: 2, minAge: null, active: true, etag: 'e2' },
  { choreId: 'c3', title: 'Trash', roomId: 'r1', cadence: 'Daily', effort: 1, minAge: null, active: true, etag: 'e3' },
  { choreId: 'c4', title: 'Laundry', roomId: 'r1', cadence: 'Weekly', effort: 3, minAge: null, active: true, etag: 'e4' },
];

const assignments: AssignmentView[] = [
  { choreId: 'c1', assignedPersonId: 'p1', effort: 1, status: 'Open' }, // Today / Alex
  { choreId: 'c3', assignedPersonId: 'p2', effort: 1, status: 'Open' }, // Today / Sam
  { choreId: 'c2', assignedPersonId: 'p2', effort: 2, status: 'Open' }, // This week / Sam
  { choreId: 'c4', assignedPersonId: 'p1', effort: 3, status: 'Done' }, // This week / Alex (already done)
];

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, etag: null });

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

type ClientOpts = {
  assignments?: AssignmentView[];
  chores?: ChoreResponse[];
  generate?: ApiResult<unknown>;
  choresResult?: ApiResult<unknown>;
  complete?: (choreId: string) => ApiResult<unknown>;
};

/**
 * A client that answers the three calls the board makes: the C3 generate (an
 * update), the open chores read (a get), and the C4 complete (an update). Each is
 * overridable so a test can force an empty set, a failure, or a specific
 * completion result.
 */
function boardClient(opts: ClientOpts = {}): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.includes('/chores')) {
        return opts.choresResult ?? ok(opts.chores ?? chores);
      }
      return ok([]);
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.endsWith('/generate')) {
        return (
          opts.generate ??
          ok({ weekIso: WEEK, assignments: opts.assignments ?? assignments, unassigned: [] })
        );
      }
      // A complete: `.../assignments/{week}/{choreId}/complete`.
      const choreId = /assignments\/[^/]+\/([^/]+)\/complete$/.exec(path)?.[1] ?? '';
      if (opts.complete) {
        return opts.complete(choreId);
      }
      return ok({ weekIso: WEEK, choreId, assignedPersonId: '', status: 'Done' });
    }) as unknown as ApiClient['update'],
  };
}

async function renderBoard(
  client: ApiClient,
  { activePersonId = null, people = roster }: { activePersonId?: string | null; people?: RosterEntryResponse[] } = {},
) {
  useApiClientMock.mockReturnValue(client);
  return render(
    <ChoreBoard householdId="hh-1" people={people} activePersonId={activePersonId} />,
  );
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('ChoreBoard', () => {
  it('render-grouped-board: assignments appear grouped by day and by person', async () => {
    await renderBoard(boardClient());

    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());

    const today = within(screen.getByTestId('chore-board-day-today'));
    const thisWeek = within(screen.getByTestId('chore-board-day-this-week'));

    // Day grouping: daily chores under Today, weekly under This week - and not
    // the other way around.
    expect(today.getByTestId('chore-item-c1')).toBeOnTheScreen();
    expect(today.getByTestId('chore-item-c3')).toBeOnTheScreen();
    expect(today.queryByTestId('chore-item-c2')).toBeNull();
    expect(thisWeek.getByTestId('chore-item-c2')).toBeOnTheScreen();
    expect(thisWeek.getByTestId('chore-item-c4')).toBeOnTheScreen();
    expect(thisWeek.queryByTestId('chore-item-c1')).toBeNull();

    // Person grouping within a day: Alex owns c1, Sam owns c3 (both Today).
    expect(
      within(screen.getByTestId('chore-board-person-today-p1')).getByTestId('chore-item-c1'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('chore-board-person-today-p2')).getByTestId('chore-item-c3'),
    ).toBeOnTheScreen();

    // Titles are joined from the chores read, not raw ids.
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.getByText('Vacuum')).toBeOnTheScreen();

    // A preserved-Done assignment renders in its distinct completed state.
    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('✓');
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.checked).toBe(true);
  });

  it('focus-on-select: only the active person\'s items render, and they glow', async () => {
    await renderBoard(boardClient(), { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    // Alex is active: the board focuses on them. Their items render and glow...
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.selected).toBe(true);
    // ...and Sam's items (c3 Today, c2 This week) are filtered out entirely, not
    // merely un-highlighted.
    expect(screen.queryByTestId('chore-item-c3')).toBeNull();
    expect(screen.queryByTestId('chore-item-c2')).toBeNull();
    expect(screen.queryByTestId('chore-board-person-today-p2')).toBeNull();
  });

  it('full-board-when-none: every person\'s items render when no participant is active', async () => {
    await renderBoard(boardClient(), { activePersonId: null });

    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());

    // The full household glance: both Alex's and Sam's items are present.
    expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen(); // Alex / Today
    expect(screen.getByTestId('chore-item-c3')).toBeOnTheScreen(); // Sam / Today
    expect(screen.getByTestId('chore-item-c2')).toBeOnTheScreen(); // Sam / This week
    expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen(); // Alex / This week
    expect(screen.getByTestId('chore-board-person-today-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('chore-board-person-today-p2')).toBeOnTheScreen();
  });

  it('switch-refocuses: changing the active person changes which items show', async () => {
    useApiClientMock.mockReturnValue(boardClient());
    const view = await render(
      <ChoreBoard householdId="hh-1" people={roster} activePersonId="p1" />,
    );

    // Focused on Alex: their items show, Sam's do not.
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-item-c3')).toBeNull();

    // Tapping a different tile re-focuses on Sam (no refetch): now Sam's items
    // show and Alex's are gone.
    await view.rerender(<ChoreBoard householdId="hh-1" people={roster} activePersonId="p2" />);
    await waitFor(() => expect(screen.getByTestId('chore-item-c3')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c2')).toBeOnTheScreen();
    expect(screen.queryByTestId('chore-item-c1')).toBeNull();
    expect(screen.queryByTestId('chore-item-c4')).toBeNull();

    // Clearing the selection (idle-reset -> null) restores the full household.
    await view.rerender(<ChoreBoard householdId="hh-1" people={roster} activePersonId={null} />);
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c3')).toBeOnTheScreen();
  });

  it('renders read-only with nothing highlighted when there is no active participant', async () => {
    const client = boardClient();
    await renderBoard(client, { activePersonId: null });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.selected).toBe(false);

    // A tap does nothing: no complete is sent (the board is read-only).
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    const completeCalls = (client.update as jest.Mock).mock.calls.filter(([p]) =>
      String(p).endsWith('/complete'),
    );
    expect(completeCalls).toHaveLength(0);
  });

  it('tap-marks-done: tapping calls the mocked C4 client and the item moves to completed', async () => {
    const client = boardClient();
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○');

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // The C4 endpoint was called for this week + chore, attributed to the active
    // participant.
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/assignments/2026-W29/c1/complete',
      { personId: 'p1' },
      { method: 'POST' },
    );
    // The item is now in the completed state.
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓'),
    );
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(true);
  });

  it('applies the completed state optimistically and reverts it when the write fails', async () => {
    let resolveComplete: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      resolveComplete = resolve;
    });
    const client: ApiClient = {
      ...boardClient(),
      update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
        if (path.endsWith('/generate')) {
          return ok({ weekIso: WEEK, assignments, unassigned: [] });
        }
        return pending;
      }) as unknown as ApiClient['update'],
    };
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    // The optimistic flip shows Done immediately, before the write resolves.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(true);

    // The write fails; the item reverts to open rather than lying about success.
    await act(async () => {
      resolveComplete(unreachable);
      await pending;
    });
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○'),
    );
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(false);
  });

  it('reconciles back to open when the server does not confirm Done', async () => {
    const client = boardClient({
      complete: () => ok({ weekIso: WEEK, choreId: 'c1', assignedPersonId: 'p1', status: 'Open' }),
    });
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○'),
    );
  });

  it('treats a completion write that returns no body as unconfirmed and reverts', async () => {
    const client = boardClient({
      complete: () => ({ ok: true, status: 200, data: undefined, etag: null }),
    });
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○'),
    );
  });

  it('treats an undefined completion result as a failure and reverts', async () => {
    const client: ApiClient = {
      ...boardClient(),
      update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
        if (path.endsWith('/generate')) {
          return ok({ weekIso: WEEK, assignments, unassigned: [] });
        }
        return undefined as unknown as ApiResult<unknown>;
      }) as unknown as ApiClient['update'],
    };
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○'),
    );
  });

  it('does not re-submit an already-completed item (C4 idempotency)', async () => {
    const client = boardClient();
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    // Complete c1 once.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓'),
    );

    const before = (client.update as jest.Mock).mock.calls.filter(([p]) =>
      String(p).endsWith('/c1/complete'),
    ).length;

    // Tapping the now-done item again is a no-op: no second complete goes out.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    const after = (client.update as jest.Mock).mock.calls.filter(([p]) =>
      String(p).endsWith('/c1/complete'),
    ).length;
    expect(after).toBe(before);
  });

  it('shows the loading state until the reads resolve', async () => {
    let resolveGen: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      resolveGen = resolve;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => ok(chores)) as unknown as ApiClient['get'],
      update: jest.fn(async () => pending) as unknown as ApiClient['update'],
    };
    await renderBoard(client, { activePersonId: 'p1' });

    expect(screen.getByTestId('chore-board-loading')).toBeOnTheScreen();

    await act(async () => {
      resolveGen(ok({ weekIso: WEEK, assignments, unassigned: [] }));
      await pending;
    });

    await waitFor(() => expect(screen.queryByTestId('chore-board-loading')).toBeNull());
    expect(screen.getByTestId('chore-board')).toBeOnTheScreen();
  });

  it('ignores reads that resolve after the board unmounts', async () => {
    let resolveGen: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      resolveGen = resolve;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => ok(chores)) as unknown as ApiClient['get'],
      update: jest.fn(async () => pending) as unknown as ApiClient['update'],
    };
    const view = await renderBoard(client, { activePersonId: 'p1' });

    await act(async () => {
      view.unmount();
    });

    // The read resolving after unmount must not set state on the gone component.
    await act(async () => {
      resolveGen(ok({ weekIso: WEEK, assignments, unassigned: [] }));
      await pending;
    });

    expect(screen.queryByTestId('chore-board')).toBeNull();
  });

  it('shows a calm empty state when nothing is assigned', async () => {
    await renderBoard(boardClient({ assignments: [] }));

    await waitFor(() => expect(screen.getByTestId('chore-board-empty')).toBeOnTheScreen());
  });

  it('treats a generate response with no body as an empty board', async () => {
    await renderBoard(boardClient({ generate: { ok: true, status: 200, data: undefined, etag: null } }));

    await waitFor(() => expect(screen.getByTestId('chore-board-empty')).toBeOnTheScreen());
  });

  it('surfaces a calm error when the assignment read fails', async () => {
    await renderBoard(boardClient({ generate: unreachable }));

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-board-error')).toHaveTextContent(/unreachable/);
  });

  it('surfaces a calm error when the assignment read returns nothing', async () => {
    const client: ApiClient = {
      ...boardClient(),
      update: jest.fn(async () => undefined as unknown as ApiResult<unknown>) as unknown as ApiClient['update'],
    };
    await renderBoard(client);

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-board-error')).toHaveTextContent(/unavailable/);
  });

  it('surfaces a calm error when the chores read fails', async () => {
    await renderBoard(boardClient({ choresResult: unreachable }));

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
  });

  it('surfaces a calm error when the chores read returns nothing', async () => {
    const client: ApiClient = {
      ...boardClient(),
      get: jest.fn(async () => undefined as unknown as ApiResult<unknown>) as unknown as ApiClient['get'],
    };
    await renderBoard(client);

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-board-error')).toHaveTextContent(/unavailable/);
  });

  it('falls back to the chore id and a weekly bucket when a chore is missing', async () => {
    await renderBoard(
      boardClient({
        assignments: [{ choreId: 'ghost', assignedPersonId: 'p1', effort: 1, status: 'Open' }],
        chores: [],
      }),
    );

    await waitFor(() => expect(screen.getByTestId('chore-item-ghost')).toBeOnTheScreen());
    // No title from the chores read, so the id stands in, under This week.
    expect(screen.getByText('ghost')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('chore-board-day-this-week')).getByTestId('chore-item-ghost'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('chore-board-day-today')).toBeNull();
  });

  it('renders with id fallbacks when the chores read succeeds with no body', async () => {
    await renderBoard(
      boardClient({
        assignments: [{ choreId: 'c1', assignedPersonId: 'p1', effort: 1, status: 'Open' }],
        choresResult: { ok: true, status: 200, data: undefined, etag: null },
      }),
    );

    // No chore metadata at all: the item still renders, under This week, by id.
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(
      within(screen.getByTestId('chore-board-day-this-week')).getByTestId('chore-item-c1'),
    ).toBeOnTheScreen();
  });

  it('renders an unknown assignee by id, after the known roster', async () => {
    await renderBoard(
      boardClient({
        assignments: [
          { choreId: 'c1', assignedPersonId: 'p1', effort: 1, status: 'Open' },
          { choreId: 'c3', assignedPersonId: 'stranger', effort: 1, status: 'Open' },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByTestId('chore-board-person-today-stranger')).toBeOnTheScreen());
    expect(screen.getByText('stranger')).toBeOnTheScreen();
  });
});
