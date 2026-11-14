import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HouseholdSetup } from './HouseholdSetup';
import type { ApiClient, ApiResult, UpdateOptions } from '../api/client';
import { FRIENDLY_ERROR } from '../api/errors';
import { useApiClient } from '../api/useApiClient';
import { templatesForRoom } from '../setup/starterTemplates';
import { HouseholdProvider, useHousehold } from '../state/HouseholdContext';
import { claimColors } from '../theme/theme';

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

/**
 * Drive the flow to the chores step with one room per name. The rooms mock
 * answers `room-<lowercased name>`; the chores mock echoes the body with a
 * generated choreId, unless `chores` overrides it.
 */
async function reachChoresStep(
  roomNames: string[],
  chores?: (body: Record<string, unknown>, call: number) => ApiResult<unknown>,
): Promise<ApiClient> {
  let choreCalls = 0;
  const client = clientWith(async (path, body) => {
    const fields = body as Record<string, unknown>;
    if (path === '/households') {
      return ok({
        householdId: 'hh-1',
        name: 'H',
        organizerObjectId: 'o',
        createdUtc: 'x',
        etag: '"h"',
      });
    }
    if (path.endsWith('/rooms')) {
      const name = String(fields.name);
      return ok({
        roomId: `room-${name.toLowerCase()}`,
        name,
        sortOrder: fields.sortOrder,
        eTag: '"r"',
      });
    }
    if (path.endsWith('/chores')) {
      choreCalls += 1;
      if (chores) {
        return chores(fields, choreCalls);
      }
      return ok({
        choreId: `c-${choreCalls}`,
        ...fields,
        active: true,
        eTag: '"c"',
      });
    }
    throw new Error(`unexpected path ${path}`);
  });
  useApiClientMock.mockReturnValue(client);

  await renderSetup();
  await type('input-household-name', 'H');
  await press('submit-household');
  await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
  for (const name of roomNames) {
    await type('input-room-name', name);
    await press('add-room');
    await waitFor(() =>
      expect(screen.getByTestId(`room-item-room-${name.toLowerCase()}`)).toBeOnTheScreen(),
    );
  }
  await press('continue-rooms');
  await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());
  await press('continue-people');
  await waitFor(() => expect(screen.getByTestId('step-chores')).toBeOnTheScreen());
  return client;
}

/** The POSTs the client made to the chores endpoint, in order. */
function choreCalls(client: ApiClient): unknown[][] {
  return (client.update as jest.Mock).mock.calls.filter(([path]) =>
    String(path).endsWith('/chores'),
  );
}

function isSelected(testID: string): boolean | undefined {
  return screen.getByTestId(testID).props.accessibilityState?.selected;
}

