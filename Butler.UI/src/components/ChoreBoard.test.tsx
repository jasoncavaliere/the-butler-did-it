import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ChoreBoard, applyQueuedWrites, describeFailure, type BoardItem } from './ChoreBoard';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type {
  AssignmentView,
  ChoreResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { readGlance, writeGlance, type GlanceStorage } from '../offline/glanceCache';
import { currentWeekIso } from '../offline/weekIso';
import {
  MAX_WRITE_ATTEMPTS,
  assignmentDedupeKey,
  readWriteQueue,
  saveWriteQueue,
} from '../offline/writeQueue';

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

/**
 * A reachable service answering with a real error. The board treats this as a
 * refusal rather than an outage: it reverts an optimistic flip and never queues,
 * which is what separates it from {@link unreachable} (Epic 60 O3).
 */
const refused: ApiResult<never> = {
  ok: false,
  error: { kind: 'http', status: 409, title: 'That chore is already claimed.' },
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

  it('applies the completed state optimistically and reverts it when the service refuses it', async () => {
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

    // The service answers with a real error - a refusal, not an outage - so the
    // item reverts to open rather than lying about success. (An *unreachable*
    // API is the other case entirely: that one queues, see the O3 block below.)
    await act(async () => {
      resolveComplete(refused);
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

  it('applies the undone state optimistically and reverts it to Done when the service refuses it', async () => {
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

    // The service refuses the undo; the item reverts to Done rather than lying
    // about the reversal.
    await act(async () => {
      resolveUndo(refused);
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
 * Epic 60 O2/O3, the write half of the read cache: a cached board whose week has
 * rolled over is a display, not a control (queuing that write would land it in
 * last week) - and it comes back to life on a reconnect rather than waiting for
 * someone to reload a wall tablet.
 */
describe('ChoreBoard cached board across a week boundary', () => {
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

  // A week that is *permanently* in the past, so the guard under test is judged
  // against the real calendar without the suite itself becoming clock-dependent.
  // This is the outage that spanned a week boundary, which is what makes a tap on
  // a cached row dangerous: the API resolves a completion by the week it is given.
  const STALE_WEEK = '2019-W01';

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

/**
 * Epic 60 O3: BRD 6.5 step 2 - "Maya taps a chore done; the write queues locally
 * and syncs when the network returns." The tap has to succeed with no network,
 * survive the reload that may follow it, and land on the API in order once the
 * hub is back.
 */
describe('ChoreBoard offline write queue', () => {
  let restore: (() => void)[] = [];

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
    restore.push(() => {
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
    restore = [];
    installStorage();
  });

  afterEach(() => {
    for (const cleanup of restore) {
      cleanup();
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  // The cached week the hub is actually in - the case an offline tap is allowed
  // to write into, as opposed to the rolled-over week the sibling block covers.
  const thisWeek = currentWeekIso();

  const cachedThisWeek = {
    weekIso: thisWeek,
    items: [
      { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' as const },
      { choreId: 'c4', title: 'Laundry', cadence: 'Weekly', assignedPersonId: 'p1', status: 'Done' as const },
    ],
  };

  const completePath = (week: string, choreId: string) =>
    `/households/hh-1/assignments/${week}/${choreId}/complete`;

  /** A client for which nothing at all is reachable - the tablet is offline. */
  function offlineClient(): ApiClient {
    return {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => unreachable) as unknown as ApiClient['get'],
      update: jest.fn(async () => unreachable) as unknown as ApiClient['update'],
    };
  }

  it('offline-tap-queues: a tap on the last-known board is durable and shows done at once', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(offlineClient(), { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    // The cached board is a control again, not a display, while its week is ours.
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // The flip is immediate - the family sees done, with no network involved...
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(true);
    // ...and the write is in storage, so a reload or relaunch still has it.
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    expect(readWriteQueue('hh-1')[0]).toMatchObject({
      kind: 'chore-complete',
      method: 'POST',
      path: completePath(thisWeek, 'c1'),
      body: { personId: 'p1' },
      status: 'pending',
    });
  });

  it('offline-tap-queues: an undo on the last-known board queues the same way', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(offlineClient(), { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c4'));
    });

    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('○');
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    expect(readWriteQueue('hh-1')[0]).toMatchObject({
      kind: 'chore-undo',
      path: `/households/hh-1/assignments/${thisWeek}/c4/undo`,
    });
  });

  it('de-duplicates a double tap into one queued write', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');

    await renderBoard(offlineClient(), { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // Two taps on one chore leave one write - the undo, which is what the second
    // tap meant. The server's own idempotency is the backstop, not the mechanism.
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    expect(readWriteQueue('hh-1')[0].kind).toBe('chore-undo');
  });

  it('a live tap that finds the network gone is queued, not reverted', async () => {
    // The board loaded fine and the network dropped before the tap landed. That is
    // the same situation arriving a moment later, so it queues - reverting would
    // tell the family their tap was lost when it is sitting in a durable queue.
    const client = boardClient({ complete: () => unreachable });

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    expect(readWriteQueue('hh-1')[0].path).toBe(completePath(WEEK, 'c1'));
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
  });

  it('a live tap the service refuses reverts and is never queued', async () => {
    // A real error answer is the service saying no, not an outage. Queuing it
    // would replay a write the server has already rejected, forever.
    const client = boardClient({ complete: () => refused });

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    await waitFor(() => expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○'));
    expect(readWriteQueue('hh-1')).toEqual([]);
  });

  it('a tap on a rolled-over cached week is refused outright, not queued', async () => {
    // The one case the board still will not write: the API resolves a completion
    // by the week it is handed, so queuing this would mark *last* week done.
    writeGlance(
      'hh-1',
      {
        board: {
          weekIso: '2019-W01',
          items: [
            { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' },
          ],
        },
      },
      undefined,
      '2026-07-20T09:00:00.000Z',
    );

    await renderBoard(offlineClient(), { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○');
  });

  it('replay-on-reconnect: the network returning drains the queued tap in order', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');
    const emitOnline = installReconnect();
    const state = { offline: true };
    const live = boardClient();
    const client: ApiClient = {
      baseUrl: live.baseUrl,
      get: jest.fn(async (path: string) =>
        state.offline ? unreachable : live.get<unknown>(path),
      ) as unknown as ApiClient['get'],
      update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) =>
        state.offline ? unreachable : live.update<unknown>(path, body, options),
      ) as unknown as ApiClient['update'],
    };

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());

    // Two offline taps, on two chores, in that order.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c4'));
    });
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(2));

    // Nobody touches the tablet; the `online` event alone drives the sync. Every
    // attempt made while offline was refused by the network, so only the calls
    // from here on are the replay under test.
    const beforeReconnect = (client.update as jest.Mock).mock.calls.length;
    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    const replayed = (client.update as jest.Mock).mock.calls
      .slice(beforeReconnect)
      .map(([path]) => String(path))
      .filter((path) => path.endsWith('/complete') || path.endsWith('/undo'));

    // Each write reaches the API exactly once, in the order the taps happened.
    expect(replayed).toEqual([
      completePath(thisWeek, 'c1'),
      `/households/hh-1/assignments/${thisWeek}/c4/undo`,
    ]);
  });

  it('a queued tap survives the refetch that races its sync', async () => {
    // The reconnect refetch and the drain run together; the API has not seen the
    // queued write yet, so redrawing the server's answer raw would flicker the
    // row back to Open and make the tap look lost.
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-complete',
        dedupeKey: assignmentDedupeKey(WEEK, 'c1'),
        method: 'POST',
        path: completePath(WEEK, 'c1'),
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: 0,
        status: 'pending',
      },
    ]);
    // The load succeeds (c1 comes back Open) but the replay cannot get through.
    const client = boardClient({ complete: () => unreachable });

    await renderBoard(client, { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
  });

  it('a write flagged after its retries are spent stays queued and stays shown', async () => {
    // O3's terminal-failure case: never silently dropped, never silently undone -
    // it waits, flagged, for the surface O4 puts on it.
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-complete',
        dedupeKey: assignmentDedupeKey(WEEK, 'c1'),
        method: 'POST',
        path: completePath(WEEK, 'c1'),
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: MAX_WRITE_ATTEMPTS,
        status: 'failed',
        lastError: 'Conflict',
      },
    ]);

    await renderBoard(boardClient(), { activePersonId: 'p1' });

    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
    expect(readWriteQueue('hh-1')).toHaveLength(1);
  });

  it('overlays a queued write onto the last-known board too, not just a live one', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-undo',
        dedupeKey: assignmentDedupeKey(thisWeek, 'c4'),
        method: 'POST',
        path: `/households/hh-1/assignments/${thisWeek}/c4/undo`,
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: 0,
        status: 'pending',
      },
    ]);

    await renderBoard(offlineClient(), { activePersonId: 'p1' });

    // The cached record still says c4 is Done; the queued undo is the newer truth.
    await waitFor(() => expect(screen.getByTestId('chore-item-c4')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('○');
  });
});

describe('applyQueuedWrites', () => {
  const items: BoardItem[] = [
    { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' },
    { choreId: 'c2', title: 'Vacuum', cadence: 'Weekly', assignedPersonId: 'p2', status: 'Done' },
  ];

  const queued = (choreId: string, kind: 'chore-complete' | 'chore-undo', week = WEEK) => ({
    kind,
    dedupeKey: assignmentDedupeKey(week, choreId),
    method: 'POST' as const,
    path: `/households/hh-1/assignments/${week}/${choreId}/${kind === 'chore-complete' ? 'complete' : 'undo'}`,
    body: { personId: 'p1' },
    enqueuedAtMs: 1,
    attempts: 0,
    status: 'pending' as const,
  });

  it('returns the loaded week untouched when nothing is queued', () => {
    expect(applyQueuedWrites(items, WEEK, [])).toBe(items);
  });

  it('shows a queued completion as done and a queued undo as open', () => {
    const overlaid = applyQueuedWrites(items, WEEK, [
      queued('c1', 'chore-complete'),
      queued('c2', 'chore-undo'),
    ]);

    expect(overlaid.map((item) => item.status)).toEqual(['Done', 'Open']);
  });

  it('ignores a write queued against a different week', () => {
    // The cached row and the queued write have to agree on the week, or the
    // overlay would show last week's tap on this week's board.
    expect(applyQueuedWrites(items, WEEK, [queued('c1', 'chore-complete', '2019-W01')])).toEqual(
      items,
    );
  });

  it('ignores a queued write for a chore that is not on the board', () => {
    expect(applyQueuedWrites(items, WEEK, [queued('c9', 'chore-complete')])).toEqual(items);
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
