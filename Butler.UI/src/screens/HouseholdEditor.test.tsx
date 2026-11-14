import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { HouseholdEditor } from './HouseholdEditor';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type { ChoreResponse, RoomResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type UpdateFn = (path: string, body: unknown, options?: UpdateOptions) => Promise<ApiResult<unknown>>;

const KITCHEN: RoomResponse = { roomId: 'r1', name: 'Kitchen', sortOrder: 0, eTag: 'W/"r1-v1"' };
const GARAGE: RoomResponse = { roomId: 'r2', name: 'Garage', sortOrder: 1, eTag: 'W/"r2-v1"' };

const DISHES: ChoreResponse = {
  choreId: 'c1',
  title: 'Dishes',
  roomId: 'r1',
  cadence: 'Daily',
  effort: 1,
  minAge: null,
  active: true,
  eTag: 'W/"c1-v1"',
};
const SWEEP: ChoreResponse = {
  choreId: 'c2',
  title: 'Sweep',
  roomId: 'r1',
  cadence: 'Weekly',
  effort: 2,
  minAge: 8,
  active: true,
  eTag: 'W/"c2-v1"',
};
const SHELF: ChoreResponse = {
  choreId: 'c3',
  title: 'Tidy shelf',
  roomId: 'r2',
  cadence: 'Weekly',
  effort: 3,
  minAge: null,
  active: false,
  eTag: 'W/"c3-v1"',
};

function ok<T>(data: T, status = 200): ApiResult<T> {
  return { ok: true, status, data, etag: null };
}

function problem(status: number, detail: string): ApiResult<never> {
  return { ok: false, error: { kind: 'problem', status, title: 'Problem', detail } };
}

/**
 * A client whose reads answer from a mutable server snapshot (so a test can
 * change what a reload sees) and whose writes run the supplied handler.
 */
function editorClient(
  update: UpdateFn = async () => {
    throw new Error('unexpected write');
  },
) {
  const server: { rooms: ApiResult<unknown>; chores: ApiResult<unknown> } = {
    // Garage first: the editor orders rooms by sortOrder, not response order.
    rooms: ok([GARAGE, KITCHEN]),
    chores: ok([DISHES, SWEEP, SHELF]),
  };
  const get = jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
    if (path === '/households/hh-1/rooms') {
      return server.rooms;
    }
    if (path === '/households/hh-1/chores') {
      return server.chores;
    }
    throw new Error(`unexpected read ${path}`);
  });
  const updateMock = jest.fn(update);
  const client: ApiClient = {
    baseUrl: 'http://api.test:1',
    get: get as unknown as ApiClient['get'],
    update: updateMock as unknown as ApiClient['update'],
  };
  return { client, server, get, update: updateMock };
}

