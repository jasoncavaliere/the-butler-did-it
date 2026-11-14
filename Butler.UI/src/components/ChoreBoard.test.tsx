import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import {
  CLOCK_NOTICE_AFTER,
  ChoreBoard,
  LIVE_WEEK_RETRY_DELAYS_MS,
  applyLiveTaps,
  applyQueuedWrites,
  describeFailure,
  pruneLiveTaps,
  type BoardItem,
  type LiveTap,
} from './ChoreBoard';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type {
  AssignmentView,
  ChoreResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { readGlance, writeGlance, type GlanceStorage } from '../offline/glanceCache';
import { WriteQueueProvider } from '../offline/WriteQueueContext';
import { currentWeekIso } from '../offline/weekIso';
import {
  MAX_WRITE_ATTEMPTS,
  STALE_WEEK_ERROR,
  assignmentDedupeKey,
  readWriteQueue,
  saveWriteQueue,
} from '../offline/writeQueue';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

// The week the hub is actually in. A live board whose week has rolled over is
// read-only (#89), so a fixed week here would turn every tap test red the day
// the calendar moved past it; the boundary itself is pinned with fake timers in
// its own block below.
const WEEK = currentWeekIso();

const roster: RosterEntryResponse[] = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
  { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
];

// c1/c3 are daily -> "Today"; c2/c4 are weekly -> "This week".
const chores: ChoreResponse[] = [
  { choreId: 'c1', title: 'Dishes', roomId: 'r1', cadence: 'Daily', effort: 1, minAge: null, active: true, eTag: 'e1' },
  { choreId: 'c2', title: 'Vacuum', roomId: 'r1', cadence: 'Weekly', effort: 2, minAge: null, active: true, eTag: 'e2' },
  { choreId: 'c3', title: 'Trash', roomId: 'r1', cadence: 'Daily', effort: 1, minAge: null, active: true, eTag: 'e3' },
  { choreId: 'c4', title: 'Laundry', roomId: 'r1', cadence: 'Weekly', effort: 3, minAge: null, active: true, eTag: 'e4' },
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

/**
 * Mount `ui` inside the one write queue the hub provides (O4), replaying through
 * the same client the board loads with - exactly what HubShell does.
 */
function inQueue(client: ApiClient, ui: ReactElement) {
  return (
    <WriteQueueProvider householdId="hh-1" client={client}>
      {ui}
    </WriteQueueProvider>
  );
}

async function renderBoard(
  client: ApiClient,
  { activePersonId = null, people = roster }: { activePersonId?: string | null; people?: RosterEntryResponse[] } = {},
) {
  useApiClientMock.mockReturnValue(client);
  return render(
    inQueue(client, <ChoreBoard householdId="hh-1" people={people} activePersonId={activePersonId} />),
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
    const client = boardClient();
    useApiClientMock.mockReturnValue(client);
    const view = await render(
      inQueue(client, <ChoreBoard householdId="hh-1" people={roster} activePersonId="p1" />),
    );

    // Focused on Alex: their items show, Sam's do not.
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.queryByTestId('chore-item-c3')).toBeNull();

    // Tapping a different tile re-focuses on Sam (no refetch): now Sam's items
    // show and Alex's are gone.
    await view.rerender(
      inQueue(client, <ChoreBoard householdId="hh-1" people={roster} activePersonId="p2" />),
    );
    await waitFor(() => expect(screen.getByTestId('chore-item-c3')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c2')).toBeOnTheScreen();
    expect(screen.queryByTestId('chore-item-c1')).toBeNull();
    expect(screen.queryByTestId('chore-item-c4')).toBeNull();

    // Clearing the selection (idle-reset -> null) restores the full household.
    await view.rerender(
      inQueue(client, <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} />),
    );
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
      `/households/hh-1/assignments/${WEEK}/c1/complete`,
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
      `/households/hh-1/assignments/${WEEK}/c1/undo`,
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
      `/households/hh-1/assignments/${WEEK}/c4/undo`,
      { personId: 'p1' },
      { method: 'POST' },
    );
    expect(client.update).not.toHaveBeenCalledWith(
      `/households/hh-1/assignments/${WEEK}/c4/complete`,
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
    const client = boardClient({ generate: unreachable });
    useApiClientMock.mockReturnValue(client);

    await render(
      inQueue(
        client,
        <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
      ),
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
    const client = boardClient();
    useApiClientMock.mockReturnValue(client);

    await render(
      inQueue(
        client,
        <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
      ),
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
    const client = boardClient({ generate: serverError });
    useApiClientMock.mockReturnValue(client);

    await render(
      inQueue(
        client,
        <ChoreBoard householdId="hh-1" people={roster} activePersonId={null} onLastKnown={onLastKnown} />,
      ),
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
 * #89: a board loaded *live* outlives its week just as easily as a cached one -
 * the wall tablet is loaded on Sunday night and tapped on Monday morning, and
 * nobody reloads it in between. Its rows still carry the week the server named at
 * load time, and the API resolves a completion by that week with no current-week
 * check, so the guard has to hold for a live board too.
 *
 * The clock is pinned to one minute before the 2026-W29 -> 2026-W30 boundary
 * (Sunday 2026-07-19 23:59 UTC) and the board is handed 2026-W29 explicitly, so
 * these cases do not depend on the real calendar the way the module `WEEK` does.
 */
describe('ChoreBoard live board across a week boundary (#89)', () => {
  let restore: (() => void)[] = [];

  const SUNDAY_NIGHT = new Date('2026-07-19T23:59:00.000Z');
  const MONDAY_MORNING = new Date('2026-07-20T00:00:30.000Z');
  const ENDED = '2026-W29';
  const NEXT = '2026-W30';

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

  /** See the sibling blocks: stands in for the browser's `online` event. */
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
    jest.useFakeTimers({ now: SUNDAY_NIGHT });
  });

  afterEach(() => {
    // The top-level afterEach does not restore timers, and every other block
    // runs on the real clock.
    jest.useRealTimers();
    for (const cleanup of restore) {
      cleanup();
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  const completePath = (week: string, choreId: string) =>
    `/households/hh-1/assignments/${week}/${choreId}/complete`;

  /** Every write the board could make, whatever the week or the direction. */
  const writesFrom = (client: ApiClient) =>
    (client.update as jest.Mock).mock.calls.filter(([path]) => {
      const p = String(path);
      return p.endsWith('/complete') || p.endsWith('/undo');
    });

  const generateCalls = (client: ApiClient) =>
    (client.update as jest.Mock).mock.calls.filter(([path]) => String(path).endsWith('/generate'))
      .length;

  /** A live client whose generate always names the week that is ending. */
  const endingWeekClient = () =>
    boardClient({ generate: ok({ weekIso: ENDED, assignments, unassigned: [] }) });

  async function renderLiveBoard(client: ApiClient) {
    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    // Live, current, and a control - the starting point every case shares.
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false);
  }

  it('live-rollover-current-week: before the boundary a live tap still writes to its week', async () => {
    const client = endingWeekClient();
    await renderLiveBoard(client);

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    expect(client.update).toHaveBeenCalledWith(completePath(ENDED, 'c1'), { personId: 'p1' }, { method: 'POST' });
    await waitFor(() => expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓'));
  });

  it('live-rollover-guard: a live board that outlived its week refuses the tap - no write, nothing queued', async () => {
    const client = endingWeekClient();
    await renderLiveBoard(client);

    // The week turns while the board sits on the wall. Only the clock moves - no
    // timer fires - so this is the tap racing the boundary timer (or a sleeping
    // tablet whose timer is late): the tap itself has to catch it.
    jest.setSystemTime(MONDAY_MORNING);
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // Nothing reaches the API: a complete for 2026-W29 would succeed and mark
    // last week's chore done while this week's stays open.
    expect(writesFrom(client)).toHaveLength(0);
    // Nor is it queued to be replayed into the ended week later.
    expect(readWriteQueue('hh-1')).toEqual([]);
    // The row does not pretend the tap landed...
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('○');
    // ...and the refusal brings the render up to date, so it reads as a display.
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true),
    );
    expect(writesFrom(client)).toHaveLength(0);
  });

  it('live-rollover-inert: rows go non-interactive at the boundary, before any tap', async () => {
    const client = endingWeekClient();
    await renderLiveBoard(client);
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.disabled).toBe(false);

    // Nobody touches the tablet; the boundary passes on its own.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });

    // This server keeps naming the ended week, so the board stays read-only.
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true),
    );
    expect(screen.getByTestId('chore-item-c4').props.accessibilityState.disabled).toBe(true);
    expect(writesFrom(client)).toHaveLength(0);
  });

  it('live-rollover-reload: the board reloads the new week at the boundary and is tappable again', async () => {
    // A server that names whichever week it is when the request arrives.
    const client = boardClient();
    (client.update as jest.Mock).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) {
        return ok({ weekIso: currentWeekIso(), assignments, unassigned: [] });
      }
      const choreId = /assignments\/[^/]+\/([^/]+)\/complete$/.exec(path)?.[1] ?? '';
      return ok({ weekIso: currentWeekIso(), choreId, assignedPersonId: '', status: 'Done' });
    });
    await renderLiveBoard(client);
    expect(generateCalls(client)).toBe(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });

    // One extra load at the boundary - a healthy hub is not left read-only every
    // Monday until someone reloads it - and only one.
    await waitFor(() => expect(generateCalls(client)).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });

    // The tap lands in the new week, not the ended one.
    expect(client.update).toHaveBeenCalledWith(completePath(NEXT, 'c1'), { personId: 'p1' }, { method: 'POST' });
    expect(client.update).not.toHaveBeenCalledWith(
      completePath(ENDED, 'c1'),
      expect.anything(),
      expect.anything(),
    );
    expect(generateCalls(client)).toBe(2);
  });

  it('live-rollover-drain: a tap queued just before the boundary is not replayed into the ended week', async () => {
    const emitOnline = installReconnect();
    const state = { offline: false };
    const live = endingWeekClient();
    const client: ApiClient = {
      baseUrl: live.baseUrl,
      get: jest.fn(async (path: string) =>
        state.offline ? unreachable : live.get<unknown>(path),
      ) as unknown as ApiClient['get'],
      update: jest.fn(async (path: string, body: unknown, options?: UpdateOptions) =>
        state.offline ? unreachable : live.update<unknown>(path, body, options),
      ) as unknown as ApiClient['update'],
    };
    await renderLiveBoard(client);

    // Sunday 23:59: the network drops between the load and the tap, so the tap
    // is queued (still the week it was tapped in, so the queue accepts it).
    state.offline = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    expect(readWriteQueue('hh-1')[0]).toMatchObject({
      path: completePath(ENDED, 'c1'),
      status: 'pending',
    });

    // The outage outlasts the week; then the network returns.
    jest.setSystemTime(MONDAY_MORNING);
    const beforeReconnect = (client.update as jest.Mock).mock.calls.length;
    state.offline = false;
    await act(async () => {
      emitOnline();
    });

    // The drain flags it instead of replaying it into 2026-W29...
    await waitFor(() => expect(readWriteQueue('hh-1')[0]?.status).toBe('failed'));
    expect(readWriteQueue('hh-1')[0]).toMatchObject({
      dedupeKey: assignmentDedupeKey(ENDED, 'c1'),
      lastError: STALE_WEEK_ERROR,
    });
    // ...so nothing reached the API for the ended week after the reconnect.
    const replayed = (client.update as jest.Mock).mock.calls
      .slice(beforeReconnect)
      .map(([path]) => String(path));
    expect(replayed).not.toContain(completePath(ENDED, 'c1'));
  });

  /**
   * A live client whose server clock lags the tablet's: its generate names the
   * ended week for the first `lagging` loads, then the new one. Completions
   * confirm `Done` for whatever week they were posted to.
   */
  function laggingServerClient(lagging: number) {
    const client = boardClient();
    let loads = 0;
    (client.update as jest.Mock).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) {
        loads += 1;
        const week = loads <= lagging ? ENDED : NEXT;
        return ok({ weekIso: week, assignments, unassigned: [] });
      }
      const match = /assignments\/([^/]+)\/([^/]+)\/complete$/.exec(path);
      return ok({ weekIso: match?.[1] ?? '', choreId: match?.[2] ?? '', assignedPersonId: '', status: 'Done' });
    });
    return client;
  }

  it('live-rollover-skew: a boundary reload that beats the server clock retries and comes back to life', async () => {
    // The mount and the boundary reload both reach a server still on Sunday.
    const client = laggingServerClient(2);
    await renderLiveBoard(client);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(generateCalls(client)).toBe(2));
    // The tablet has turned the week, the server has not: read-only for now...
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true),
    );
    // ...and a single disagreement is the ordinary race, not worth a message.
    expect(screen.queryByTestId('chore-board-clock-notice')).toBeNull();

    // The first backoff retry reaches a server that has turned the week too.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(LIVE_WEEK_RETRY_DELAYS_MS[0]);
    });
    await waitFor(() => expect(generateCalls(client)).toBe(3));
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    expect(client.update).toHaveBeenCalledWith(completePath(NEXT, 'c1'), { personId: 'p1' }, { method: 'POST' });

    // Once the weeks agree the retry is disarmed: no more loads, however long it sits.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(LIVE_WEEK_RETRY_DELAYS_MS[LIVE_WEEK_RETRY_DELAYS_MS.length - 1] * 2);
    });
    expect(generateCalls(client)).toBe(3);
    expect(screen.queryByTestId('chore-board-clock-notice')).toBeNull();
  });

  it('live-rollover-skew: a refused tap forces a reload even when the render already holds the new week', async () => {
    const client = laggingServerClient(2);
    await renderLiveBoard(client);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(generateCalls(client)).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true),
    );

    // Someone taps before the backoff elapses. The hook already holds 2026-W30,
    // so re-reading the week alone would change nothing; the tap must reload.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    expect(writesFrom(client)).toHaveLength(0);
    await waitFor(() => expect(generateCalls(client)).toBe(3));
    await waitFor(() =>
      expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false),
    );
  });

  it('clock-notice: a tablet whose clock disagrees with the server says so instead of going silently inert', async () => {
    // The server is in a different week altogether: the tablet's clock is wrong.
    const client = boardClient({ generate: ok({ weekIso: '2026-W40', assignments, unassigned: [] }) });
    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('chore-board-clock-notice')).toBeNull();

    // The retries keep disagreeing, so after the first one the board explains itself.
    let expectedLoads = 1;
    for (const delay of LIVE_WEEK_RETRY_DELAYS_MS) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(delay);
      });
      expectedLoads += 1;
      await waitFor(() => expect(generateCalls(client)).toBe(expectedLoads));
    }
    expect(expectedLoads).toBeGreaterThan(CLOCK_NOTICE_AFTER);
    expect(screen.getByTestId('chore-board-clock-notice')).toHaveTextContent(/clock/);
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(true);

    // Past the last step the delay holds at the cap rather than growing or stopping.
    const cap = LIVE_WEEK_RETRY_DELAYS_MS[LIVE_WEEK_RETRY_DELAYS_MS.length - 1];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(cap - 1);
    });
    expect(generateCalls(client)).toBe(expectedLoads);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    await waitFor(() => expect(generateCalls(client)).toBe(expectedLoads + 1));

    // A tap is still refused and writes nothing.
    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    expect(writesFrom(client)).toHaveLength(0);
  });

  it('clock-notice: the notice clears once the server and the tablet agree again', async () => {
    const client = laggingServerClient(CLOCK_NOTICE_AFTER + 1);
    await renderLiveBoard(client);
    // Cross the boundary: the reload and the first retry both still name the ended week.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(LIVE_WEEK_RETRY_DELAYS_MS[0]);
    });
    await waitFor(() => expect(screen.getByTestId('chore-board-clock-notice')).toBeOnTheScreen());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(LIVE_WEEK_RETRY_DELAYS_MS[1]);
    });
    await waitFor(() => expect(screen.queryByTestId('chore-board-clock-notice')).toBeNull());
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.disabled).toBe(false);
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

  /**
   * A tiny stateful API for the sync-race tests (#88). It holds the server's own
   * view of c1/c4, so a generate answers with whatever the server knew *when the
   * request was made* - which is what makes a stale snapshot possible at all.
   *
   * - `holdFirstOnlineGenerate` parks the first online generate until
   *   `releaseGenerate()`, so a drain can confirm before the load resolves.
   *   `holdOnlineGenerate: n` parks the nth instead (the first is `1`); either
   *   way the snapshot is still taken when the request is made.
   * - `holdComplete` parks the first complete until `releaseComplete()`, and the
   *   server only records it on release, so the load can resolve first.
   * - `extra` seeds more chores, Open and assigned to p1, after c1/c4 in every
   *   snapshot - a row the cached board never had, for a live tap to land on.
   * - `holdLiveComplete` parks that chore's complete until
   *   `releaseLiveComplete()`, recorded only on release (#147).
   *
   * A complete that is not held still lands a tick after it is sent (network
   * latency), so a generate sent in the same effect flush sees the pre-sync week.
   */
  function serverClient(
    opts: {
      holdFirstOnlineGenerate?: boolean;
      holdOnlineGenerate?: number;
      holdComplete?: boolean;
      extra?: string[];
      holdLiveComplete?: string;
    } = {},
  ) {
    const extra = opts.extra ?? [];
    const server = {
      offline: true,
      status: {
        c1: 'Open',
        c4: 'Done',
        ...Object.fromEntries(extra.map((choreId) => [choreId, 'Open'])),
      } as Record<string, 'Open' | 'Done'>,
      onlineGenerates: 0,
    };
    const holdGenerateAt = opts.holdOnlineGenerate ?? (opts.holdFirstOnlineGenerate ? 1 : 0);
    let releaseGenerate: () => void = () => {};
    let releaseComplete: () => void = () => {};
    let releaseLiveComplete: () => void = () => {};
    let completeHeld = false;

    const snapshot = (): ApiResult<unknown> =>
      ok({
        weekIso: thisWeek,
        assignments: [
          { choreId: 'c1', assignedPersonId: 'p1', effort: 1, status: server.status.c1 },
          { choreId: 'c4', assignedPersonId: 'p1', effort: 3, status: server.status.c4 },
          ...extra.map((choreId) => ({
            choreId,
            assignedPersonId: 'p1',
            effort: 2,
            status: server.status[choreId],
          })),
        ],
        unassigned: [],
      });

    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
        if (server.offline) {
          return unreachable;
        }
        return path.includes('/chores') ? ok(chores) : ok([]);
      }) as unknown as ApiClient['get'],
      update: jest.fn((path: string): Promise<ApiResult<unknown>> => {
        if (server.offline) {
          return Promise.resolve(unreachable);
        }
        if (path.endsWith('/generate')) {
          server.onlineGenerates += 1;
          const answer = snapshot();
          if (server.onlineGenerates === holdGenerateAt) {
            return new Promise((resolve) => {
              releaseGenerate = () => resolve(answer);
            });
          }
          return Promise.resolve(answer);
        }
        const undoChoreId = /assignments\/[^/]+\/([^/]+)\/undo$/.exec(path)?.[1];
        if (undoChoreId !== undefined) {
          server.status[undoChoreId] = 'Open';
          return Promise.resolve(
            ok({ weekIso: thisWeek, choreId: undoChoreId, assignedPersonId: '', status: 'Open' }),
          );
        }
        const choreId = /assignments\/[^/]+\/([^/]+)\/complete$/.exec(path)?.[1] ?? '';
        const land = () => {
          server.status[choreId] = 'Done';
          return ok({ weekIso: thisWeek, choreId, assignedPersonId: 'p1', status: 'Done' });
        };
        if (opts.holdLiveComplete !== undefined && choreId === opts.holdLiveComplete) {
          return new Promise((resolve) => {
            releaseLiveComplete = () => resolve(land());
          });
        }
        if (opts.holdComplete && !completeHeld) {
          completeHeld = true;
          return new Promise((resolve) => {
            releaseComplete = () => resolve(land());
          });
        }
        return new Promise((resolve) => setTimeout(() => resolve(land()), 0));
      }) as unknown as ApiClient['update'],
    };

    return {
      client,
      server,
      releaseGenerate: () => releaseGenerate(),
      releaseComplete: () => releaseComplete(),
      releaseLiveComplete: () => releaseLiveComplete(),
    };
  }

  const pendingWrite = (choreId: string, kind: 'chore-complete' | 'chore-undo', enqueuedAtMs = 1) => ({
    kind,
    dedupeKey: assignmentDedupeKey(thisWeek, choreId),
    method: 'POST' as const,
    path: `/households/hh-1/assignments/${thisWeek}/${choreId}/${kind === 'chore-complete' ? 'complete' : 'undo'}`,
    body: { personId: 'p1' },
    enqueuedAtMs,
    attempts: 0,
    status: 'pending' as const,
  });

  /** Let every settled promise and zero-delay timer run, inside act. */
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const generateCalls = (client: ApiClient) =>
    (client.update as jest.Mock).mock.calls.filter(([path]) => String(path).endsWith('/generate'))
      .length;

  /** Cached board, one queued c1 completion, offline mount, then the network returns. */
  async function goOnlineWithQueuedTap(
    fake: ReturnType<typeof serverClient>,
    queue = [pendingWrite('c1', 'chore-complete')],
  ) {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');
    saveWriteQueue('hh-1', queue);
    const emitOnline = installReconnect();

    await renderBoard(fake.client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓'));

    fake.server.offline = false;
    await act(async () => {
      emitOnline();
    });
  }

  it('sync-refetch: a drain that confirms queued writes refetches the board exactly once and renders the post-sync server state', async () => {
    // The reconnect load races the drain, so it may carry the server's pre-sync
    // week. Once the drain confirms, the board has to go back to the server for
    // the truth - once per drain run, not once per write.
    const fake = serverClient();
    await goOnlineWithQueuedTap(fake, [
      pendingWrite('c1', 'chore-complete', 1),
      pendingWrite('c4', 'chore-undo', 2),
    ]);

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    await waitFor(() => expect(fake.server.onlineGenerates).toBe(2));
    await flush();
    expect(fake.server.onlineGenerates).toBe(2);

    // The glance cache stores the raw server build, so this is the server's own
    // post-sync answer rather than the queue overlay.
    await waitFor(() =>
      expect(readGlance('hh-1')?.board?.items.map(({ choreId, status }) => ({ choreId, status }))).toEqual([
        { choreId: 'c1', status: 'Done' },
        { choreId: 'c4', status: 'Open' },
      ]),
    );
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
    expect(screen.getByTestId('chore-item-mark-c4')).toHaveTextContent('○');
  });

  it('sync-race: a write the drain confirms before the reconnect refetch resolves still reads as Done', async () => {
    // #88: the reconnect generate snapshots c1 as Open, the drain then confirms the
    // completion (so the queue overlay is empty), and only then does the stale
    // snapshot resolve. Without a confirm-triggered refetch the live board would
    // draw the tap as Open and nothing would ever correct it.
    const fake = serverClient({ holdFirstOnlineGenerate: true });
    await goOnlineWithQueuedTap(fake);

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    await act(async () => {
      fake.releaseGenerate();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓'));
    expect(screen.getByTestId('chore-item-c1').props.accessibilityState.checked).toBe(true);
    expect(fake.server.onlineGenerates).toBe(2);
  });

  it('sync-race: the fix holds whichever request the network answers first', async () => {
    // The other resolution order: the reconnect load lands while the write is
    // still queued (the overlay carries it), then the complete is confirmed and
    // the board refetches the post-sync week.
    const fake = serverClient({ holdComplete: true });
    await goOnlineWithQueuedTap(fake);

    await waitFor(() => expect(readGlance('hh-1')?.board?.items[0].status).toBe('Open'));
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
    expect(fake.server.onlineGenerates).toBe(1);

    await act(async () => {
      fake.releaseComplete();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    await waitFor(() => expect(fake.server.onlineGenerates).toBe(2));
    await waitFor(() => expect(readGlance('hh-1')?.board?.items[0].status).toBe('Done'));
    expect(screen.getByTestId('chore-item-mark-c1')).toHaveTextContent('✓');
  });

  /**
   * Online with c2 on the live board, the drain confirmed, and the confirm
   * refetch (the second online generate) parked with c2 still Open in its
   * snapshot - the window a live tap can land in (#147).
   */
  async function liveBoardWithParkedRefetch(fake: ReturnType<typeof serverClient>) {
    await goOnlineWithQueuedTap(fake);
    await waitFor(() => expect(screen.getByTestId('chore-item-c2')).toBeOnTheScreen());
    await waitFor(() => expect(fake.server.onlineGenerates).toBe(1));

    await act(async () => {
      fake.releaseComplete();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    await waitFor(() => expect(fake.server.onlineGenerates).toBe(2));
  }

  it('live-tap-race: a live tap that settles while the confirm-triggered refetch is in flight still reads as done after it resolves', async () => {
    // #147: the refetch snapshots c2 as Open, the family taps c2 on the live
    // board and the server records it, and only then does the stale snapshot
    // resolve. The tap never entered the queue, so the queue overlay cannot
    // cover it, and the live board would never refetch to correct it.
    const fake = serverClient({ holdComplete: true, holdOnlineGenerate: 2, extra: ['c2'] });
    await liveBoardWithParkedRefetch(fake);

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c2'));
    });
    await flush();
    expect(fake.server.status.c2).toBe('Done');
    expect(readWriteQueue('hh-1')).toEqual([]);

    await act(async () => {
      fake.releaseGenerate();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('chore-item-mark-c2')).toHaveTextContent('✓');
    expect(screen.getByTestId('chore-item-c2').props.accessibilityState.checked).toBe(true);
    expect(fake.server.onlineGenerates).toBe(2);
  });

  it('live-tap-race: a live tap still in flight when the confirm-triggered refetch resolves keeps its tapped state', async () => {
    // The other resolution order: the stale snapshot resolves while the tap's
    // POST is still on its way, then the POST lands.
    const fake = serverClient({
      holdComplete: true,
      holdOnlineGenerate: 2,
      extra: ['c2'],
      holdLiveComplete: 'c2',
    });
    await liveBoardWithParkedRefetch(fake);

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c2'));
    });
    expect(fake.server.status.c2).toBe('Open');

    await act(async () => {
      fake.releaseGenerate();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('chore-item-mark-c2')).toHaveTextContent('✓');
    expect(screen.getByTestId('chore-item-c2').props.accessibilityState.checked).toBe(true);

    await act(async () => {
      fake.releaseLiveComplete();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('chore-item-mark-c2')).toHaveTextContent('✓');
    expect(fake.server.status.c2).toBe('Done');
    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(fake.server.onlineGenerates).toBe(2);
  });

  it('sync-refetch: a drain that confirms nothing does not refetch', async () => {
    // A refetch per drain would double every board load (the mount drain runs on
    // an empty queue) and hammer the API while a replay keeps failing.
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
    const client = boardClient({ complete: () => unreachable });

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    await waitFor(() =>
      expect((client.update as jest.Mock).mock.calls.map(([path]) => String(path))).toContain(
        completePath(WEEK, 'c1'),
      ),
    );
    await flush();

    expect(generateCalls(client)).toBe(1);
  });

  it('sync-refetch: an offline tap whose drain confirms nothing does not refetch', async () => {
    writeGlance('hh-1', { board: cachedThisWeek }, undefined, '2026-07-20T09:00:00.000Z');
    const client = offlineClient();

    await renderBoard(client, { activePersonId: 'p1' });
    await waitFor(() => expect(screen.getByTestId('chore-item-c1')).toBeOnTheScreen());
    const generatesBefore = generateCalls(client);

    await act(async () => {
      fireEvent.press(screen.getByTestId('chore-item-c1'));
    });
    await waitFor(() => expect(readWriteQueue('hh-1')).toHaveLength(1));
    await flush();

    expect(generateCalls(client)).toBe(generatesBefore);
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

describe('applyLiveTaps', () => {
  const items: BoardItem[] = [
    { choreId: 'c1', title: 'Dishes', cadence: 'Daily', assignedPersonId: 'p1', status: 'Open' },
    { choreId: 'c2', title: 'Vacuum', cadence: 'Weekly', assignedPersonId: 'p2', status: 'Done' },
  ];

  const taps = (...entries: [string, LiveTap, string?][]) =>
    new Map(entries.map(([choreId, tap, week = WEEK]) => [assignmentDedupeKey(week, choreId), tap]));

  it('returns the loaded week untouched when no live tap is remembered', () => {
    expect(applyLiveTaps(items, WEEK, new Map())).toBe(items);
  });

  it('shows an in-flight and a settled tap over the loaded status, in either direction', () => {
    const overlaid = applyLiveTaps(
      items,
      WEEK,
      taps(['c1', { status: 'Done', settledAtLoad: null }], ['c2', { status: 'Open', settledAtLoad: 3 }]),
    );

    expect(overlaid.map((item) => item.status)).toEqual(['Done', 'Open']);
  });

  it('ignores a tap made against a different week', () => {
    expect(
      applyLiveTaps(items, WEEK, taps(['c1', { status: 'Done', settledAtLoad: null }, '2019-W01'])),
    ).toEqual(items);
  });

  it('ignores a tap on a chore that is not on the board', () => {
    expect(applyLiveTaps(items, WEEK, taps(['c9', { status: 'Done', settledAtLoad: 1 }]))).toEqual(
      items,
    );
  });
});

describe('pruneLiveTaps', () => {
  const remembered = (): Map<string, LiveTap> =>
    new Map<string, LiveTap>([
      ['in-flight', { status: 'Done', settledAtLoad: null }],
      ['before', { status: 'Done', settledAtLoad: 4 }],
      ['during', { status: 'Open', settledAtLoad: 5 }],
      ['later', { status: 'Done', settledAtLoad: 6 }],
    ]);

  it('forgets only the taps that settled before the load started', () => {
    // A tap that settled during load 5 (settledAtLoad 5) may be missing from
    // load 5's snapshot, so only the one that settled before it is dropped.
    expect(Array.from(pruneLiveTaps(remembered(), 5).keys())).toEqual([
      'in-flight',
      'during',
      'later',
    ]);
  });

  it('keeps a tap that is still in flight however many loads have landed', () => {
    expect(Array.from(pruneLiveTaps(remembered(), 100).keys())).toEqual(['in-flight']);
  });

  it('returns a new map and leaves its input unchanged', () => {
    const input = remembered();
    const pruned = pruneLiveTaps(input, 5);

    expect(pruned).not.toBe(input);
    expect(input.size).toBe(4);
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
