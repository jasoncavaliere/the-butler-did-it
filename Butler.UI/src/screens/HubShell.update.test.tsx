/**
 * Tablets pick up new builds (#108): the hub watches the service worker
 * registration for a waiting build, hands over to it only while the hub is idle
 * (no active participant, no unsynced writes), reloads exactly once when the new
 * worker takes control, and then says which build it is now running.
 *
 * Driven through the real HubShell with a fake `navigator.serviceWorker`,
 * `location.reload` and `sessionStorage`; the hub glance stays mocked, since its
 * reporter would put a write in the queue on every mount.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import type { ParticipantSessionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { UPDATE_NOTICE_MS } from '../components/UpdateNotice';
import { resetSessionFallbackStorage } from '../offline/storage';
import { currentWeekIso } from '../offline/weekIso';
import { OFFLINE_RETRY_MS, assignmentDedupeKey, readWriteQueue, saveWriteQueue } from '../offline/writeQueue';
import {
  FakeContainer,
  FakeRegistration,
  FakeWorker,
  memoryStorage,
  restoreNavigator,
  setNavigator,
} from '../pwa/fakeServiceWorker.testing';
import {
  SKIP_WAITING_MESSAGE,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_NOTICE_KEY,
  resetServiceWorkerUpdateForTests,
} from '../pwa/serviceWorkerUpdate';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx. Here its write
// would keep the queue from ever being empty, so the hub would never be idle.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });
const unreachable: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

const roster = [{ personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false }];

/**
 * A client that answers every hub read calmly and claims Alex. While
 * `api.writesDown` is set, the chore completion write fails as unreachable, so
 * a queued write stays pending.
 */
function hubClient(api: { writesDown: boolean } = { writesDown: false }): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === DATASET_PATH) {
        return ok({ datasetId: 'ds-1' });
      }
      if (path.includes('/chores')) {
        return ok([]);
      }
      // The board's lazy week read (#110): an empty set for the week it asked for.
      const week = /\/assignments\/(\d{4}-W\d{2})$/.exec(path)?.[1];
      if (week !== undefined) {
        return ok({ weekIso: week, currentWeekIso: week, assignments: [], unassigned: [] });
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
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.endsWith('/complete')) {
        return api.writesDown ? unreachable : ok(null);
      }
      if (path.endsWith('/claim')) {
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
      return ok(null);
    }) as unknown as ApiClient['update'],
  };
}

function renderHub(idleTimeoutMs?: number) {
  return render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubShell idleTimeoutMs={idleTimeoutMs} />
    </HouseholdProvider>,
  );
}

/** Let the hub's loads, the container's `ready`, and any queue drain settle. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

let container: FakeContainer;
let reload: jest.Mock;
let session: ReturnType<typeof memoryStorage>;
const savedBuildSha = process.env.EXPO_PUBLIC_BUILD_SHA;

beforeEach(() => {
  jest.useFakeTimers();
  resetServiceWorkerUpdateForTests();
  resetSessionFallbackStorage();
  const local = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true, writable: true });
  session = memoryStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true, writable: true });
  reload = jest.fn();
  Object.defineProperty(globalThis, 'location', { value: { reload }, configurable: true, writable: true });
  container = new FakeContainer();
  setNavigator({ serviceWorker: container });
});

afterEach(() => {
  jest.useRealTimers();
  useApiClientMock.mockReset();
  restoreNavigator();
  restoreGlobal('location', originalLocation);
  restoreGlobal('sessionStorage', originalSessionStorage);
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  resetSessionFallbackStorage();
  if (savedBuildSha === undefined) {
    delete process.env.EXPO_PUBLIC_BUILD_SHA;
  } else {
    process.env.EXPO_PUBLIC_BUILD_SHA = savedBuildSha;
  }
});

/** A new build installs while the current one controls the page. */
async function newBuildInstalls(): Promise<FakeWorker> {
  const worker = container.registration.findUpdate() as FakeWorker;
  await act(async () => worker.moveTo('installed'));
  return worker;
}

