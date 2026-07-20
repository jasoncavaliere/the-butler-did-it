import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HouseholdSetup } from './HouseholdSetup';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider, useHousehold } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type UpdateFn = (path: string, body: unknown, options?: UpdateOptions) => Promise<ApiResult<unknown>>;

/** Build a mock client whose `update` runs the supplied handler. */
function clientWith(update: UpdateFn): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn() as unknown as ApiClient['get'],
    update: jest.fn(update) as unknown as ApiClient['update'],
  };
}

function ok<T>(data: T, etag: string | null = '"v1"'): ApiResult<T> {
  return { ok: true, status: 201, data, etag };
}

// React 19 does not flush the re-render triggered by a bare fireEvent before the
// next line runs, so a later interaction would read stale state (and an async
// press handler would resolve outside act). Wrapping each interaction in an
// async act() runs its full lifecycle - state commit and any awaited handler -
// inside one act, so the next line sees settled state.
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
async function setSwitch(testID: string, value: boolean) {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'valueChange', value);
  });
}

/** Surfaces the current household id from context so tests can assert on it. */
function HouseholdProbe() {
  const { householdId } = useHousehold();
  return <Text testID="context-household">hh:{householdId ?? 'none'}</Text>;
}

function renderSetup() {
  return render(
    <HouseholdProvider>
      <HouseholdSetup />
      <HouseholdProbe />
    </HouseholdProvider>,
  );
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HouseholdSetup', () => {
  it('walks the full flow and ends with the new household in context', async () => {
    const update: UpdateFn = async (path) => {
      if (path === '/households') {
        return ok({
          householdId: 'hh-1',
          name: 'The Smiths',
          organizerObjectId: 'org-1',
          createdUtc: '2026-07-20T00:00:00Z',
          etag: '"h1"',
        });
      }
      if (path.endsWith('/rooms')) {
        return ok({ roomId: 'room-1', name: 'Kitchen', sortOrder: 0, etag: '"r1"' });
      }
      if (path.endsWith('/people')) {
        return ok({
          personId: 'p-1',
          displayName: 'Alex',
          role: 'Participant',
          isChild: true,
          claimColor: '#7FB2E5',
          etag: '"p1"',
        });
      }
      if (path.endsWith('/chores')) {
        return ok({
          choreId: 'c-1',
          title: 'Take out the trash',
          roomId: 'room-1',
          cadence: 'Daily',
          effort: 2,
          minAge: null,
          active: true,
          etag: '"c1"',
        });
      }
      throw new Error(`unexpected path ${path}`);
    };
    const client = clientWith(update);
    useApiClientMock.mockReturnValue(client);

    await renderSetup();

    // Step 1: create household.
    expect(screen.getByTestId('step-household')).toBeOnTheScreen();
    await type('input-household-name', 'The Smiths');
    await press('submit-household');
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
    expect(client.update).toHaveBeenCalledWith('/households', { name: 'The Smiths' }, { method: 'POST' });

    // Step 2: add a room, then continue.
    await type('input-room-name', 'Kitchen');
    await press('add-room');
    await waitFor(() => expect(screen.getByTestId('room-item-room-1')).toBeOnTheScreen());
    await press('continue-rooms');
    await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());

    // Step 3: add a person with the child flag and a claim colour.
    await type('input-person-name', 'Alex');
    await setSwitch('input-person-child', true);
    await press('claim-color-#7FB2E5');
    await press('add-person');
    await waitFor(() => expect(screen.getByTestId('person-item-p-1')).toBeOnTheScreen());
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/people',
      { displayName: 'Alex', role: 'Participant', isChild: true, claimColor: '#7FB2E5' },
      { method: 'POST' },
    );
    expect(screen.getByTestId('person-item-p-1')).toHaveTextContent('Alex (child)');
    await press('continue-people');
    await waitFor(() => expect(screen.getByTestId('step-chores')).toBeOnTheScreen());

    // Step 4: map a chore to the room.
    await type('input-chore-title', 'Take out the trash');
    await press('chore-room-room-1');
    await press('cadence-Daily');
    await type('input-chore-effort', '2');
    await press('add-chore');
    await waitFor(() => expect(screen.getByTestId('chore-item-c-1')).toBeOnTheScreen());
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/chores',
      { title: 'Take out the trash', roomId: 'room-1', cadence: 'Daily', effort: 2, minAge: null },
      { method: 'POST' },
    );

    // Completion publishes the new household to context.
    expect(screen.getByTestId('context-household')).toHaveTextContent('hh:none');
    await press('finish-setup');
    await waitFor(() => expect(screen.getByTestId('setup-done')).toBeOnTheScreen());
    expect(screen.getByTestId('context-household')).toHaveTextContent('hh:hh-1');
    expect(screen.getByTestId('setup-done')).toHaveTextContent(
      'Your household is ready: 1 rooms, 1 people, and 1 chores are set up.',
    );
  });

  it('surfaces a problem-details error on the household step and does not advance', async () => {
    const update: UpdateFn = async () => ({
      ok: false,
      error: {
        kind: 'problem',
        status: 400,
        title: 'Validation failed',
        detail: 'Name must not be empty.',
        problem: { title: 'Validation failed', detail: 'Name must not be empty.', status: 400 },
      },
    });
    useApiClientMock.mockReturnValue(clientWith(update));

    await renderSetup();

    await type('input-household-name', 'x');
    await press('submit-household');

    await waitFor(() =>
      expect(screen.getByTestId('setup-error')).toHaveTextContent('Name must not be empty.'),
    );
    // Did not advance.
    expect(screen.getByTestId('step-household')).toBeOnTheScreen();
    expect(screen.queryByTestId('step-rooms')).toBeNull();
  });

  it('validates the household name before calling the API', async () => {
    const client = clientWith(async () => ok({}));
    useApiClientMock.mockReturnValue(client);

    await renderSetup();
    await press('submit-household');

    await waitFor(() =>
      expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a name for your household.'),
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('surfaces an unknown-room problem when mapping a chore and stays on the step', async () => {
    const update: UpdateFn = async (path) => {
      if (path === '/households') {
        return ok({
          householdId: 'hh-9',
          name: 'H',
          organizerObjectId: 'o',
          createdUtc: 'x',
          etag: '"h"',
        });
      }
      if (path.endsWith('/rooms')) {
        return ok({ roomId: 'room-9', name: 'Den', sortOrder: 0, etag: '"r"' });
      }
      if (path.endsWith('/chores')) {
        return {
          ok: false,
          error: {
            kind: 'problem',
            status: 400,
            title: 'Bad Request',
            detail: "No room with id 'room-9' exists in household 'hh-9'.",
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    };
    useApiClientMock.mockReturnValue(clientWith(update));

    await renderSetup();
    await type('input-household-name', 'H');
    await press('submit-household');
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
    await type('input-room-name', 'Den');
    await press('add-room');
    await waitFor(() => expect(screen.getByTestId('room-item-room-9')).toBeOnTheScreen());
    await press('continue-rooms');
    await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());
    await press('continue-people');
    await waitFor(() => expect(screen.getByTestId('step-chores')).toBeOnTheScreen());

    await type('input-chore-title', 'Vacuum');
    await press('chore-room-room-9');
    await press('add-chore');

    await waitFor(() =>
      expect(screen.getByTestId('setup-error')).toHaveTextContent(
        "No room with id 'room-9' exists in household 'hh-9'.",
      ),
    );
    expect(screen.getByTestId('step-chores')).toBeOnTheScreen();
    expect(screen.queryByTestId('setup-done')).toBeNull();
  });

  it('enforces the per-step validation guards', async () => {
    const client = clientWith(async (path) => {
      if (path === '/households') {
        return ok({
          householdId: 'hh-2',
          name: 'H',
          organizerObjectId: 'o',
          createdUtc: 'x',
          etag: '"h"',
        });
      }
      if (path.endsWith('/rooms')) {
        return ok({ roomId: 'room-2', name: 'Bath', sortOrder: 0, etag: '"r"' });
      }
      throw new Error(`unexpected path ${path}`);
    });
    useApiClientMock.mockReturnValue(client);

    await renderSetup();
    await type('input-household-name', 'H');
    await press('submit-household');
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());

    // Empty room name.
    await press('add-room');
    expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a room name.');

    // Continue with no rooms yet.
    await press('continue-rooms');
    expect(screen.getByTestId('setup-error')).toHaveTextContent(
      'Add at least one room before continuing.',
    );

    // Add a room, then advance.
    await type('input-room-name', 'Bath');
    await press('add-room');
    await waitFor(() => expect(screen.getByTestId('room-item-room-2')).toBeOnTheScreen());
    await press('continue-rooms');
    await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());

    // Empty person name.
    await press('add-person');
    expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a name.');
    await press('continue-people');
    await waitFor(() => expect(screen.getByTestId('step-chores')).toBeOnTheScreen());

    // Chore: empty title.
    await press('add-chore');
    expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a chore title.');

    // Chore: no room picked.
    await type('input-chore-title', 'Sweep');
    await press('add-chore');
    expect(screen.getByTestId('setup-error')).toHaveTextContent('Pick a room for this chore.');

    // Chore: invalid effort.
    await press('chore-room-room-2');
    await type('input-chore-effort', '0');
    await press('add-chore');
    expect(screen.getByTestId('setup-error')).toHaveTextContent(
      'Effort must be a positive whole number.',
    );
  });

  it('surfaces an error when adding a room fails and does not append it', async () => {
    const update: UpdateFn = async (path) => {
      if (path === '/households') {
        return ok({
          householdId: 'hh-5',
          name: 'H',
          organizerObjectId: 'o',
          createdUtc: 'x',
          etag: '"h"',
        });
      }
      return {
        ok: false,
        error: { kind: 'problem', status: 400, title: 'Bad Request', detail: 'Room name is required.' },
      };
    };
    useApiClientMock.mockReturnValue(clientWith(update));

    await renderSetup();
    await type('input-household-name', 'H');
    await press('submit-household');
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());

    await type('input-room-name', 'Kitchen');
    await press('add-room');

    expect(screen.getByTestId('setup-error')).toHaveTextContent('Room name is required.');
    expect(screen.queryByTestId('room-item-room-5')).toBeNull();
  });

  it('surfaces an error when adding a person fails and does not append them', async () => {
    const update: UpdateFn = async (path) => {
      if (path === '/households') {
        return ok({
          householdId: 'hh-6',
          name: 'H',
          organizerObjectId: 'o',
          createdUtc: 'x',
          etag: '"h"',
        });
      }
      if (path.endsWith('/rooms')) {
        return ok({ roomId: 'room-6', name: 'Kitchen', sortOrder: 0, etag: '"r"' });
      }
      return {
        ok: false,
        error: { kind: 'http', status: 500, title: 'Server Error' },
      };
    };
    useApiClientMock.mockReturnValue(clientWith(update));

    await renderSetup();
    await type('input-household-name', 'H');
    await press('submit-household');
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
    await type('input-room-name', 'Kitchen');
    await press('add-room');
    await waitFor(() => expect(screen.getByTestId('room-item-room-6')).toBeOnTheScreen());
    await press('continue-rooms');
    await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());

    await type('input-person-name', 'Sam');
    await press('add-person');

    expect(screen.getByTestId('setup-error')).toHaveTextContent('Server Error');
    expect(screen.queryByTestId('person-item')).toBeNull();
  });

  it('disables the submit button while a request is in flight', async () => {
    let resolve: (result: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((r) => {
      resolve = r;
    });
    useApiClientMock.mockReturnValue(clientWith(() => pending));

    await renderSetup();
    await type('input-household-name', 'H');
    await press('submit-household');

    expect(screen.getByTestId('submit-household').props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      resolve(
        ok({ householdId: 'hh-3', name: 'H', organizerObjectId: 'o', createdUtc: 'x', etag: '"h"' }),
      );
      await pending;
    });
    await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
  });
});
