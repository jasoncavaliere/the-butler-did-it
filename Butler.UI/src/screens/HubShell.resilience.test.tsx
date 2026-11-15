/**
 * The hub stays awake and recovers by itself (#109): it asks for a screen wake
 * lock when it loads, retries a failed shell read on a capped backoff without
 * showing the loading state, and - as a last resort - reloads the page after
 * five continuous minutes in error while the browser is online and no write is
 * waiting to sync.
 *
 * Driven through the real HubShell with a fake `navigator` (its `wakeLock` and
 * `onLine`), `location.reload` and `localStorage`. The hub glance stays mocked,
 * since its reporter puts a write in the queue on every mount, and a pending
 * write keeps the watchdog off by design (AC7).
 */
import { act, render, screen } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import { useApiClient } from '../api/useApiClient';
import { writeGlance } from '../offline/glanceCache';
import { resetSessionFallbackStorage } from '../offline/storage';
import { currentWeekIso } from '../offline/weekIso';
import { assignmentDedupeKey, saveWriteQueue } from '../offline/writeQueue';
import { memoryStorage, restoreNavigator, setNavigator } from '../pwa/fakeServiceWorker.testing';
import { WATCHDOG_RELOAD_AFTER_MS } from '../pwa/useHubWatchdog';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx. Here its write
// would keep the queue from ever being empty, so the watchdog would never arm.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const HOUSEHOLD_PATH = '/households/hh-1';
const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });
const unreachable: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};
const serverError: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'http', status: 500, title: 'Server error' },
};

const roster = [{ personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false }];

/**
 * A client that answers every hub read calmly, except the household read while
 * `api.household` holds a failure. Writes fail as unreachable while
 * `api.writesDown` is set, so a queued write stays pending.
 */
function hubClient(api: { household: ApiResult<unknown> | null; writesDown?: boolean }): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === DATASET_PATH) {
        return ok({ datasetId: 'ds-1' });
      }
      if (path === HOUSEHOLD_PATH) {
        return api.household ?? ok({ householdId: 'hh-1', name: 'Home' });
      }
      if (path.endsWith('/people')) {
        return ok(roster);
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
      return ok({
        windowStartWeekIso: '2026-W26',
        windowEndWeekIso: '2026-W29',
        windowWeeks: 4,
        totalEffort: 0,
        topContributorPersonId: null,
        shares: [],
      });
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (): Promise<ApiResult<unknown>> =>
      api.writesDown ? unreachable : ok(null),
    ) as unknown as ApiClient['update'],
  };
}

/** How many times the shell asked for the household. */
function householdReads(client: ApiClient): number {
  return (client.get as jest.Mock).mock.calls.filter(([path]) => path === HOUSEHOLD_PATH).length;
}

function renderHub() {
  return render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubShell />
    </HouseholdProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Advance in steps, so each automatic retry re-renders and arms the next. */
async function advanceInSteps(totalMs: number, stepMs = 1_000) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await advance(Math.min(stepMs, totalMs - elapsed));
  }
}

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

let reload: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  resetSessionFallbackStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
  reload = jest.fn();
  Object.defineProperty(globalThis, 'location', { value: { reload }, configurable: true, writable: true });
  setNavigator({ onLine: true });
});

afterEach(() => {
  jest.useRealTimers();
  useApiClientMock.mockReset();
  restoreNavigator();
  restoreGlobal('location', originalLocation);
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  resetSessionFallbackStorage();
});

describe('HubShell keeps the screen on (#109)', () => {
  it('requests a screen wake lock when it loads (AC1)', async () => {
    const sentinel = { released: false, release: jest.fn(async () => undefined) };
    const request = jest.fn(async () => sentinel);
    setNavigator({ onLine: true, wakeLock: { request } });
    useApiClientMock.mockReturnValue(hubClient({ household: null }));

    await renderHub();
    await advance(0);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
  });

  it('without the Wake Lock API the hub renders as usual, with no error (AC3)', async () => {
    useApiClientMock.mockReturnValue(hubClient({ household: null }));

    await renderHub();
    await advance(0);

    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
    expect(screen.queryByTestId('today-panel-error')).toBeNull();
  });

  it('a refused wake lock request is silent (AC3)', async () => {
    const request = jest.fn(async () => {
      throw new Error('NotAllowedError');
    });
    setNavigator({ onLine: true, wakeLock: { request } });
    useApiClientMock.mockReturnValue(hubClient({ household: null }));

    await renderHub();
    await advance(0);

    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
    expect(screen.queryByTestId('today-panel-error')).toBeNull();
  });
});

