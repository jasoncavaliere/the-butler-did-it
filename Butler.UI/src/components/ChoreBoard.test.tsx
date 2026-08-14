import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ChoreBoard, describeFailure } from './ChoreBoard';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type {
  AssignmentView,
  ChoreResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { readGlance, writeGlance, type GlanceStorage } from '../offline/glanceCache';

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
  undo?: (choreId: string) => ApiResult<unknown>;
};

/**
 * A client that answers the calls the board makes: the C3 generate (an update),
 * the open chores read (a get), the C4 complete (an update), and its undo (an
 * update). Each write is overridable so a test can force an empty set, a failure,
 * or a specific completion / reversal result. By default a complete confirms
 * `Done` and an undo confirms `Open`.
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
      // An undo: `.../assignments/{week}/{choreId}/undo` (checked first so the
      // complete matcher below cannot swallow it).
      const undoChoreId = /assignments\/[^/]+\/([^/]+)\/undo$/.exec(path)?.[1];
      if (undoChoreId !== undefined) {
        if (opts.undo) {
          return opts.undo(undoChoreId);
        }
        return ok({ weekIso: WEEK, choreId: undoChoreId, assignedPersonId: '', status: 'Open' });
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

  it('does not re-submit an already-completed item (a second tap undoes, never re-completes)', async () => {
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

    const completesBefore = (client.update as jest.Mock).mock.calls.filter(([p]) =>
      String(p).endsWith('/c1/complete'),
    ).length;

    // Tapping the now-done item again reverses it (undo) rather than firing a
    // second complete - a completed chore is never re-submitted.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    const completesAfter = (client.update as jest.Mock).mock.calls.filter(([p]) =>
      String(p).endsWith('/c1/complete'),
    ).length;
    expect(completesAfter).toBe(completesBefore);
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/assignments/2026-W29/c1/undo',
      { personId: 'p1' },
      { method: 'POST' },
    );
  });

  it('tap-completed-item-undoes: tapping a Done item calls the undo endpoint and it returns to open', async () => {
    // c4 is a pre-existing Done item assigned to the active participant (Alex/p1),
    // so it is visible under the focused board and starts checked.
    const client = boardClient();
    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('✓');

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c4'));
    });

    // The undo endpoint was called for this week + chore, attributed to the active
    // participant - never the complete endpoint.
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/assignments/2026-W29/c4/undo',
      { personId: 'p1' },
      { method: 'POST' },
    );
    expect(client.update).not.toHaveBeenCalledWith(
      '/households/hh-1/assignments/2026-W29/c4/complete',
      expect.anything(),
      expect.anything(),
    );

    // The item returns to the open visual state.
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('○'),
    );
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.checked).toBe(false);
  });

  it('applies the undone state optimistically and reverts it to Done when the write fails', async () => {
    let resolveUndo: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      resolveUndo = resolve;
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

    // c4 starts Done (✓) for the active participant.
    await waitFor(() => expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.checked).toBe(true);

    // The optimistic flip shows Open immediately, before the write resolves.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c4'));
    });
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.checked).toBe(false);

    // The undo write fails; the item reverts to Done rather than lying about the
    // reversal.
    await act(async () => {
      resolveUndo(unreachable);
      await pending;
    });
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('✓'),
    );
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.checked).toBe(true);
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

/**
 * Epic 60 O2: the board's read path falls back to the last-known week when the
 * API is unreachable, and refreshes that cache on every successful load.
 */
