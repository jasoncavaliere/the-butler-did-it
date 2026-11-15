import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { HouseholdTeardownScreen, TEARDOWN_COPY } from './HouseholdTeardownScreen';
import type { ApiClient, ApiError, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider } from '../auth/authProvider';
import { OrganizerBar } from '../auth/OrganizerBar';
import { typeScale } from '../layout/tokens';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { resetSessionFallbackStorage, type LocalStorageLike } from '../offline/storage';
import { currentWeekIso } from '../offline/weekIso';
import {
  assignmentDedupeKey,
  enqueueWrite,
  readWriteQueue,
  type WriteRequest,
} from '../offline/writeQueue';
import { HouseholdProvider, useHousehold } from '../state/HouseholdContext';
import { HubDeviceProvider, useHubDevice } from '../state/HubDeviceContext';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const WEEK = currentWeekIso();
const NAME = 'The Smith Home';

/** Install an in-memory `globalThis.localStorage`, so the cache and queue assertions are real. */
function installStorage(): void {
  const map = new Map<string, string>();
  const storage: LocalStorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function completion(householdId: string): WriteRequest {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, 'c1'),
    method: 'POST',
    path: `/households/${householdId}/assignments/${WEEK}/c1/complete`,
    body: { personId: 'p1' },
  };
}

/** Seed a household with a cached glance and one queued write. */
function seedHousehold(householdId: string): void {
  writeGlance(householdId, { household: { name: `Home ${householdId}`, people: [] } });
  enqueueWrite(householdId, completion(householdId));
}

/** A stand-in browser event target recording `online` and `offline` listeners. */
function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: string) => {
      for (const listener of Array.from(listeners.get(type) ?? [])) {
        listener();
      }
    },
  };
}

const deleted: ApiResult<void> = { ok: true, status: 204, data: undefined, etag: null };
const mismatch: ApiResult<never> = {
  ok: false,
  error: {
    kind: 'problem',
    status: 400,
    title: 'Bad Request',
    detail: "confirmName must exactly equal the household's name; nothing was deleted.",
  },
};

/** A client whose household read answers `read` and whose writes answer `write`. */
function teardownClient(
  write: () => Promise<ApiResult<unknown>> = () => Promise.resolve(deleted),
  read: ApiResult<unknown> = {
    ok: true,
    status: 200,
    data: { householdId: 'hh-1', name: NAME },
    etag: null,
  },
) {
  const get = jest.fn(async () => read);
  const update = jest.fn(write);
  const client: ApiClient = {
    baseUrl: 'http://api.test:1',
    get: get as unknown as ApiClient['get'],
    update: update as unknown as ApiClient['update'],
  };
  return { client, get, update };
}

const signOutSpy = jest.fn(() => Promise.resolve());
function fakeProvider(): IAuthProvider {
  return {
    kind: 'fake',
    signIn: () =>
      Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
    signOut: signOutSpy,
  };
}

/** Exposes the household id and device token the screen should clear. */
function Probe() {
  const { householdId } = useHousehold();
  const { deviceToken } = useHubDevice();
  return (
    <>
      <Text testID="probe-household">{householdId ?? 'none'}</Text>
      <Text testID="probe-device">{deviceToken ?? 'none'}</Text>
    </>
  );
}

async function renderTeardown({
  onCancel = jest.fn(),
  onDeleted = jest.fn(),
  connectivityTarget = fakeTarget(),
  waitForName = true,
}: {
  onCancel?: jest.Mock;
  onDeleted?: jest.Mock;
  connectivityTarget?: ReturnType<typeof fakeTarget>;
  /** Wait for the household name to show (false when the first read is meant to fail). */
  waitForName?: boolean;
} = {}) {
  await render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubDeviceProvider initialDeviceToken="device-tok">
        <OrganizerProvider authProvider={fakeProvider()}>
          <OrganizerBar />
          <Probe />
          <HouseholdTeardownScreen
            onCancel={onCancel}
            onDeleted={onDeleted}
            connectivityTarget={connectivityTarget}
          />
        </OrganizerProvider>
      </HubDeviceProvider>
    </HouseholdProvider>,
  );
  if (waitForName) {
    await screen.findByTestId('teardown-household-name');
  }
  return { onCancel, onDeleted, connectivityTarget };
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function type(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('teardown-confirm-input'), text);
  });
}

function deleteButton() {
  return screen.getByTestId('teardown-delete');
}