describe('HubShell retries a failed read by itself (#109)', () => {
  it('retries a failed shell read on the backoff without a tap or the loading state (AC4)', async () => {
    const api: { household: ApiResult<unknown> | null } = { household: serverError };
    const client = hubClient(api);
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();
    expect(householdReads(client)).toBe(1);

    await advance(2_000);
    expect(householdReads(client)).toBe(2);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('hub-loading')).toBeNull();
    expect(screen.queryByTestId('today-panel-loading')).toBeNull();

    await advance(3_999);
    expect(householdReads(client)).toBe(2);
    api.household = null;
    await advance(1);
    expect(householdReads(client)).toBe(3);
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');
    expect(screen.queryByTestId('today-panel-error')).toBeNull();

    // Healthy again: no more reads on a timer.
    await advanceInSteps(10 * 60_000, 60_000);
    expect(householdReads(client)).toBe(3);
  });

  it('keeps the cached glance and last-known banner on screen while it retries (AC5)', async () => {
    writeGlance(
      'hh-1',
      { household: { name: 'The Rivera Household', people: roster } },
      undefined,
      new Date(Date.now() - 12 * 60_000).toISOString(),
    );
    const client = hubClient({ household: unreachable });
    useApiClientMock.mockReturnValue(client);

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household');
    expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();

    for (const delay of [2_000, 4_000, 8_000]) {
      await advance(delay);
      expect(screen.queryByTestId('hub-loading')).toBeNull();
      expect(screen.getByTestId('name-tile-p1')).toBeOnTheScreen();
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Rivera Household');
      expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();
    }
    expect(householdReads(client)).toBe(4);
  });
});

describe('HubShell watchdog (#109)', () => {
  it('reloads once after 5 minutes in error while online with an empty queue (AC6)', async () => {
    useApiClientMock.mockReturnValue(hubClient({ household: serverError }));

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();

    await advanceInSteps(WATCHDOG_RELOAD_AFTER_MS - 1_000, 60_000);
    expect(reload).not.toHaveBeenCalled();
    await advanceInSteps(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads from the last-known glance too, after 5 minutes online with an empty queue (AC6)', async () => {
    writeGlance('hh-1', { household: { name: 'Home', people: roster } }, undefined, new Date().toISOString());
    useApiClientMock.mockReturnValue(hubClient({ household: unreachable }));

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('last-known-banner')).toBeOnTheScreen();

    await advanceInSteps(WATCHDOG_RELOAD_AFTER_MS, 60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads while a write is queued, however long the error lasts (AC7)', async () => {
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
    useApiClientMock.mockReturnValue(hubClient({ household: serverError, writesDown: true }));

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();
    expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/);

    await advanceInSteps(60 * 60_000, 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while offline', async () => {
    setNavigator({ onLine: false });
    useApiClientMock.mockReturnValue(hubClient({ household: serverError }));

    await renderHub();
    await advance(0);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();

    await advanceInSteps(60 * 60_000, 60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the hub recovers before 5 minutes', async () => {
    const api: { household: ApiResult<unknown> | null } = { household: serverError };
    useApiClientMock.mockReturnValue(hubClient(api));

    await renderHub();
    await advance(0);
    await advanceInSteps(3 * 60_000, 60_000);
    expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();

    api.household = null;
    // The next retry (at the 60s cap) lands before the 4-minute mark.
    await advanceInSteps(60_000);
    expect(screen.getByTestId('hub-household-name')).toHaveTextContent('Home');

    await advanceInSteps(60 * 60_000, 60_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
