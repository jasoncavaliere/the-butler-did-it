import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RosterEditor } from './RosterEditor';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import type { PersonResponse, RosterEntryResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type UpdateFn = (path: string, body: unknown, options?: UpdateOptions) => Promise<ApiResult<unknown>>;

const BLUE = '#77A8FF';
const GRASS = '#83C24E';

const ALEX: RosterEntryResponse = { personId: 'p1', displayName: 'Alex', claimColor: BLUE, isChild: false };
const SAM: RosterEntryResponse = { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true };

/** The single-person read: the roster entry plus the role and ETag the list leaves out. */
function personRead(entry: RosterEntryResponse, role: string, eTag: string): PersonResponse {
  return { ...entry, role, eTag };
}

function ok<T>(data: T, status = 200): ApiResult<T> {
  return { ok: true, status, data, etag: null };
}

function problem(status: number, detail: string): ApiResult<never> {
  return { ok: false, error: { kind: 'problem', status, title: 'Problem', detail } };
}

/**
 * A client whose reads answer from a mutable server snapshot (so a test can
 * change what a re-read sees) and whose writes run the supplied handler.
 */
function rosterClient(
  update: UpdateFn = async () => {
    throw new Error('unexpected write');
  },
) {
  const server: { people: ApiResult<unknown>; person: Record<string, ApiResult<unknown>> } = {
    people: ok([ALEX, SAM]),
    person: {
      p1: ok(personRead(ALEX, 'Organizer', 'W/"p1-v1"')),
      p2: ok(personRead(SAM, 'Participant', 'W/"p2-v1"')),
    },
  };
  const get = jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
    if (path === '/households/hh-1/people') {
      return server.people;
    }
    const match = /^\/households\/hh-1\/people\/(\w+)$/.exec(path);
    if (match && server.person[match[1]]) {
      return server.person[match[1]];
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

/** A promise the test resolves by hand, to hold a read in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

async function renderEditor(client: ApiClient, props: { onDone?: () => void } = {}) {
  useApiClientMock.mockReturnValue(client);
  await render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <RosterEditor {...props} />
    </HouseholdProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen());
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('RosterEditor', () => {
  it('lists every person from the roster read with name, child flag, and claim colour', async () => {
    const { client, get } = rosterClient();
    await renderEditor(client);

    expect(get).toHaveBeenCalledWith('/households/hh-1/people');
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex');
    expect(screen.getByTestId('roster-child-p1')).toHaveTextContent('Adult');
    expect(StyleSheet.flatten(screen.getByTestId('roster-color-p1').props.style).backgroundColor).toBe(BLUE);
    expect(screen.getByTestId('roster-color-p1').props.accessibilityLabel).toBe(BLUE);

    expect(screen.getByTestId('roster-name-p2')).toHaveTextContent('Sam');
    expect(screen.getByTestId('roster-child-p2')).toHaveTextContent('Child');
    // No claim colour: a hollow dot labelled as such.
    expect(StyleSheet.flatten(screen.getByTestId('roster-color-p2').props.style).backgroundColor).toBeUndefined();
    expect(screen.getByTestId('roster-color-p2').props.accessibilityLabel).toBe('No colour');
    expect(screen.queryByTestId('roster-empty')).toBeNull();
  });

  it('shows the empty line when the roster has nobody', async () => {
    const { client, server } = rosterClient();
    server.people = ok([]);
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <RosterEditor />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('roster-empty')).toBeOnTheScreen());
    expect(screen.getByTestId('roster-add-person')).toBeOnTheScreen();
  });

  it('opens a person by reading GET .../people/{id} and shows name, child and colour fields with no role field', async () => {
    const { client, get } = rosterClient();
    await renderEditor(client);

    await press('roster-edit-p2');

    expect(get).toHaveBeenLastCalledWith('/households/hh-1/people/p2');
    const form = screen.getByTestId('roster-form');
    expect(within(form).getByTestId('input-person-name').props.value).toBe('Sam');
    expect(within(form).getByTestId('input-person-child').props.value).toBe(true);
    expect(within(form).getByTestId('claim-color-blue').props.accessibilityState).toEqual({ selected: false });
    // No role control, and the role from the read is never shown.
    expect(within(form).queryByText(/role/i)).toBeNull();
    expect(screen.queryByText('Participant')).toBeNull();
    // The form stands in for the row.
    expect(screen.queryByTestId('roster-person-p2')).toBeNull();
  });

  it('shows a loading line while the person read is in flight', async () => {
    const { client, get } = rosterClient();
    await renderEditor(client);
    const read = deferred<ApiResult<unknown>>();
    get.mockImplementationOnce(() => read.promise);

    await press('roster-edit-p1');
    expect(within(screen.getByTestId('roster-person-p1')).getByTestId('roster-edit-loading')).toBeOnTheScreen();

    await act(async () => {
      read.resolve(ok(personRead(ALEX, 'Participant', 'W/"p1-v1"')));
    });
    expect(screen.queryByTestId('roster-edit-loading')).toBeNull();
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alex');
  });

  it('saves an edit with PUT, If-Match from that read and the role unchanged, and shows the new values after a 200', async () => {
    const { client, update } = rosterClient(async (_path, body) =>
      ok({ ...(body as object), personId: 'p1', eTag: 'W/"p1-v2"' }),
    );
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', '  Alexis  ');
    await act(async () => {
      fireEvent(screen.getByTestId('input-person-child'), 'valueChange', true);
    });
    await press('claim-color-grass');
    await press('roster-form-save');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/people/p1',
      { displayName: 'Alexis', role: 'Organizer', isChild: true, claimColor: GRASS },
      { method: 'PUT', ifMatch: 'W/"p1-v1"' },
    );
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alexis');
    expect(screen.getByTestId('roster-child-p1')).toHaveTextContent('Child');
    expect(StyleSheet.flatten(screen.getByTestId('roster-color-p1').props.style).backgroundColor).toBe(GRASS);
  });

  it('sends an untouched non-preset colour back unchanged', async () => {
    const { client, server, update } = rosterClient(async (_path, body) =>
      ok({ ...(body as object), personId: 'p1', eTag: 'W/"p1-v2"' }),
    );
    server.person.p1 = ok(personRead({ ...ALEX, claimColor: '#123456' }, 'Participant', 'W/"p1-v1"'));
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Al');
    await press('roster-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/people/p1',
      { displayName: 'Al', role: 'Participant', isChild: false, claimColor: '#123456' },
      { method: 'PUT', ifMatch: 'W/"p1-v1"' },
    );
  });

  it('disables Save and sends nothing when the trimmed name is empty', async () => {
    const { client, update } = rosterClient();
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', '   ');
    expect(screen.getByTestId('roster-form-save')).toBeDisabled();
    await press('roster-form-save');
    expect(update).not.toHaveBeenCalled();

    // The add form has the same rule.
    await press('roster-form-cancel');
    await press('roster-add-person');
    expect(screen.getByTestId('roster-form-save')).toBeDisabled();
    await press('roster-form-save');
    expect(update).not.toHaveBeenCalled();
  });

  it('shows a reload prompt on 412 and reload re-reads the person and its ETag without re-sending', async () => {
    const { client, server, get, update } = rosterClient(async () => ({
      ok: false,
      error: { kind: 'problem', status: 412, title: 'Precondition Failed' },
    }));
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Alexis');
    await press('roster-form-save');

    expect(screen.getByTestId('roster-stale')).toBeOnTheScreen();
    expect(screen.queryByTestId('roster-notice')).toBeNull();
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alexis');
    expect(get).toHaveBeenCalledTimes(2);

    server.person.p1 = ok(personRead({ ...ALEX, displayName: 'Alex (other tablet)' }, 'Organizer', 'W/"p1-v5"'));
    await press('roster-reload');

    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenLastCalledWith('/households/hh-1/people/p1');
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('roster-stale')).toBeNull();
    // The form now shows the fresh read.
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alex (other tablet)');

    // The next save carries the re-read ETag.
    await press('roster-form-save');
    expect(update).toHaveBeenLastCalledWith(
      '/households/hh-1/people/p1',
      { displayName: 'Alex (other tablet)', role: 'Organizer', isChild: false, claimColor: BLUE },
      { method: 'PUT', ifMatch: 'W/"p1-v5"' },
    );

    // Cancelling leaves the list showing the re-read values.
    await press('roster-form-cancel');
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex (other tablet)');
  });

  it('closes the editor, shows the message and re-reads the list when the reload re-read fails', async () => {
    const { client, server, get } = rosterClient(async () => ({
      ok: false,
      error: { kind: 'problem', status: 412, title: 'Precondition Failed' },
    }));
    await renderEditor(client);

    await press('roster-edit-p1');
    await press('roster-form-save');
    server.person.p1 = problem(404, 'That person is no longer in this household.');
    server.people = ok([SAM]);
    await press('roster-reload');

    expect(screen.getByTestId('roster-notice')).toHaveTextContent('That person is no longer in this household.');
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.queryByTestId('roster-stale')).toBeNull();
    expect(get).toHaveBeenLastCalledWith('/households/hh-1/people');
    expect(screen.queryByTestId('roster-person-p1')).toBeNull();
    expect(screen.getByTestId('roster-person-p2')).toBeOnTheScreen();
  });

  it('ignores a reload re-read that lands after the editor was cancelled', async () => {
    const { client, get } = rosterClient(async () => ({
      ok: false,
      error: { kind: 'problem', status: 412, title: 'Precondition Failed' },
    }));
    await renderEditor(client);

    await press('roster-edit-p1');
    await press('roster-form-save');
    const read = deferred<ApiResult<unknown>>();
    get.mockImplementationOnce(() => read.promise);
    await press('roster-reload');
    await press('roster-form-cancel');
    await act(async () => {
      read.resolve(ok(personRead({ ...ALEX, displayName: 'Late' }, 'Organizer', 'W/"p1-v9"')));
    });

    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex');
  });

  it('shows the problem-details message when a save or a delete returns 400 and leaves the person unchanged', async () => {
    const { client, update } = rosterClient(async () =>
      problem(400, 'A household must keep at least one organizer.'),
    );
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Alexis');
    await press('roster-form-save');

    expect(screen.getByTestId('roster-notice')).toHaveTextContent('A household must keep at least one organizer.');
    expect(screen.queryByTestId('roster-stale')).toBeNull();
    // The form stays open with the edit; the list is unchanged underneath.
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alexis');
    await press('roster-form-cancel');
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex');

    await press('roster-remove-p1');
    expect(screen.queryByTestId('roster-notice')).toBeNull();
    await press('roster-remove-confirm-p1');

    expect(update).toHaveBeenLastCalledWith('/households/hh-1/people/p1', undefined, { method: 'DELETE' });
    expect(screen.getByTestId('roster-notice')).toHaveTextContent('A household must keep at least one organizer.');
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex');
    expect(screen.queryByTestId('roster-remove-confirmation-p1')).toBeNull();
  });

  it('adds a person as a Participant through the people-step fields and lists them after a 201', async () => {
    const { client, update } = rosterClient(async (_path, body) =>
      ok({ ...(body as object), personId: 'p3', eTag: 'W/"p3-v1"' }, 201),
    );
    await renderEditor(client);

    await press('roster-add-person');
    const form = screen.getByTestId('roster-form');
    expect(within(form).getByTestId('input-person-name').props.value).toBe('');
    expect(within(form).getByTestId('input-person-child').props.value).toBe(false);
    expect(within(form).queryByText(/role/i)).toBeNull();

    await type('input-person-name', ' Jo ');
    await act(async () => {
      fireEvent(screen.getByTestId('input-person-child'), 'valueChange', true);
    });
    await press('claim-color-grass');
    await press('roster-form-save');

    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/people',
      { displayName: 'Jo', role: 'Participant', isChild: true, claimColor: GRASS },
      { method: 'POST' },
    );
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-name-p3')).toHaveTextContent('Jo');
    expect(screen.getByTestId('roster-child-p3')).toHaveTextContent('Child');
    expect(screen.getByTestId('roster-add-person')).toBeOnTheScreen();
  });

  it('keeps the add form open and shows the message when an add fails', async () => {
    const { client } = rosterClient(async () => problem(400, 'DisplayName is too long.'));
    await renderEditor(client);

    await press('roster-add-person');
    await type('input-person-name', 'Jo');
    await press('roster-form-save');

    expect(screen.getByTestId('roster-notice')).toHaveTextContent('DisplayName is too long.');
    expect(screen.getByTestId('roster-form')).toBeOnTheScreen();
    expect(screen.queryByTestId('roster-person-p3')).toBeNull();
  });

  it('asks to confirm a removal naming the person, and Cancel closes it with no request', async () => {
    const { client, update } = rosterClient();
    await renderEditor(client);

    await press('roster-remove-p2');
    expect(screen.getByTestId('roster-remove-confirmation-p2')).toHaveTextContent(
      'Remove Sam? Their chores this week will show as Unassigned.',
    );

    await press('roster-remove-cancel-p2');
    expect(screen.queryByTestId('roster-remove-confirmation-p2')).toBeNull();
    expect(screen.getByTestId('roster-person-p2')).toBeOnTheScreen();
    expect(update).not.toHaveBeenCalled();
  });

  it('removes a person with DELETE after confirm and drops them from the list after a 204', async () => {
    const { client, update } = rosterClient(async () => ({ ok: true, status: 204, data: undefined, etag: null }));
    await renderEditor(client);

    await press('roster-remove-p2');
    await press('roster-remove-confirm-p2');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('/households/hh-1/people/p2', undefined, { method: 'DELETE' });
    expect(screen.queryByTestId('roster-person-p2')).toBeNull();
    expect(screen.queryByTestId('roster-remove-confirmation-p2')).toBeNull();
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
    expect(screen.queryByTestId('roster-notice')).toBeNull();
  });

  it('holds Edit, Remove and Add while a save is in flight, then shows the saved person', async () => {
    const held = deferred<ApiResult<unknown>>();
    const { client, get, update } = rosterClient(() => held.promise);
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Alexis');
    await press('roster-form-save');

    expect(screen.getByTestId('roster-edit-p2')).toBeDisabled();
    expect(screen.getByTestId('roster-remove-p2')).toBeDisabled();
    expect(screen.getByTestId('roster-add-person')).toBeDisabled();
    await press('roster-edit-p2');
    await press('roster-remove-p2');
    await press('roster-add-person');
    // Nothing opened: still the one p1 form, and p2 was never read.
    expect(screen.getAllByTestId('roster-form')).toHaveLength(1);
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alexis');
    expect(screen.queryByTestId('roster-remove-confirmation-p2')).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/households/hh-1/people/p2');

    await act(async () => {
      held.resolve(ok(personRead({ ...ALEX, displayName: 'Alexis' }, 'Organizer', 'W/"p1-v2"')));
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alexis');
    expect(screen.getByTestId('roster-name-p2')).toHaveTextContent('Sam');
    expect(screen.getByTestId('roster-edit-p2')).not.toBeDisabled();
    expect(screen.getByTestId('roster-remove-p2')).not.toBeDisabled();
    expect(screen.getByTestId('roster-add-person')).not.toBeDisabled();
  });

  it('holds Edit and Remove while an add is in flight, then lists the added person', async () => {
    const held = deferred<ApiResult<unknown>>();
    const { client, get, update } = rosterClient(() => held.promise);
    await renderEditor(client);

    await press('roster-add-person');
    await type('input-person-name', 'Jo');
    await press('roster-form-save');

    for (const id of ['p1', 'p2']) {
      expect(screen.getByTestId(`roster-edit-${id}`)).toBeDisabled();
      expect(screen.getByTestId(`roster-remove-${id}`)).toBeDisabled();
    }
    await press('roster-edit-p1');
    await press('roster-remove-p2');
    expect(get).not.toHaveBeenCalledWith('/households/hh-1/people/p1');
    expect(screen.queryByTestId('roster-remove-confirmation-p2')).toBeNull();
    expect(screen.getByTestId('input-person-name').props.value).toBe('Jo');

    await act(async () => {
      const jo: RosterEntryResponse = { personId: 'p3', displayName: 'Jo', claimColor: null, isChild: false };
      held.resolve(ok(personRead(jo, 'Participant', 'W/"p3-v1"'), 201));
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-name-p3')).toHaveTextContent('Jo');
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('roster-person-p2')).toBeOnTheScreen();
    expect(screen.getByTestId('roster-edit-p1')).not.toBeDisabled();
  });

  it('holds Edit, Remove and Add while a remove is in flight, then drops the person', async () => {
    const held = deferred<ApiResult<unknown>>();
    const { client, get, update } = rosterClient(() => held.promise);
    await renderEditor(client);

    await press('roster-remove-p2');
    await press('roster-remove-confirm-p2');

    expect(screen.getByTestId('roster-edit-p1')).toBeDisabled();
    expect(screen.getByTestId('roster-remove-p1')).toBeDisabled();
    expect(screen.getByTestId('roster-add-person')).toBeDisabled();
    await press('roster-edit-p1');
    await press('roster-remove-p1');
    await press('roster-add-person');
    expect(get).not.toHaveBeenCalledWith('/households/hh-1/people/p1');
    expect(screen.queryByTestId('roster-remove-confirmation-p1')).toBeNull();
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-remove-confirmation-p2')).toBeOnTheScreen();

    await act(async () => {
      held.resolve({ ok: true, status: 204, data: undefined, etag: null });
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('roster-person-p2')).toBeNull();
    expect(screen.queryByTestId('roster-remove-confirmation-p2')).toBeNull();
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('roster-add-person')).not.toBeDisabled();
  });

  it('keeps the editor closed when a save cancelled in flight comes back 412', async () => {
    const held = deferred<ApiResult<unknown>>();
    const { client } = rosterClient(() => held.promise);
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Alexis');
    await press('roster-form-save');
    await press('roster-form-cancel');
    expect(screen.queryByTestId('roster-form')).toBeNull();

    await act(async () => {
      held.resolve({ ok: false, error: { kind: 'problem', status: 412, title: 'Precondition Failed' } });
    });
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.queryByTestId('roster-stale')).toBeNull();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alex');
    expect(screen.getByTestId('roster-edit-p1')).not.toBeDisabled();
  });

  it('keeps what was typed during a save that comes back 412', async () => {
    const held = deferred<ApiResult<unknown>>();
    const { client } = rosterClient(() => held.promise);
    await renderEditor(client);

    await press('roster-edit-p1');
    await type('input-person-name', 'Alexis');
    await press('roster-form-save');
    await type('input-person-name', 'Alexis B');

    await act(async () => {
      held.resolve({ ok: false, error: { kind: 'problem', status: 412, title: 'Precondition Failed' } });
    });
    expect(screen.getByTestId('roster-stale')).toBeOnTheScreen();
    expect(screen.getByTestId('input-person-name').props.value).toBe('Alexis B');
  });

  it('shows the message and closes the editor when the person read fails', async () => {
    const { client, server } = rosterClient();
    server.person.p1 = problem(404, 'Person not found.');
    await renderEditor(client);

    await press('roster-edit-p1');

    expect(screen.getByTestId('roster-notice')).toHaveTextContent('Person not found.');
    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.queryByTestId('roster-edit-loading')).toBeNull();
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
  });

  it('ignores a person read that lands after another editor was opened', async () => {
    const { client, get } = rosterClient();
    await renderEditor(client);
    const read = deferred<ApiResult<unknown>>();
    get.mockImplementationOnce(() => read.promise);

    await press('roster-edit-p1');
    await press('roster-remove-p2');
    await act(async () => {
      read.resolve(ok(personRead(ALEX, 'Participant', 'W/"p1-v1"')));
    });

    expect(screen.queryByTestId('roster-form')).toBeNull();
    expect(screen.getByTestId('roster-remove-confirmation-p2')).toBeOnTheScreen();
  });

  it('shows the load error with Try again, which re-reads the roster', async () => {
    const { client, server, get } = rosterClient();
    server.people = { ok: false, error: { kind: 'network', status: 0, title: 'Network error' } };
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <RosterEditor />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('roster-load-error')).toBeOnTheScreen());
    expect(screen.queryByTestId('roster-done')).toBeNull();

    server.people = ok([ALEX]);
    await press('roster-retry');

    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('roster-person-p1')).toBeOnTheScreen();
  });

  it('shows the no-household message and sends no request without a household', async () => {
    const { client, get } = rosterClient();
    const onDone = jest.fn();
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId={null}>
        <RosterEditor onDone={onDone} />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('roster-load-error')).toHaveTextContent('No household is selected.'));
    expect(screen.queryByTestId('roster-retry')).toBeNull();
    expect(get).not.toHaveBeenCalled();
    // Done still leads back out.
    await press('roster-done');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows the loading state and ignores a roster read that lands after unmount', async () => {
    const { client, get } = rosterClient();
    const read = deferred<ApiResult<unknown>>();
    get.mockImplementationOnce(() => read.promise);
    useApiClientMock.mockReturnValue(client);
    const view = await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <RosterEditor />
      </HouseholdProvider>,
    );

    expect(screen.getByTestId('roster-loading')).toBeOnTheScreen();
    await view.unmount();
    await act(async () => {
      read.resolve(ok([ALEX]));
    });
    expect(screen.queryByTestId('roster-person-p1')).toBeNull();
  });

  it('renders Done only when onDone is supplied, and calls it', async () => {
    const { client } = rosterClient();
    const onDone = jest.fn();
    await renderEditor(client, { onDone });

    await press('roster-done');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders no Done button without onDone', async () => {
    const { client } = rosterClient();
    await renderEditor(client);

    expect(screen.queryByTestId('roster-done')).toBeNull();
  });
});