const payload = (
  roomId: string,
  t: { title: string; cadence: string; effort: number; minAge: number | null },
) => ({
  title: t.title,
  roomId,
  cadence: t.cadence,
  effort: t.effort,
  minAge: t.minAge,
});

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
        return ok({ roomId: 'room-1', name: 'Kitchen', sortOrder: 0, eTag: '"r1"' });
      }
      if (path.endsWith('/people')) {
        return ok({
          personId: 'p-1',
          displayName: 'Alex',
          role: 'Participant',
          isChild: true,
          claimColor: '#77A8FF',
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
          eTag: '"c1"',
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
    await press('claim-color-blue');
    await press('add-person');
    await waitFor(() => expect(screen.getByTestId('person-item-p-1')).toBeOnTheScreen());
    expect(client.update).toHaveBeenCalledWith(
      '/households/hh-1/people',
      { displayName: 'Alex', role: 'Participant', isChild: true, claimColor: '#77A8FF' },
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

  describe('claim colour picker (#120)', () => {
    /** Drive the flow to the people step; the people mock echoes the body back. */
    async function reachPeopleStep(): Promise<ApiClient> {
      const client = clientWith(async (path, body) => {
        if (path === '/households') {
          return ok({
            householdId: 'hh-c',
            name: 'H',
            organizerObjectId: 'o',
            createdUtc: 'x',
            etag: '"h"',
          });
        }
        if (path.endsWith('/rooms')) {
          return ok({ roomId: 'room-c', name: 'Kitchen', sortOrder: 0, eTag: '"r"' });
        }
        if (path.endsWith('/people')) {
          return ok({ personId: 'p-c', ...(body as Record<string, unknown>), etag: '"p"' });
        }
        throw new Error(`unexpected path ${path}`);
      });
      useApiClientMock.mockReturnValue(client);

      await renderSetup();
      await type('input-household-name', 'H');
      await press('submit-household');
      await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
      await type('input-room-name', 'Kitchen');
      await press('add-room');
      await waitFor(() => expect(screen.getByTestId('room-item-room-c')).toBeOnTheScreen());
      await press('continue-rooms');
      await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());
      return client;
    }

    it('offers the six token claim colours, not the old presets (#120 AC2)', async () => {
      await reachPeopleStep();

      const swatches = screen.getAllByTestId(/^claim-color-/);
      expect(swatches.map((swatch) => swatch.props.testID)).toEqual(
        claimColors.map((color) => `claim-color-${color.name}`),
      );
      expect(swatches.map((swatch) => swatch.props.testID)).toEqual([
        'claim-color-berry',
        'claim-color-marigold',
        'claim-color-grass',
        'claim-color-blue',
        'claim-color-violet',
        'claim-color-clay',
      ]);
      for (const color of claimColors) {
        const swatch = screen.getByTestId(`claim-color-${color.name}`);
        expect(swatch).toHaveStyle({ backgroundColor: color.dark });
        expect(swatch.props.accessibilityLabel).toBe(color.name);
      }
      for (const old of ['#D9B25A', '#7FB2E5', '#E58B7F', '#8FD98F', '#C79FE5']) {
        expect(screen.queryByTestId(`claim-color-${old}`)).toBeNull();
      }
    });

    it('saves the picked claim colour as its token dark hex (#120 AC3)', async () => {
      const client = await reachPeopleStep();

      await type('input-person-name', 'Sam');
      await press('claim-color-grass');
      expect(isSelected('claim-color-grass')).toBe(true);
      expect(isSelected('claim-color-berry')).toBe(false);
      await press('claim-color-violet');
      expect(isSelected('claim-color-violet')).toBe(true);
      expect(isSelected('claim-color-grass')).toBe(false);
      await press('add-person');
      await waitFor(() => expect(screen.getByTestId('person-item-p-c')).toBeOnTheScreen());

      expect(client.update).toHaveBeenCalledWith(
        '/households/hh-c/people',
        { displayName: 'Sam', role: 'Participant', isChild: false, claimColor: '#B98CEE' },
        { method: 'POST' },
      );
    });
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

    await waitFor(() => expect(screen.getByText(FRIENDLY_ERROR.rejected)).toBeOnTheScreen());
    expect(screen.getByTestId('setup-error')).not.toHaveTextContent(/Name must not be empty/);
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
        return ok({ roomId: 'room-9', name: 'Den', sortOrder: 0, eTag: '"r"' });
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

    await waitFor(() => expect(screen.getByText(FRIENDLY_ERROR.rejected)).toBeOnTheScreen());
    expect(screen.getByTestId('setup-error')).not.toHaveTextContent(/No room with id/);
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
        return ok({ roomId: 'room-2', name: 'Bath', sortOrder: 0, eTag: '"r"' });
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

    expect(screen.getByText(FRIENDLY_ERROR.rejected)).toBeOnTheScreen();
    expect(screen.getByTestId('setup-error')).not.toHaveTextContent(/Room name is required/);
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
        return ok({ roomId: 'room-6', name: 'Kitchen', sortOrder: 0, eTag: '"r"' });
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

    expect(screen.getByText(FRIENDLY_ERROR.failed)).toBeOnTheScreen();
    expect(screen.getByTestId('setup-error')).not.toHaveTextContent(/Server Error/);
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

  describe('starter templates', () => {
    const kitchen = templatesForRoom('Kitchen');
    const bathroom = templatesForRoom('Bathroom');

    it('shows starter templates under a room matched by an alias', async () => {
      await reachChoresStep(['Bath']);

      expect(screen.getByTestId('template-room-room-bath')).toHaveTextContent(/Bath/);
      for (const template of bathroom) {
        expect(screen.getByTestId(`template-room-bath-${template.id}`)).toBeOnTheScreen();
        expect(isSelected(`template-room-bath-${template.id}`)).toBe(false);
      }
      expect(screen.getByTestId('add-templates')).toBeOnTheScreen();
    });

    it('labels a template with its cadence, effort and minimum age', async () => {
      await reachChoresStep(['Kitchen']);

      const open = kitchen.find((t) => t.minAge === null)!;
      const aged = kitchen.find((t) => t.minAge !== null)!;
      expect(screen.getByTestId(`template-room-kitchen-${open.id}`)).toHaveTextContent(
        `${open.title} (${open.cadence}, effort ${open.effort})`,
      );
      expect(screen.getByTestId(`template-room-kitchen-${aged.id}`)).toHaveTextContent(
        `${aged.title} (${aged.cadence}, effort ${aged.effort}, age ${aged.minAge}+)`,
      );
    });

    it('shows no starter templates for an unmatched room', async () => {
      await reachChoresStep(['Den']);

      expect(screen.queryByTestId('template-room-room-den')).toBeNull();
      expect(screen.queryByTestId('add-templates')).toBeNull();
      expect(screen.queryByText('Starter chores')).toBeNull();
      // The custom-chore form is still there.
      expect(screen.getByTestId('input-chore-title')).toBeOnTheScreen();
      expect(screen.getByTestId('chore-room-room-den')).toBeOnTheScreen();
    });

    it('only groups the matched rooms when some rooms are unmatched', async () => {
      await reachChoresStep(['Den', 'Kitchen']);

      expect(screen.queryByTestId('template-room-room-den')).toBeNull();
      expect(screen.getByTestId('template-room-room-kitchen')).toBeOnTheScreen();
    });

    it('creates each selected template with the matched room id and exact payload', async () => {
      const client = await reachChoresStep(['Kitchen', 'Bath']);

      // Select out of order: creation still follows rooms order, then catalog order.
      await press(`template-room-bath-${bathroom[1].id}`);
      await press(`template-room-kitchen-${kitchen[5].id}`);
      await press(`template-room-kitchen-${kitchen[0].id}`);
      expect(isSelected(`template-room-kitchen-${kitchen[0].id}`)).toBe(true);
      await press('add-templates');

      await waitFor(() => expect(screen.getByTestId('chore-item-c-3')).toBeOnTheScreen());
      expect(choreCalls(client)).toEqual([
        ['/households/hh-1/chores', payload('room-kitchen', kitchen[0]), { method: 'POST' }],
        ['/households/hh-1/chores', payload('room-kitchen', kitchen[5]), { method: 'POST' }],
        ['/households/hh-1/chores', payload('room-bath', bathroom[1]), { method: 'POST' }],
      ]);
      expect(screen.getByTestId('chore-item-c-1')).toHaveTextContent(kitchen[0].title);
      expect(screen.getByTestId('chore-item-c-2')).toHaveTextContent(kitchen[5].title);
      expect(screen.getByTestId('chore-item-c-3')).toHaveTextContent(bathroom[1].title);
      // Added templates leave the list so they cannot be created twice; the rest stay.
      expect(screen.queryByTestId(`template-room-kitchen-${kitchen[0].id}`)).toBeNull();
      expect(screen.queryByTestId(`template-room-bath-${bathroom[1].id}`)).toBeNull();
      expect(isSelected(`template-room-kitchen-${kitchen[1].id}`)).toBe(false);
      expect(screen.queryByTestId('setup-error')).toBeNull();

      // Pressing add again with nothing selected makes no further call.
      await press('add-templates');
      expect(screen.getByTestId('setup-error')).toHaveTextContent(
        'Pick at least one starter chore.',
      );
      expect(choreCalls(client)).toHaveLength(3);

      await press('finish-setup');
      await waitFor(() => expect(screen.getByTestId('setup-done')).toBeOnTheScreen());
      expect(screen.getByTestId('setup-done')).toHaveTextContent(
        'Your household is ready: 2 rooms, 0 people, and 3 chores are set up.',
      );
    });

    it('hides a room group once all of its templates are added', async () => {
      const client = await reachChoresStep(['Garage']);
      const garage = templatesForRoom('Garage');

      for (const template of garage) {
        await press(`template-room-garage-${template.id}`);
      }
      await press('add-templates');

      await waitFor(() => expect(screen.queryByTestId('template-room-room-garage')).toBeNull());
      expect(screen.queryByTestId('add-templates')).toBeNull();
      expect(choreCalls(client)).toHaveLength(garage.length);
    });

    it('does not create a template that was deselected before adding', async () => {
      const client = await reachChoresStep(['Kitchen']);
      const [a, b] = kitchen;

      await press(`template-room-kitchen-${a.id}`);
      await press(`template-room-kitchen-${b.id}`);
      expect(isSelected(`template-room-kitchen-${b.id}`)).toBe(true);
      await press(`template-room-kitchen-${b.id}`);
      expect(isSelected(`template-room-kitchen-${b.id}`)).toBe(false);
      await press('add-templates');

      await waitFor(() => expect(screen.getByTestId('chore-item-c-1')).toBeOnTheScreen());
      expect(choreCalls(client)).toEqual([
        ['/households/hh-1/chores', payload('room-kitchen', a), { method: 'POST' }],
      ]);
      expect(client.update).not.toHaveBeenCalledWith(
        '/households/hh-1/chores',
        payload('room-kitchen', b),
        { method: 'POST' },
      );
      expect(screen.getByTestId(`template-room-kitchen-${b.id}`)).toBeOnTheScreen();
    });

    it('asks for a selection when add is pressed with nothing selected', async () => {
      const client = await reachChoresStep(['Kitchen']);

      await press('add-templates');

      expect(screen.getByTestId('setup-error')).toHaveTextContent(
        'Pick at least one starter chore.',
      );
      expect(choreCalls(client)).toHaveLength(0);
    });

    it('stops on the first failed template create and keeps the rest selected', async () => {
      const client = await reachChoresStep(['Kitchen'], (body, call) =>
        call === 2
          ? {
              ok: false,
              error: {
                kind: 'problem',
                status: 400,
                title: 'Bad Request',
                detail: 'Effort must be positive.',
              },
            }
          : ok({ choreId: `c-${call}`, ...body, active: true, eTag: '"c"' }),
      );
      const [a, b, c] = kitchen;

      await press(`template-room-kitchen-${a.id}`);
      await press(`template-room-kitchen-${b.id}`);
      await press(`template-room-kitchen-${c.id}`);
      await press('add-templates');

      await waitFor(() => expect(screen.getByText(FRIENDLY_ERROR.rejected)).toBeOnTheScreen());
      expect(screen.getByTestId('setup-error')).not.toHaveTextContent(/Effort must be positive/);
      // The first succeeded, the second failed, the third was never tried.
      expect(choreCalls(client)).toEqual([
        ['/households/hh-1/chores', payload('room-kitchen', a), { method: 'POST' }],
        ['/households/hh-1/chores', payload('room-kitchen', b), { method: 'POST' }],
      ]);
      expect(screen.getByTestId('chore-item-c-1')).toHaveTextContent(a.title);
      expect(screen.queryByTestId(`template-room-kitchen-${a.id}`)).toBeNull();
      expect(isSelected(`template-room-kitchen-${b.id}`)).toBe(true);
      expect(isSelected(`template-room-kitchen-${c.id}`)).toBe(true);
      expect(screen.getByTestId('add-templates').props.accessibilityState?.disabled).toBe(false);

      // A retry re-attempts the failed and untried ones only.
      await press('add-templates');
      await waitFor(() => expect(screen.getByTestId('chore-item-c-4')).toBeOnTheScreen());
      expect(choreCalls(client).slice(2)).toEqual([
        ['/households/hh-1/chores', payload('room-kitchen', b), { method: 'POST' }],
        ['/households/hh-1/chores', payload('room-kitchen', c), { method: 'POST' }],
      ]);
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('still adds a custom chore alongside starter templates', async () => {
      const client = await reachChoresStep(['Kitchen']);

      await press(`template-room-kitchen-${kitchen[0].id}`);
      await press('add-templates');
      await waitFor(() => expect(screen.getByTestId('chore-item-c-1')).toBeOnTheScreen());

      await type('input-chore-title', 'Feed the cat');
      await press('chore-room-room-kitchen');
      await press('add-chore');
      await waitFor(() => expect(screen.getByTestId('chore-item-c-2')).toBeOnTheScreen());
      expect(client.update).toHaveBeenLastCalledWith(
        '/households/hh-1/chores',
        {
          title: 'Feed the cat',
          roomId: 'room-kitchen',
          cadence: 'Weekly',
          effort: 1,
          minAge: null,
        },
        { method: 'POST' },
      );
    });
  });

  describe('request states', () => {
    const household = ok({
      householdId: 'hh-1',
      name: 'H',
      organizerObjectId: 'o',
      createdUtc: 'x',
      etag: '"h"',
    });
    const serverError: ApiResult<unknown> = {
      ok: false,
      error: { kind: 'http', status: 503, title: 'Service Unavailable' },
    };
    const unreachable: ApiResult<unknown> = {
      ok: false,
      error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
    };

    /**
     * A client that answers every setup endpoint, but fails the first `failures`
     * POSTs to the path ending in `failSuffix` with `failure`.
     */
    function flakyClient(failSuffix: string, failure: ApiResult<unknown>, failures = 1): ApiClient {
      let remaining = failures;
      let choreCount = 0;
      const client = clientWith(async (path, body) => {
        const fields = body as Record<string, unknown>;
        if (path.endsWith(failSuffix) && remaining > 0) {
          remaining -= 1;
          return failure;
        }
        if (path === '/households') {
          return household;
        }
        if (path.endsWith('/rooms')) {
          const name = String(fields.name);
          return ok({ roomId: `room-${name.toLowerCase()}`, name, sortOrder: 0, eTag: '"r"' });
        }
        if (path.endsWith('/people')) {
          return ok({ personId: 'p-1', displayName: fields.displayName, isChild: false, eTag: '"p"' });
        }
        choreCount += 1;
        return ok({ choreId: `c-${choreCount}`, ...fields, active: true, eTag: '"c"' });
      });
      useApiClientMock.mockReturnValue(client);
      return client;
    }

    async function toRooms() {
      await type('input-household-name', 'H');
      await press('submit-household');
      await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
    }

    async function toPeople() {
      await toRooms();
      await type('input-room-name', 'Kitchen');
      await press('add-room');
      await waitFor(() => expect(screen.getByTestId('room-item-room-kitchen')).toBeOnTheScreen());
      await press('continue-rooms');
      await waitFor(() => expect(screen.getByTestId('step-people')).toBeOnTheScreen());
    }

    async function toChores() {
      await toPeople();
      await press('continue-people');
      await waitFor(() => expect(screen.getByTestId('step-chores')).toBeOnTheScreen());
    }

    it('shows a loading state while a step request is in flight', async () => {
      let resolve: (result: ApiResult<unknown>) => void = () => {};
      const pending = new Promise<ApiResult<unknown>>((r) => {
        resolve = r;
      });
      useApiClientMock.mockReturnValue(clientWith(() => pending));

      await renderSetup();
      expect(screen.queryByTestId('setup-loading')).toBeNull();
      await type('input-household-name', 'H');
      await press('submit-household');

      expect(screen.getByTestId('setup-loading')).toBeOnTheScreen();
      expect(screen.getByText('Setting up your household...')).toBeOnTheScreen();

      await act(async () => {
        resolve(household);
        await pending;
      });
      await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
      expect(screen.queryByTestId('setup-loading')).toBeNull();
    });

    it('shows the chores loading line while starter chores are added', async () => {
      let resolve: (result: ApiResult<unknown>) => void = () => {};
      const pending = new Promise<ApiResult<unknown>>((r) => {
        resolve = r;
      });
      const kitchen = templatesForRoom('Kitchen');
      await reachChoresStep(['Kitchen'], () => pending as unknown as ApiResult<unknown>);

      await press(`template-room-kitchen-${kitchen[0].id}`);
      await press('add-templates');

      expect(screen.getByTestId('setup-loading')).toBeOnTheScreen();
      expect(screen.getByText('Adding the chores...')).toBeOnTheScreen();

      await act(async () => {
        resolve(ok({ choreId: 'c-1', title: kitchen[0].title, active: true, eTag: '"c"' }));
        await pending;
      });
      await waitFor(() => expect(screen.getByTestId('chore-item-c-1')).toBeOnTheScreen());
      expect(screen.queryByTestId('setup-loading')).toBeNull();
    });

    it('shows friendly copy and a retry, never the raw API text, when a step request fails', async () => {
      flakyClient('/households', {
        ok: false,
        error: {
          kind: 'problem',
          status: 409,
          title: 'Conflict',
          detail: 'Household table write raced.',
        },
      });

      await renderSetup();
      await type('input-household-name', 'H');
      await press('submit-household');

      await waitFor(() => expect(screen.getByTestId('setup-error')).toBeOnTheScreen());
      expect(screen.getByText(FRIENDLY_ERROR.rejected)).toBeOnTheScreen();
      expect(screen.getByTestId('setup-retry')).toHaveTextContent('Try again');
      expect(screen.getByTestId('household-setup')).not.toHaveTextContent(/raced|Conflict/);
      expect(screen.queryByTestId('setup-loading')).toBeNull();
    });

    it('shows the network line when the API is unreachable', async () => {
      flakyClient('/households', unreachable);

      await renderSetup();
      await type('input-household-name', 'H');
      await press('submit-household');

      await waitFor(() => expect(screen.getByText(FRIENDLY_ERROR.network)).toBeOnTheScreen());
      expect(screen.getByTestId('setup-retry')).toBeOnTheScreen();
    });

    it('Try again re-sends the failed household step and advances on success', async () => {
      const client = flakyClient('/households', serverError);

      await renderSetup();
      await type('input-household-name', 'The Smiths');
      await press('submit-household');
      await waitFor(() => expect(screen.getByText(FRIENDLY_ERROR.failed)).toBeOnTheScreen());

      await press('setup-retry');

      await waitFor(() => expect(screen.getByTestId('step-rooms')).toBeOnTheScreen());
      expect(client.update).toHaveBeenCalledTimes(2);
      expect(client.update).toHaveBeenLastCalledWith(
        '/households',
        { name: 'The Smiths' },
        { method: 'POST' },
      );
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('Try again re-sends the failed room and adds it on success', async () => {
      const client = flakyClient('/rooms', serverError);

      await renderSetup();
      await toRooms();
      await type('input-room-name', 'Kitchen');
      await press('add-room');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());

      await press('setup-retry');

      await waitFor(() => expect(screen.getByTestId('room-item-room-kitchen')).toBeOnTheScreen());
      expect(client.update).toHaveBeenLastCalledWith(
        '/households/hh-1/rooms',
        { name: 'Kitchen', sortOrder: 0 },
        { method: 'POST' },
      );
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('Try again re-sends the failed person and adds them on success', async () => {
      const client = flakyClient('/people', serverError);

      await renderSetup();
      await toPeople();
      await type('input-person-name', 'Sam');
      await press('add-person');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());

      await press('setup-retry');

      await waitFor(() => expect(screen.getByTestId('person-item-p-1')).toBeOnTheScreen());
      expect(client.update).toHaveBeenLastCalledWith(
        '/households/hh-1/people',
        { displayName: 'Sam', role: 'Participant', isChild: false, claimColor: null },
        { method: 'POST' },
      );
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('Try again re-sends the failed custom chore and adds it on success', async () => {
      const client = flakyClient('/chores', serverError);

      await renderSetup();
      await toChores();
      await type('input-chore-title', 'Vacuum');
      await press('chore-room-room-kitchen');
      await press('add-chore');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());

      await press('setup-retry');

      await waitFor(() => expect(screen.getByTestId('chore-item-c-1')).toBeOnTheScreen());
      expect(client.update).toHaveBeenLastCalledWith(
        '/households/hh-1/chores',
        { title: 'Vacuum', roomId: 'room-kitchen', cadence: 'Weekly', effort: 1, minAge: null },
        { method: 'POST' },
      );
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('Try again after a failed starter-chore add re-sends only the remaining selection', async () => {
      const kitchen = templatesForRoom('Kitchen');
      const [a, b] = kitchen;
      const client = await reachChoresStep(['Kitchen'], (body, call) =>
        call === 2 ? serverError : ok({ choreId: `c-${call}`, ...body, active: true, eTag: '"c"' }),
      );

      await press(`template-room-kitchen-${a.id}`);
      await press(`template-room-kitchen-${b.id}`);
      await press('add-templates');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());
      expect(screen.getByText(FRIENDLY_ERROR.failed)).toBeOnTheScreen();

      // Change the custom-chore form in between: the retry must not send it.
      await type('input-chore-title', 'Not this one');
      await press('setup-retry');

      await waitFor(() => expect(screen.getByTestId('chore-item-c-3')).toBeOnTheScreen());
      expect(choreCalls(client).slice(2)).toEqual([
        ['/households/hh-1/chores', payload('room-kitchen', b), { method: 'POST' }],
      ]);
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });

    it('client-side validation messages show no retry', async () => {
      flakyClient('/households', serverError);

      await renderSetup();
      await press('submit-household');

      expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a name for your household.');
      expect(screen.queryByTestId('setup-retry')).toBeNull();

      // A request failure brings the retry; the next validation message drops it.
      await type('input-household-name', 'H');
      await press('submit-household');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());
      await type('input-household-name', '   ');
      await press('submit-household');
      expect(screen.getByTestId('setup-error')).toHaveTextContent('Enter a name for your household.');
      expect(screen.queryByTestId('setup-retry')).toBeNull();
    });

    it('clears a lingering request error when setup finishes', async () => {
      const kitchen = templatesForRoom('Kitchen');
      await reachChoresStep(['Kitchen'], () => serverError);

      await press(`template-room-kitchen-${kitchen[0].id}`);
      await press('add-templates');
      await waitFor(() => expect(screen.getByTestId('setup-retry')).toBeOnTheScreen());

      await press('finish-setup');

      expect(screen.getByTestId('setup-done')).toBeOnTheScreen();
      expect(screen.queryByTestId('setup-error')).toBeNull();
    });
  });
});