describe('ChoreBoard offline cache', () => {
  let entries = new Map<string, string>();

  /** An in-memory stand-in for the browser storage the cache writes to. */
  function installStorage(): Map<string, string> {
    const map = new Map<string, string>();
    const storage: GlanceStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    return map;
  }

  beforeEach(() => {
    entries = installStorage();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  const cachedBoard = {
    weekIso: WEEK,
    items: [
      { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' as const },
      { choreId: 'c2', title: 'Vacuum', cadence: 'Weekly', assignedPersonId: 'p2', status: 'Done' as const },
    ],
  };

  it('cache-write-on-successful-load: a live load caches the built week', async () => {
    await renderBoard(boardClient());

    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());

    expect(readGlance('hh-1')?.board).toEqual({
      weekIso: WEEK,
      items: [
        { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' },
        { choreId: 'c3', title: 'Trash', cadence: 'Daily', assignedPersonId: 'p2', status: 'Open' },
        { choreId: 'c2', title: 'Vacuum', cadence: 'Weekly', assignedPersonId: 'p2', status: 'Open' },
        { choreId: 'c4', title: 'Laundry', cadence: 'Weekly', assignedPersonId: 'p1', status: 'Done' },
      ],
    });
  });

  it('render-from-cache-when-offline: the assignment read being unreachable shows the last-known week', async () => {
    writeGlance('hh-1', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');
    const onLastKnown = jest.fn();
    useApiClientMock.mockReturnValue(boardClient({ generate: unreachable }));

    await render(
      <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
    );

    // The real board, not an error line: cached titles, grouped by day.
    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-board-error')).toBeNull();
    expect(
      within(screen.getByTestId('chore-board-day-today')).getByTestId('chore-item-c1'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('chore-board-day-this-week')).getByTestId('chore-item-c2'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    // ...and the freshness stamp is reported up so the hub can mark it last-known.
    expect(onLastKnown).toHaveBeenCalledWith('2026-07-20T09:00:00.000Z');
  });

  it('render-from-cache-when-offline: the chores read being unreachable shows the last-known week', async () => {
    writeGlance('hh-1', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(boardClient({ choresResult: unreachable }));

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-board-error')).toBeNull();
  });

  it('reports a live load as not-last-known, clearing the indication', async () => {
    writeGlance('hh-1', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');
    const onLastKnown = jest.fn();
    useApiClientMock.mockReturnValue(boardClient());

    await render(
      <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
    );

    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());
    expect(onLastKnown).toHaveBeenCalledWith(null);
  });

  it('keeps the error state for a reachable service that fails, cache or not', async () => {
    writeGlance('hh-1', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');
    const onLastKnown = jest.fn();
    const serverError: ApiResult<never> = {
      ok: false,
      error: { kind: 'problem', status: 500, title: 'Server error', detail: 'The week could not be built.' },
    };
    useApiClientMock.mockReturnValue(boardClient({ generate: serverError }));

    await render(
      <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
    );

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-board-error')).toHaveTextContent(/could not be built/);
    expect(onLastKnown).toHaveBeenCalledWith(null);
  });

  it('falls through to the error state when the cache holds no board', async () => {
    // Only the shell's half has ever been cached for this household.
    writeGlance(
      'hh-1',
      { household: { name: 'Home', people: roster } },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );

    await renderBoard(boardClient({ generate: unreachable }));

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
  });

  it('does not serve another household from cache', async () => {
    writeGlance('hh-2', { board: cachedBoard }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(boardClient({ generate: unreachable }));

    // hh-1 has no cache of its own, and hh-2's is never borrowed.
    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
  });

  it('falls through to the error state when the cached board is malformed', async () => {
    // A hand-edited or schema-skewed entry: the item rows are not rows at all.
    // Serving it would put junk into the render and throw, so it reads as no cache.
    entries.set(
      'butler.glance.v1.hh-1',
      JSON.stringify({
        householdId: 'hh-1',
        cachedAtIso: '2026-07-20T09:00:00.000Z',
        household: null,
        board: { weekIso: WEEK, items: ['Dishes', 'Vacuum'] },
      }),
    );

    await renderBoard(boardClient({ generate: unreachable }));

    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-board')).toBeNull();
  });
});

/**
 * Epic 60 O2, the write half of the read cache: a board served from cache is a
 * display, not a control - and it comes back to life on a reconnect rather than
 * waiting for someone to reload a wall tablet.
 */
describe('ChoreBoard cached board is read-only until the network returns', () => {
  let reconnectCleanups: (() => void)[] = [];

  function installStorage(): void {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      } satisfies GlanceStorage,
      configurable: true,
      writable: true,
    });
  }

  /** See the sibling block: stands in for the browser's `online` event. */
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
  });

  // Deliberately a *different* week from the live `WEEK`: this is the outage that
  // spanned a week boundary, which is what makes a tap on a cached row dangerous.
  const STALE_WEEK = '2026-W28';

  const staleBoard = {
    weekIso: STALE_WEEK,
    items: [
      { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' as const },
    ],
  };

  /** Every write the board could make, whatever the week or the direction. */
  const writesFrom = (client: ApiClient) =>
    (client.update as jest.Mock).mock.calls.filter(([path]) => {
      const p = String(path);
      return p.endsWith('/complete') || p.endsWith('/undo');
    });

  /**
   * A client that answers like a live one, or fails like an unreachable API,
   * depending on `state.offline` - flipped mid-test to simulate the network
   * returning *without* changing the client's identity, so the refetch under test
   * can only have come from the reconnect signal.
   */
  function flippableClient(state: { offline: boolean }): ApiClient {
    const live = boardClient();
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

  it('stale-week-guard: a tap on the last-known board writes nothing', async () => {
    writeGlance('hh-1', { board: staleBoard }, undefined, '2026-07-20T09:00:00.000Z');
    const client = boardClient({ generate: unreachable });

    // A participant is active, so on a *live* board this tap would complete c1.
    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // No completion is sent at all - not to the stale week, not to any week. The
    // API resolves a completion by (householdId, weekIso, choreId) with no
    // current-week check, so a write from here would silently land on last week.
    expect(writesFrom(client)).toHaveLength(0);
    // And the row does not lie about having been completed, optimistically or not.
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○');
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(false);
  });

  it('marks every cached row inert, so it reads as a display and not a control', async () => {
    writeGlance('hh-1', { board: staleBoard }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(boardClient({ generate: unreachable }), { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true);
  });

  it('a cached Done row cannot be undone either', async () => {
    writeGlance(
      'hh-1',
      {
        board: {
          weekIso: STALE_WEEK,
          items: [
            { choreId: 'c4', title: 'Laundry', cadence: 'Weekly', assignedPersonId: 'p1', status: 'Done' },
          ],
        },
      },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );
    const client = boardClient({ generate: unreachable });

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c4'));
    });

    expect(writesFrom(client)).toHaveLength(0);
    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('✓');
  });

  it('reconnect-refetches: an online event brings the board back live and tappable', async () => {
    writeGlance('hh-1', { board: staleBoard }, undefined, '2026-07-20T09:00:00.000Z');
    const emitOnline = installReconnect();
    const state = { offline: true };
    const client = flippableClient(state);

    await renderBoard(client, { activePersonId: 'p1' });

    // Offline: the stale week is on screen, from cache, and inert.
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('chore-item-c3')).toBeNull();

    // The network returns. Nobody touches the tablet - the `online` event alone
    // has to refetch (the client object is the same one, so nothing else could).
    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    // The live week replaced the cached one...
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false),
    );
    expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen();
    // ...the cache now holds the live week under a newer stamp...
    const refreshed = readGlance('hh-1');
    expect(refreshed?.board?.weekIso).toBe(WEEK);
    expect(Date.parse(refreshed?.cachedAtIso ?? '')).toBeGreaterThan(
      Date.parse('2026-07-20T09:00:00.000Z'),
    );

    // ...and a tap now writes, against the live week rather than the stale one.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    expect(client.update).toHaveBeenCalledWith(
      `/households/hh-1/assignments/${WEEK}/c1/complete`,
      { personId: 'p1' },
      { method: 'POST' },
    );
    expect(client.update).not.toHaveBeenCalledWith(
      `/households/hh-1/assignments/${STALE_WEEK}/c1/complete`,
      expect.anything(),
      expect.anything(),
    );
  });

  it('reconnect-refetches: an online event recovers a board that had no cache to show', async () => {
    const emitOnline = installReconnect();
    const state = { offline: true };
    const client = flippableClient(state);

    await renderBoard(client, { activePersonId: 'p1' });

    // Nothing cached, so the outage is the plain error line.
    await waitFor(() => expect(screen.getByTestId('chore-board-error')).toBeOnTheScreen());

    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    // The board recovers on its own instead of holding the error until a reload.
    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-board-error')).toBeNull();
  });

  it('does not listen for a reconnect while the board is live', async () => {
    const emitOnline = installReconnect();
    const client = boardClient();

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-board')).toBeOnTheScreen());

    const readsBefore = (client.update as jest.Mock).mock.calls.length;
    await act(async () => {
      emitOnline();
    });

    // A healthy board subscribes to nothing, so a stray reconnect cannot start a
    // refetch storm on the wall.
    expect((client.update as jest.Mock).mock.calls.length).toBe(readsBefore);
  });
});

describe('describeFailure', () => {
  it('marks only an unreachable API as offline', () => {
    expect(describeFailure(unreachable)).toEqual({
      message: expect.stringContaining('unreachable'),
      offline: true,
    });
    expect(
      describeFailure({ ok: false, error: { kind: 'http', status: 503, title: 'Unavailable' } }),
    ).toEqual({ message: 'Unavailable', offline: false });
  });

  it('describes a result that never arrived, and never claims a success failed offline', () => {
    expect(describeFailure(undefined)).toEqual({ message: 'The board is unavailable.', offline: false });
    expect(describeFailure(ok({}))).toEqual({ message: 'The board is unavailable.', offline: false });
  });
});