// React 19: wrap each interaction in an async act() so state settles before the next line.
async function type(testID: string, value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
  });
}
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function renderEditor(client: ApiClient) {
  useApiClientMock.mockReturnValue(client);
  await render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HouseholdEditor />
    </HouseholdProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('room-r1')).toBeOnTheScreen());
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HouseholdEditor', () => {
  it('lists rooms with their chores (title, cadence, effort, min age, active state)', async () => {
    const { client, get } = editorClient();
    await renderEditor(client);

    expect(get).toHaveBeenCalledWith('/households/hh-1/rooms');
    expect(get).toHaveBeenCalledWith('/households/hh-1/chores');

    const roomNames = screen.getAllByTestId(/^room-name-/).map((node) => node.props.children);
    expect(roomNames).toEqual(['Kitchen', 'Garage']);

    const kitchen = within(screen.getByTestId('room-r1'));
    expect(kitchen.getByTestId('chore-title-c1')).toHaveTextContent('Dishes');
    expect(kitchen.getByTestId('chore-meta-c1')).toHaveTextContent('Daily - effort 1 - any age - Active');
    expect(kitchen.getByTestId('chore-title-c2')).toHaveTextContent('Sweep');
    expect(kitchen.getByTestId('chore-meta-c2')).toHaveTextContent('Weekly - effort 2 - min age 8 - Active');

    const garage = within(screen.getByTestId('room-r2'));
    expect(garage.getByTestId('chore-meta-c3')).toHaveTextContent(
      'Weekly - effort 3 - any age - Inactive',
    );
    // Only an active chore offers Deactivate.
    expect(garage.queryByTestId('deactivate-chore-c3')).toBeNull();
    expect(kitchen.getByTestId('deactivate-chore-c1')).toBeOnTheScreen();
    expect(screen.queryByTestId('household-unroomed')).toBeNull();
  });

  it('shows a loading state until the lists arrive', async () => {
    const { client } = editorClient();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realGet = client.get;
    client.get = (async (path: string) => {
      await gate;
      return realGet(path);
    }) as ApiClient['get'];
    useApiClientMock.mockReturnValue(client);

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdEditor />
      </HouseholdProvider>,
    );
    expect(screen.getByTestId('household-loading')).toBeOnTheScreen();

    await act(async () => {
      release();
    });
    expect(screen.getByTestId('room-r1')).toBeOnTheScreen();
  });

  it('ignores a read that resolves after the screen is gone', async () => {
    const { client } = editorClient();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realGet = client.get;
    client.get = (async (path: string) => {
      await gate;
      return realGet(path);
    }) as ApiClient['get'];
    useApiClientMock.mockReturnValue(client);

    const view = await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdEditor />
      </HouseholdProvider>,
    );
    await view.unmount();
    await act(async () => {
      release();
    });
    expect(screen.queryByTestId('room-r1')).toBeNull();
  });

  it('adds a room and shows it after a 201', async () => {
    const den: RoomResponse = { roomId: 'r9', name: 'Den', sortOrder: 2, eTag: 'W/"r9-v1"' };
    const { client, update } = editorClient(async () => ok(den, 201));
    await renderEditor(client);

    await type('new-room-name', '  Den  ');
    await press('new-room-save');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('/households/hh-1/rooms', { name: 'Den', sortOrder: 2 }, { method: 'POST' });
    expect(screen.getByTestId('room-name-r9')).toHaveTextContent('Den');
    expect(within(screen.getByTestId('room-r9')).getByText('No chores yet.')).toBeOnTheScreen();
    expect(screen.getByTestId('new-room-name').props.value).toBe('');
  });

  it('starts sort order at zero when the household has no rooms yet', async () => {
    const first: RoomResponse = { roomId: 'r1', name: 'Kitchen', sortOrder: 0, eTag: 'W/"r1-v1"' };
    const { client, server, update } = editorClient(async () => ok(first, 201));
    server.rooms = ok([]);
    server.chores = ok([]);
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdEditor />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getByText('No rooms yet. Add one below.')).toBeOnTheScreen());

    await type('new-room-name', 'Kitchen');
    await press('new-room-save');

    expect(update).toHaveBeenCalledWith('/households/hh-1/rooms', { name: 'Kitchen', sortOrder: 0 }, { method: 'POST' });
    expect(screen.getByTestId('room-r1')).toBeOnTheScreen();
  });

  it("adds a chore to a room with that room's id and shows it under the room after a 201", async () => {
    const created: ChoreResponse = {
      choreId: 'c9',
      title: 'Oil change',
      roomId: 'r2',
      cadence: 'Daily',
      effort: 2,
      minAge: 16,
      active: true,
      eTag: 'W/"c9-v1"',
    };
    const { client, update } = editorClient(async () => ok(created, 201));
    await renderEditor(client);

    await press('add-chore-r2');
    // New chore defaults: the card's room, Weekly, effort 1, any age.
    expect(screen.getByTestId('chore-form-room-r2').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('chore-form-cadence-Weekly').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('chore-form-effort').props.value).toBe('1');
    expect(screen.getByTestId('chore-form-min-age').props.value).toBe('');
    expect(screen.queryByTestId('chore-form-active')).toBeNull();

    await type('chore-form-title', ' Oil change ');
    await press('chore-form-cadence-Daily');
    await type('chore-form-effort', '2');
    await type('chore-form-min-age', '16');
    await press('chore-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/chores',
      { title: 'Oil change', roomId: 'r2', cadence: 'Daily', effort: 2, minAge: 16 },
      { method: 'POST' },
    );
    const garage = within(screen.getByTestId('room-r2'));
    expect(garage.getByTestId('chore-title-c9')).toHaveTextContent('Oil change');
    expect(garage.getByTestId('chore-meta-c9')).toHaveTextContent('Daily - effort 2 - min age 16 - Active');
    expect(screen.queryByTestId('chore-form')).toBeNull();
  });

  it('disables Save and sends nothing when the room name or chore title is blank', async () => {
    const { client, update } = editorClient();
    await renderEditor(client);

    // New room.
    expect(screen.getByTestId('new-room-save')).toBeDisabled();
    await type('new-room-name', '   ');
    expect(screen.getByTestId('new-room-save')).toBeDisabled();
    await press('new-room-save');

    // New chore.
    await press('add-chore-r1');
    await type('chore-form-title', '   ');
    expect(screen.getByTestId('chore-form-save')).toBeDisabled();
    await press('chore-form-save');

    // Rename.
    await press('rename-room-r1');
    await type('rename-room-input-r1', '  ');
    expect(screen.getByTestId('rename-room-save-r1')).toBeDisabled();
    await press('rename-room-save-r1');

    // Chore edit.
    await press('edit-chore-c1');
    await type('chore-form-title', '');
    expect(screen.getByTestId('chore-form-save')).toBeDisabled();
    await press('chore-form-save');

    expect(update).not.toHaveBeenCalled();
  });

  it('disables Save for an invalid effort or min age', async () => {
    const { client, update } = editorClient();
    await renderEditor(client);

    await press('add-chore-r1');
    await type('chore-form-title', 'Mop');
    expect(screen.getByTestId('chore-form-save')).not.toBeDisabled();

    for (const effort of ['0', 'abc', '1.5', '']) {
      await type('chore-form-effort', effort);
      expect(screen.getByTestId('chore-form-save')).toBeDisabled();
    }
    await type('chore-form-effort', '3');
    await type('chore-form-min-age', 'six');
    expect(screen.getByTestId('chore-form-save')).toBeDisabled();
    await press('chore-form-save');
    await type('chore-form-min-age', ' 6 ');
    expect(screen.getByTestId('chore-form-save')).not.toBeDisabled();

    expect(update).not.toHaveBeenCalled();
  });

  it('renames a room with If-Match from the last read', async () => {
    const { client, update } = editorClient(async (path, body) =>
      ok({ ...KITCHEN, ...(body as object), eTag: update.mock.calls.length === 1 ? 'W/"r1-v2"' : 'W/"r1-v3"' }),
    );
    await renderEditor(client);

    await press('rename-room-r1');
    expect(screen.getByTestId('rename-room-input-r1').props.value).toBe('Kitchen');
    await type('rename-room-input-r1', ' Galley ');
    await press('rename-room-save-r1');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/rooms/r1',
      { name: 'Galley', sortOrder: 0 },
      { method: 'PUT', ifMatch: 'W/"r1-v1"' },
    );
    expect(screen.getByTestId('room-name-r1')).toHaveTextContent('Galley');
    expect(screen.queryByTestId('rename-room-input-r1')).toBeNull();

    // The next rename carries the ETag the 200 returned, not the stale one.
    await press('rename-room-r1');
    await type('rename-room-input-r1', 'Scullery');
    await press('rename-room-save-r1');
    expect(update).toHaveBeenLastCalledWith(
      '/households/hh-1/rooms/r1',
      { name: 'Scullery', sortOrder: 0 },
      { method: 'PUT', ifMatch: 'W/"r1-v2"' },
    );
  });

  it('edits a chore with If-Match from the last read and shows the new values', async () => {
    const { client, update } = editorClient(async (path, body) =>
      ok({ choreId: 'c2', ...(body as object), eTag: 'W/"c2-v2"' }),
    );
    await renderEditor(client);

    await press('edit-chore-c2');
    expect(screen.getByTestId('chore-form-title').props.value).toBe('Sweep');
    expect(screen.getByTestId('chore-form-min-age').props.value).toBe('8');
    expect(screen.getByTestId('chore-form-active').props.value).toBe(true);

    await type('chore-form-title', 'Sweep floor');
    await press('chore-form-room-r2');
    await press('chore-form-cadence-Daily');
    await type('chore-form-effort', '4');
    await type('chore-form-min-age', '');
    await act(async () => {
      fireEvent(screen.getByTestId('chore-form-active'), 'valueChange', false);
    });
    await press('chore-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/chores/c2',
      { title: 'Sweep floor', roomId: 'r2', cadence: 'Daily', effort: 4, minAge: null, active: false },
      { method: 'PUT', ifMatch: 'W/"c2-v1"' },
    );
    expect(within(screen.getByTestId('room-r1')).queryByTestId('chore-c2')).toBeNull();
    const garage = within(screen.getByTestId('room-r2'));
    expect(garage.getByTestId('chore-title-c2')).toHaveTextContent('Sweep floor');
    expect(garage.getByTestId('chore-meta-c2')).toHaveTextContent('Daily - effort 4 - any age - Inactive');
  });

  it('deactivates a chore and shows it inactive', async () => {
    const { client, update } = editorClient(async () => ok({ ...DISHES, active: false, eTag: 'W/"c1-v2"' }));
    await renderEditor(client);

    await press('deactivate-chore-c1');

    expect(update).toHaveBeenCalledWith('/households/hh-1/chores/c1/deactivate', {}, { method: 'POST' });
    expect(screen.getByTestId('chore-meta-c1')).toHaveTextContent('Daily - effort 1 - any age - Inactive');
    expect(screen.queryByTestId('deactivate-chore-c1')).toBeNull();
  });

  it('holds the write buttons while a write is in flight', async () => {
    let finish: (result: ApiResult<unknown>) => void = () => undefined;
    const { client, update } = editorClient(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderEditor(client);

    await press('deactivate-chore-c1');
    expect(screen.getByTestId('deactivate-chore-c2')).toBeDisabled();
    await press('deactivate-chore-c2');
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(ok({ ...DISHES, active: false }));
    });
    expect(screen.getByTestId('deactivate-chore-c2')).not.toBeDisabled();
  });

  it('removes a room with no active chores after confirm and a 204', async () => {
    const { client, update } = editorClient(async () => ({ ok: true, status: 204, data: undefined, etag: null }));
    await renderEditor(client);

    // Cancel first: nothing is sent.
    await press('remove-room-r2');
    expect(screen.getByTestId('remove-room-confirm-r2')).toBeOnTheScreen();
    await press('remove-room-cancel-r2');
    expect(screen.queryByTestId('remove-room-confirm-r2')).toBeNull();
    expect(update).not.toHaveBeenCalled();

    await press('remove-room-r2');
    await press('remove-room-confirm-r2');

    expect(update).toHaveBeenCalledWith('/households/hh-1/rooms/r2', undefined, { method: 'DELETE' });
    expect(screen.queryByTestId('room-r2')).toBeNull();
    // Its inactive chore stays reachable under "Not in a room".
    expect(within(screen.getByTestId('household-unroomed')).getByTestId('chore-c3')).toBeOnTheScreen();
  });

  it('refuses to remove a room that has active chores and sends no request', async () => {
    const { client, update } = editorClient();
    await renderEditor(client);

    await press('remove-room-r1');

    expect(screen.getByTestId('household-notice')).toHaveTextContent(
      "Move this room's active chores to another room or deactivate them first.",
    );
    expect(screen.queryByTestId('remove-room-confirm-r1')).toBeNull();
    expect(screen.getByTestId('room-r1')).toBeOnTheScreen();
    expect(update).not.toHaveBeenCalled();

    // Opening another editor clears the message.
    await press('rename-room-r1');
    expect(screen.queryByTestId('household-notice')).toBeNull();
  });

  it('shows a reload prompt on 412 and reloads without re-sending the edit', async () => {
    const { client, server, get, update } = editorClient(async () => ({
      ok: false,
      error: { kind: 'problem', status: 412, title: 'Precondition Failed' },
    }));
    await renderEditor(client);
    expect(get).toHaveBeenCalledTimes(2);

    await press('rename-room-r1');
    await type('rename-room-input-r1', 'Galley');
    await press('rename-room-save-r1');

    expect(screen.getByTestId('household-stale')).toBeOnTheScreen();
    expect(screen.queryByTestId('household-notice')).toBeNull();
    // The list is unchanged until the organizer reloads.
    expect(screen.getByTestId('rename-room-input-r1')).toBeOnTheScreen();

    server.rooms = ok([{ ...KITCHEN, name: 'Kitchen (other tablet)', eTag: 'W/"r1-v5"' }, GARAGE]);
    await press('household-reload');

    expect(get).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('household-stale')).toBeNull();
    expect(screen.queryByTestId('rename-room-input-r1')).toBeNull();
    expect(screen.getByTestId('room-name-r1')).toHaveTextContent('Kitchen (other tablet)');

    // The next edit carries the re-read ETag.
    await press('rename-room-r1');
    await press('rename-room-save-r1');
    expect(update).toHaveBeenLastCalledWith(
      '/households/hh-1/rooms/r1',
      { name: 'Kitchen (other tablet)', sortOrder: 0 },
      { method: 'PUT', ifMatch: 'W/"r1-v5"' },
    );
  });

  it('shows a reload prompt when a chore edit returns 412', async () => {
    const { client, update } = editorClient(async () => ({
      ok: false,
      error: { kind: 'problem', status: 412, title: 'Precondition Failed' },
    }));
    await renderEditor(client);

    await press('edit-chore-c1');
    await type('chore-form-title', 'Dishes and pans');
    await press('chore-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/chores/c1',
      { title: 'Dishes and pans', roomId: 'r1', cadence: 'Daily', effort: 1, minAge: null, active: true },
      { method: 'PUT', ifMatch: 'W/"c1-v1"' },
    );
    expect(screen.getByTestId('household-stale')).toBeOnTheScreen();
  });

  it('shows the problem-details message on 400 and on 404 and leaves the list unchanged', async () => {
    const { client, update } = editorClient(async (path) =>
      path.endsWith('/rooms')
        ? problem(400, 'Room name is required.')
        : problem(404, "No chore with id 'c2' exists."),
    );
    await renderEditor(client);

    await type('new-room-name', 'Den');
    await press('new-room-save');
    expect(screen.getByTestId('household-notice')).toHaveTextContent('Room name is required.');
    expect(screen.getAllByTestId(/^room-name-/)).toHaveLength(2);
    expect(screen.queryByTestId('household-stale')).toBeNull();

    await press('edit-chore-c2');
    await type('chore-form-title', 'Sweep floor');
    await press('chore-form-save');
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('household-notice')).toHaveTextContent("No chore with id 'c2' exists.");

    await press('chore-form-cancel');
    expect(screen.getByTestId('chore-title-c2')).toHaveTextContent('Sweep');
  });

  it('shows the problem message when adding a chore, deactivating, renaming, or removing fails', async () => {
    const { client } = editorClient(async (path, _body, options) =>
      problem(options?.method === 'DELETE' ? 404 : 400, `failed ${options?.method} ${path}`),
    );
    await renderEditor(client);

    await press('add-chore-r1');
    await type('chore-form-title', 'Mop');
    await press('chore-form-save');
    expect(screen.getByTestId('household-notice')).toHaveTextContent('failed POST /households/hh-1/chores');
    expect(screen.getByTestId('chore-form')).toBeOnTheScreen();

    await press('deactivate-chore-c1');
    expect(screen.getByTestId('household-notice')).toHaveTextContent(
      'failed POST /households/hh-1/chores/c1/deactivate',
    );
    expect(screen.getByTestId('chore-meta-c1')).toHaveTextContent('Daily - effort 1 - any age - Active');

    await press('rename-room-r2');
    await type('rename-room-input-r2', 'Shed');
    await press('rename-room-save-r2');
    expect(screen.getByTestId('household-notice')).toHaveTextContent('failed PUT /households/hh-1/rooms/r2');
    await press('rename-room-cancel-r2');
    expect(screen.getByTestId('room-name-r2')).toHaveTextContent('Garage');

    await press('remove-room-r2');
    await press('remove-room-confirm-r2');
    expect(screen.getByTestId('household-notice')).toHaveTextContent('failed DELETE /households/hh-1/rooms/r2');
    expect(screen.getByTestId('room-r2')).toBeOnTheScreen();
  });

  it('shows a load error and recovers on Try again', async () => {
    const { client, server, get } = editorClient();
    server.rooms = problem(500, 'Rooms are unavailable.');
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdEditor />
      </HouseholdProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('household-load-error')).toHaveTextContent('Rooms are unavailable.'),
    );

    server.rooms = ok([KITCHEN, GARAGE]);
    server.chores = problem(500, 'Chores are unavailable.');
    await press('household-reload');
    expect(screen.getByTestId('household-load-error')).toHaveTextContent('Chores are unavailable.');

    server.chores = ok([DISHES]);
    await press('household-reload');
    expect(get).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId('chore-c1')).toBeOnTheScreen();
  });

  it('says so and reads nothing when no household is selected', async () => {
    const { client, get } = editorClient();
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider>
        <HouseholdEditor />
      </HouseholdProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('household-load-error')).toHaveTextContent('No household is selected.'),
    );
    expect(screen.queryByTestId('household-reload')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('lists chores whose room is gone under Not in a room and needs a room to save them', async () => {
    const orphan: ChoreResponse = { ...SWEEP, choreId: 'c7', title: 'Water plants', roomId: 'gone', eTag: 'W/"c7-v1"' };
    const { client, server, update } = editorClient(async (path, body) =>
      ok({ choreId: 'c7', ...(body as object), eTag: 'W/"c7-v2"' }),
    );
    server.chores = ok([DISHES, orphan]);
    await renderEditor(client);

    const group = within(screen.getByTestId('household-unroomed'));
    expect(group.getByText('Not in a room')).toBeOnTheScreen();
    expect(group.getByTestId('chore-title-c7')).toHaveTextContent('Water plants');

    await press('edit-chore-c7');
    expect(screen.getByTestId('chore-form-save')).toBeDisabled();
    await press('chore-form-room-r1');
    await press('chore-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/chores/c7',
      { title: 'Water plants', roomId: 'r1', cadence: 'Weekly', effort: 2, minAge: 8, active: true },
      { method: 'PUT', ifMatch: 'W/"c7-v1"' },
    );
    expect(within(screen.getByTestId('room-r1')).getByTestId('chore-c7')).toBeOnTheScreen();
    expect(screen.queryByTestId('household-unroomed')).toBeNull();
  });

  it('keeps one editor open at a time', async () => {
    const { client } = editorClient();
    await renderEditor(client);

    await press('rename-room-r1');
    expect(screen.getByTestId('rename-room-input-r1')).toBeOnTheScreen();

    await press('add-chore-r2');
    expect(screen.queryByTestId('rename-room-input-r1')).toBeNull();
    expect(screen.getByTestId('chore-form')).toBeOnTheScreen();

    await press('remove-room-r2');
    expect(screen.queryByTestId('chore-form')).toBeNull();
    expect(screen.getByTestId('remove-room-confirm-r2')).toBeOnTheScreen();

    // A refused remove also closes whatever was open.
    await press('remove-room-r1');
    expect(screen.queryByTestId('remove-room-confirm-r2')).toBeNull();
  });
});