/** Everything AC7 clears, for the "nothing changed" assertions. */
function expectNothingLocalChanged() {
  expect(screen.getByTestId('probe-household')).toHaveTextContent('hh-1');
  expect(screen.getByTestId('probe-device')).toHaveTextContent('device-tok');
  expect(readGlance('hh-1')).not.toBeNull();
  expect(readWriteQueue('hh-1')).toHaveLength(1);
  expect(screen.getByTestId('organizer-identity')).toBeOnTheScreen();
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** Stub `navigator.onLine`, so the screen's first render sees the browser offline. */
function setNavigatorOnLine(onLine: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installStorage();
  resetSessionFallbackStorage();
  seedHousehold('hh-1');
  seedHousehold('hh-2');
  signOutSpy.mockClear();
});

afterEach(() => {
  useApiClientMock.mockReset();
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  resetSessionFallbackStorage();
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

describe('HouseholdTeardownScreen (#168)', () => {
  it('lists what will be deleted and that it cannot be undone (AC3)', async () => {
    const { client, get } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    await renderTeardown();

    expect(screen.getByRole('header', { name: 'Delete household' })).toBeOnTheScreen();
    const deletes = screen.getByTestId('teardown-deletes');
    for (const item of [
      'People',
      'Rooms',
      'Chores',
      'Assignments and their history',
      'Grocery carts',
      'Paired hub devices',
    ]) {
      expect(within(deletes).getByText(`- ${item}`)).toBeOnTheScreen();
    }
    expect(screen.getByTestId('teardown-irreversible')).toHaveTextContent('This cannot be undone.');
    expect(screen.getByTestId('teardown-household-name')).toHaveTextContent(NAME);
    expect(get).toHaveBeenCalledWith('/households/hh-1');
  });

  it('keeps every copy string plain ASCII at or above the body size', async () => {
    const { client } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    await renderTeardown();

    expect(JSON.stringify(TEARDOWN_COPY)).toMatch(/^[\x00-\x7F]*$/);
    const irreversible = screen.getByTestId('teardown-irreversible');
    expect(StyleSheet.flatten(irreversible.props.style).fontSize).toBeGreaterThanOrEqual(
      typeScale.body,
    );
  });

  it('shows a loading state until the household name is read', async () => {
    let answer: (result: ApiResult<unknown>) => void = () => undefined;
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      answer = resolve;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };
    useApiClientMock.mockReturnValue(client);

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdTeardownScreen onCancel={jest.fn()} onDeleted={jest.fn()} />
      </HouseholdProvider>,
    );

    expect(screen.getByTestId('teardown-loading')).toBeOnTheScreen();
    expect(deleteButton()).toBeDisabled();

    await act(async () => {
      answer({ ok: true, status: 200, data: { name: NAME }, etag: null });
    });
    expect(screen.queryByTestId('teardown-loading')).toBeNull();
    expect(screen.getByTestId('teardown-household-name')).toHaveTextContent(NAME);
  });

  it('ignores a household read that lands after unmount', async () => {
    let answer: (result: ApiResult<unknown>) => void = () => undefined;
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      answer = resolve;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };
    useApiClientMock.mockReturnValue(client);

    const view = await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdTeardownScreen onCancel={jest.fn()} onDeleted={jest.fn()} />
      </HouseholdProvider>,
    );
    await view.unmount();

    await expect(
      act(async () => {
        answer({ ok: true, status: 200, data: { name: NAME }, etag: null });
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps Delete disabled when the household cannot be read', async () => {
    const { client, update } = teardownClient(undefined, {
      ok: false,
      error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
    });
    useApiClientMock.mockReturnValue(client);

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdTeardownScreen onCancel={jest.fn()} onDeleted={jest.fn()} />
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('teardown-load-error')).toHaveTextContent(
      /household service is unreachable/,
    );
    expect(screen.queryByTestId('teardown-confirm-input')).toBeNull();
    expect(deleteButton()).toBeDisabled();
    await press('teardown-delete');
    expect(update).not.toHaveBeenCalled();
  });

  it('reads nothing while no household is selected', async () => {
    const { client, get } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    await render(
      <HouseholdProvider>
        <HouseholdTeardownScreen onCancel={jest.fn()} onDeleted={jest.fn()} />
      </HouseholdProvider>,
    );

    expect(screen.getByTestId('teardown-loading')).toBeOnTheScreen();
    expect(get).not.toHaveBeenCalled();
    expect(deleteButton()).toBeDisabled();
  });

  it('keeps Delete disabled with a sign-in line while no organizer is signed in', async () => {
    const { client, update } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    await renderTeardown();
    await type(NAME);

    expect(screen.getByTestId('teardown-signed-out')).toHaveTextContent(TEARDOWN_COPY.signedOut);
    expect(deleteButton()).toBeDisabled();
    await press('teardown-delete');
    expect(update).not.toHaveBeenCalled();

    await press('organizer-sign-in');
    expect(screen.queryByTestId('teardown-signed-out')).toBeNull();
    expect(deleteButton()).toBeEnabled();
  });

  it.each([
    ['empty', ''],
    ['different case', NAME.toLowerCase()],
    ['trailing space', `${NAME} `],
    ['leading space', ` ${NAME}`],
    ['prefix', NAME.slice(0, -1)],
  ])(
    'keeps Delete disabled and sends nothing until the typed name matches exactly (%s) (AC4)',
    async (_label, text) => {
      const { client, update } = teardownClient();
      useApiClientMock.mockReturnValue(client);

      await renderTeardown();
      await press('organizer-sign-in');
      await type(text);

      expect(deleteButton()).toBeDisabled();
      await press('teardown-delete');
      expect(update).not.toHaveBeenCalled();

      await type(NAME);
      expect(deleteButton()).toBeEnabled();
    },
  );

  it('Cancel sends nothing and changes no local state (AC5)', async () => {
    const { client, update } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    const { onCancel, onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-cancel');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expectNothingLocalChanged();
  });

  it('confirm sends one DELETE /households/{id} with { confirmName } (AC6)', async () => {
    let answer: (result: ApiResult<unknown>) => void = () => undefined;
    const { client, update } = teardownClient(
      () =>
        new Promise<ApiResult<unknown>>((resolve) => {
          answer = resolve;
        }),
    );
    useApiClientMock.mockReturnValue(client);

    const { onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-delete');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('/households/hh-1', { confirmName: NAME }, { method: 'DELETE' });

    // In flight: the button says so, and neither a second press nor Cancel acts.
    expect(deleteButton()).toHaveTextContent('Deleting...');
    expect(deleteButton()).toBeDisabled();
    expect(screen.getByTestId('teardown-cancel')).toBeDisabled();
    await press('teardown-delete');
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(deleted);
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("on success clears the household id, device token, this household's cache and queue (AC7)", async () => {
    const { client } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    const { onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-delete');

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe-household')).toHaveTextContent('none');
    expect(screen.getByTestId('probe-device')).toHaveTextContent('none');
    expect(readGlance('hh-1')).toBeNull();
    expect(readWriteQueue('hh-1')).toEqual([]);
    // Another household's offline state is untouched.
    expect(readGlance('hh-2')).not.toBeNull();
    expect(readWriteQueue('hh-2')).toHaveLength(1);
  });

  it('on success signs the organizer out (AC8)', async () => {
    const { client } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    await renderTeardown();
    await press('organizer-sign-in');
    expect(screen.getByTestId('organizer-identity')).toBeOnTheScreen();
    await type(NAME);
    await press('teardown-delete');

    await waitFor(() => expect(screen.queryByTestId('organizer-identity')).toBeNull());
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('organizer-sign-in')).toHaveTextContent('Organizer sign in');
    expect(screen.queryByTestId('organizer-actions')).toBeNull();
  });

  it('a 400 shows the problem detail and changes nothing (AC10)', async () => {
    const { client, update } = teardownClient(() => Promise.resolve(mismatch));
    useApiClientMock.mockReturnValue(client);

    const { onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-delete');

    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('teardown-error')).toHaveTextContent(
      "confirmName must exactly equal the household's name; nothing was deleted.",
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expectNothingLocalChanged();
    // Back to idle: the organizer can try again.
    expect(deleteButton()).toHaveTextContent('Delete household');
    expect(deleteButton()).toBeEnabled();
    expect(screen.getByTestId('teardown-cancel')).toBeEnabled();
  });

  it.each<[string, ApiError, RegExp]>([
    [
      'network',
      { kind: 'network', status: 0, title: 'The API is unreachable.' },
      /household service is unreachable/,
    ],
    ['http 500', { kind: 'http', status: 500, title: 'Internal Server Error' }, /Internal Server Error/],
  ])('any other failure shows its message and changes nothing (%s) (AC10)', async (_label, error, message) => {
    const { client } = teardownClient(() => Promise.resolve({ ok: false, error }));
    useApiClientMock.mockReturnValue(client);

    const { onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-delete');

    expect(screen.getByTestId('teardown-error')).toHaveTextContent(message);
    expect(onDeleted).not.toHaveBeenCalled();
    expectNothingLocalChanged();
  });

  it('a retry after a failure clears the old error', async () => {
    const answers = [mismatch, deleted];
    const { client, update } = teardownClient(() => Promise.resolve(answers.shift()!));
    useApiClientMock.mockReturnValue(client);

    const { onDeleted } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    await press('teardown-delete');
    expect(screen.getByTestId('teardown-error')).toBeOnTheScreen();

    await press('teardown-delete');
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('teardown-error')).toBeNull();
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('offline disables Delete with a needs-connection message and never queues (AC11)', async () => {
    const { client, update } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    const { connectivityTarget } = await renderTeardown();
    await press('organizer-sign-in');
    await type(NAME);
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByTestId('teardown-offline')).toBeNull();

    await act(async () => {
      connectivityTarget.emit('offline');
    });

    expect(screen.getByTestId('teardown-offline')).toHaveTextContent(
      'Deleting the household needs a connection. Reconnect, then try again.',
    );
    expect(deleteButton()).toBeDisabled();
    await press('teardown-delete');
    expect(update).not.toHaveBeenCalled();
    // Never queued: the household's queue still holds only the seeded tap.
    expect(readWriteQueue('hh-1')).toEqual([expect.objectContaining({ kind: 'chore-complete' })]);
    expectNothingLocalChanged();

    await act(async () => {
      connectivityTarget.emit('online');
    });
    expect(screen.queryByTestId('teardown-offline')).toBeNull();
    expect(deleteButton()).toBeEnabled();
  });
});

describe('HouseholdTeardownScreen reconnect (#252)', () => {
  const unreachable: ApiResult<never> = {
    ok: false,
    error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
  };
  const household: ApiResult<unknown> = {
    ok: true,
    status: 200,
    data: { householdId: 'hh-1', name: NAME },
    etag: null,
  };

  it('opened offline, re-reads the household on reconnect and enables Delete once the name matches (#252)', async () => {
    setNavigatorOnLine(false);
    const { client, get } = teardownClient();
    get.mockResolvedValueOnce(unreachable).mockResolvedValueOnce(household);
    useApiClientMock.mockReturnValue(client);

    const { connectivityTarget } = await renderTeardown({ waitForName: false });

    expect(await screen.findByTestId('teardown-load-error')).toHaveTextContent(
      /household service is unreachable/,
    );
    expect(screen.getByTestId('teardown-offline')).toBeOnTheScreen();
    expect(get).toHaveBeenCalledTimes(1);
    await press('organizer-sign-in');
    expect(deleteButton()).toBeDisabled();

    setNavigatorOnLine(true);
    await act(async () => {
      connectivityTarget.emit('online');
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, '/households/hh-1');
    expect(get).toHaveBeenNthCalledWith(2, '/households/hh-1');
    expect(await screen.findByTestId('teardown-household-name')).toHaveTextContent(NAME);
    expect(screen.queryByTestId('teardown-load-error')).toBeNull();
    expect(screen.queryByTestId('teardown-offline')).toBeNull();
    expect(deleteButton()).toBeDisabled();

    await type(NAME);
    expect(deleteButton()).toBeEnabled();
  });

  it('retries again on the next reconnect when the re-read also fails (#252)', async () => {
    const { client, get } = teardownClient();
    get
      .mockResolvedValueOnce(unreachable)
      .mockResolvedValueOnce(unreachable)
      .mockResolvedValueOnce(household);
    useApiClientMock.mockReturnValue(client);

    const { connectivityTarget } = await renderTeardown({ waitForName: false });
    expect(await screen.findByTestId('teardown-load-error')).toBeOnTheScreen();

    await act(async () => {
      connectivityTarget.emit('online');
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('teardown-load-error')).toBeOnTheScreen();

    await act(async () => {
      connectivityTarget.emit('online');
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(await screen.findByTestId('teardown-household-name')).toHaveTextContent(NAME);
  });

  it('makes no extra household read on reconnect once the name has loaded (#252)', async () => {
    const { client, get } = teardownClient();
    useApiClientMock.mockReturnValue(client);

    const { connectivityTarget } = await renderTeardown();
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      connectivityTarget.emit('offline');
    });
    await act(async () => {
      connectivityTarget.emit('online');
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('teardown-household-name')).toHaveTextContent(NAME);
  });
});
