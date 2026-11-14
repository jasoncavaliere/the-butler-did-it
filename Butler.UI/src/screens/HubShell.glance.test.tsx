import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import type { ParticipantSessionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { resetSessionFallbackStorage } from '../offline/storage';
import { readWriteQueue } from '../offline/writeQueue';
import { HouseholdProvider } from '../state/HouseholdContext';

/**
 * The hub glance (#122) through the real shell and the real hook: the hub posts
 * one `hub-glanced` on mount, queues it while the API is unreachable and replays
 * it on reconnect, and never posts a claim event of its own (the API records
 * claims server-side).
 */

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const EVENTS_PATH = '/households/hh-1/events';

const unreachable: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

const roster = [{ personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false }];

function ok(data: unknown, status = 200): ApiResult<unknown> {
  return { ok: true, status, data, etag: null };
}

function liveGet(path: string): ApiResult<unknown> {
  if (path === DATASET_PATH) {
    return ok({ datasetId: 'ds-1' });
  }
  if (path.includes('/chores')) {
    return ok([]);
  }
  if (path.includes('/carts/')) {
    return ok({
      weekIso: '2026-W29',
      status: 'Building',
      confirmedByPersonId: null,
      confirmedUtc: null,
      eTag: 'W/"cart-1"',
      items: [],
      estimatedTotal: 0,
      customItemCount: 0,
    });
  }
  return path.endsWith('/people') ? ok(roster) : ok({ householdId: 'hh-1', name: 'Home' });
}

function liveUpdate(path: string): ApiResult<unknown> {
  if (path.endsWith('/generate')) {
    return ok({ weekIso: '2026-W29', assignments: [], unassigned: [] });
  }
  if (path === EVENTS_PATH) {
    return ok(undefined, 204);
  }
  const session: ParticipantSessionResponse = {
    householdId: 'hh-1',
    personId: 'p1',
    displayName: 'Alex',
    claimColor: '#B0206F',
    isChild: false,
    token: 'tok-p1',
  };
  return ok(session);
}

/** A client whose API can be taken down and brought back mid-test. */
function switchableClient(api: { down: boolean }): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string) => (api.down ? unreachable : liveGet(path))) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string) =>
      api.down ? unreachable : liveUpdate(path),
    ) as unknown as ApiClient['update'],
  };
}

/** Every call the client made to the events route, as [path, body, options]. */
function eventPosts(client: ApiClient): unknown[][] {
  return (client.update as jest.Mock).mock.calls.filter(([path]: [string]) => path === EVENTS_PATH);
}

/** A stand-in for the browser's `online` event target, installed on globalThis. */
function installOnlineTarget() {
  const listeners = new Set<() => void>();
  const target = globalThis as unknown as Record<string, unknown>;
  target.addEventListener = (type: string, listener: () => void) => {
    if (type === 'online') {
      listeners.add(listener);
    }
  };
  target.removeEventListener = (_type: string, listener: () => void) => {
    listeners.delete(listener);
  };
  return {
    goOnline: () => {
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },
    uninstall: () => {
      delete target.addEventListener;
      delete target.removeEventListener;
    },
  };
}

function renderHub() {
  return render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubShell />
    </HouseholdProvider>,
  );
}

beforeEach(() => resetSessionFallbackStorage());

afterEach(() => {
  useApiClientMock.mockReset();
  resetSessionFallbackStorage();
});

describe('HubShell hub glance (#122)', () => {
  it('the hub posts one hub-glanced on mount', async () => {
    const client = switchableClient({ down: false });
    useApiClientMock.mockReturnValue(client);

    await renderHub();

    await waitFor(() => expect(eventPosts(client)).toHaveLength(1));
    expect(eventPosts(client)[0]).toEqual([EVENTS_PATH, { type: 'hub-glanced' }, { method: 'POST' }]);
    // Posted directly, not through the queue.
    expect(readWriteQueue('hh-1')).toEqual([]);
  });

  it('an offline hub queues the glance and replays it on reconnect', async () => {
    const online = installOnlineTarget();
    try {
      const api = { down: true };
      const client = switchableClient(api);
      useApiClientMock.mockReturnValue(client);

      await renderHub();

      await waitFor(() =>
        expect(readWriteQueue('hh-1')).toEqual([
          expect.objectContaining({ kind: 'hub-glance', path: EVENTS_PATH, status: 'pending' }),
        ]),
      );

      // The queued glance is rendered (so the queue is listening for reconnect).
      await waitFor(() =>
        expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/),
      );

      api.down = false;
      await act(async () => {
        online.goOnline();
      });

      await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
      // The direct attempt while down, then the replay once reconnected.
      expect(eventPosts(client).length).toBeGreaterThanOrEqual(2);
      expect(eventPosts(client).every(([, body]) => (body as { type: string }).type === 'hub-glanced')).toBe(
        true,
      );
    } finally {
      // Unmount while the fake target is still there to unsubscribe from.
      await act(async () => {
        cleanup();
      });
      online.uninstall();
    }
  });

  it('claiming a person posts no event of its own', async () => {
    const client = switchableClient({ down: false });
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());
    await act(async () => {
      fireEvent.press(screen.getByTestId('name-tile-p1'));
    });

    const updates = (client.update as jest.Mock).mock.calls as [string, unknown][];
    await waitFor(() => expect(updates.some(([path]) => path.endsWith('/people/p1/claim'))).toBe(true));
    // Every /events call is the glance; none is participant-claimed.
    expect(eventPosts(client)).toHaveLength(1);
    expect(eventPosts(client)[0][1]).toEqual({ type: 'hub-glanced' });
    expect(JSON.stringify(updates)).not.toContain('participant-claimed');
  });
});