describe('HubShell picks up new builds (#108)', () => {
  it('update found while idle: posts SKIP_WAITING and reloads once on controllerchange (AC2, AC3, AC7)', async () => {
    useApiClientMock.mockReturnValue(hubClient());
    await renderHub();
    await settle();
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

    const worker = await newBuildInstalls();

    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    expect(reload).not.toHaveBeenCalled();
    container.dispatch('controllerchange');
    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.entries.get(UPDATE_NOTICE_KEY)).toBe('1');
  });

  it('applies a build that was already waiting when the hub mounted', async () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker('installed');
    registration.waiting = worker;
    container = new FakeContainer(registration);
    setNavigator({ serviceWorker: container });
    useApiClientMock.mockReturnValue(hubClient());

    await renderHub();
    await settle();

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('defers an update while a participant is active, then applies it after the idle timeout (AC4, AC7)', async () => {
    useApiClientMock.mockReturnValue(hubClient());
    const idleTimeoutMs = 1_000;
    await renderHub(idleTimeoutMs);
    await settle();
    await waitFor(() => expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByTestId('name-tile-p1'));
    });
    await settle();
    expect(screen.getByText("Alex's day")).toBeOnTheScreen();

    const worker = await newBuildInstalls();
    expect(worker.postMessage).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(idleTimeoutMs + 1);
    });

    expect(screen.queryByText("Alex's day")).toBeNull();
    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it('defers an update while a write is pending, then applies it once the queue drains (AC4)', async () => {
    const week = currentWeekIso();
    saveWriteQueue('hh-1', [
      {
        kind: 'chore-complete',
        dedupeKey: assignmentDedupeKey(week, 'c1'),
        method: 'POST',
        path: `/households/hh-1/assignments/${week}/c1/complete`,
        body: { personId: 'p1' },
        enqueuedAtMs: 1,
        attempts: 0,
        status: 'pending',
      },
    ]);
    const api = { writesDown: true };
    useApiClientMock.mockReturnValue(hubClient(api));

    await renderHub();
    await settle();
    expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/);

    const worker = await newBuildInstalls();
    expect(worker.postMessage).not.toHaveBeenCalled();

    api.writesDown = false;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    });
    await settle();

    expect(readWriteQueue('hh-1')).toEqual([]);
    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it('no update: the hub watches (listener attached, update() polled) but never posts or reloads (AC5, AC7)', async () => {
    useApiClientMock.mockReturnValue(hubClient());
    await renderHub();
    await settle();

    expect(container.registration.listenerCount('updatefound')).toBe(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    expect(container.registration.update).toHaveBeenCalledTimes(1);

    container.dispatch('controllerchange');
    expect(reload).not.toHaveBeenCalled();
    expect(session.setItem).not.toHaveBeenCalled();
  });

  it('shows the new build after an update reload and hides it after UPDATE_NOTICE_MS (AC6)', async () => {
    process.env.EXPO_PUBLIC_BUILD_SHA = 'f00dbab';
    session.entries.set(UPDATE_NOTICE_KEY, '1');
    useApiClientMock.mockReturnValue(hubClient());

    await renderHub();
    await settle();

    expect(screen.getByTestId('hub-update-notice')).toHaveTextContent('Updated to build f00dbab');
    // The marker is one-shot: a later manual reload shows nothing.
    expect(session.entries.has(UPDATE_NOTICE_KEY)).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(UPDATE_NOTICE_MS);
    });

    expect(screen.queryByTestId('hub-update-notice')).toBeNull();
  });

  it('shows no notice on a normal load (AC6)', async () => {
    useApiClientMock.mockReturnValue(hubClient());

    await renderHub();
    await settle();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(UPDATE_NOTICE_MS);
    });

    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
    expect(screen.queryByTestId('hub-update-notice')).toBeNull();
  });
});
