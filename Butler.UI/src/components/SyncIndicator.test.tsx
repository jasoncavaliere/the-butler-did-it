import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { ApiClient, ApiResult } from '../api/client';
import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';
import { OrganizerBar } from '../auth/OrganizerBar';
import { resetSessionFallbackStorage, type LocalStorageLike } from '../offline/storage';
import { WriteQueueProvider, useWriteQueueContext } from '../offline/WriteQueueContext';
import { currentWeekIso } from '../offline/weekIso';
import {
  MAX_WRITE_ATTEMPTS,
  OFFLINE_RETRY_MS,
  assignmentDedupeKey,
  saveWriteQueue,
  type QueuedWrite,
  type WriteRequest,
} from '../offline/writeQueue';
import { OrganizerProvider } from '../state/OrganizerContext';
import {
  SYNC_CONFIRMATION_MS,
  SyncIndicator,
  describeQueuedWrite,
  failedLabel,
} from './SyncIndicator';

// The week the hub is in: the drain flags a write from an ended week (#89).
const WEEK = currentWeekIso();

const confirmed: ApiResult<unknown> = { ok: true, status: 200, data: {}, etag: null };
const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

function completion(choreId: string): WriteRequest {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/hh-1/assignments/${WEEK}/${choreId}/complete`,
    body: { personId: 'p1' },
  };
}

/** A queued write as storage holds it after a reload. */
function stored(choreId: string, overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return { ...completion(choreId), enqueuedAtMs: 1, attempts: 0, status: 'pending', ...overrides };
}

/** A write that exhausted its retries: flagged, kept, never replayed again. */
function flagged(choreId: string, overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return stored(choreId, { attempts: MAX_WRITE_ATTEMPTS, status: 'failed', lastError: 'Conflict', ...overrides });
}

function queueClient(answer: () => ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn() as unknown as ApiClient['get'],
    update: jest.fn(async () => answer()) as unknown as ApiClient['update'],
  };
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

const SESSION: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin Organizer' },
  token: 'bearer-abc',
};

function fakeProvider(): IAuthProvider {
  return { kind: 'fake', signIn: () => Promise.resolve(SESSION), signOut: () => Promise.resolve() };
}

/**
 * Render the indicator inside the one queue the hub provides, and hand back that
 * queue so a test can enqueue or flush exactly as the board would.
 */
function renderIndicator(
  client: ApiClient,
  {
    apiUnreachable,
    target = fakeTarget(),
    organizer = false,
  }: { apiUnreachable?: boolean; target?: ReturnType<typeof fakeTarget>; organizer?: boolean } = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const queue = (
      <WriteQueueProvider householdId="hh-1" client={client}>
        <SyncIndicator apiUnreachable={apiUnreachable} connectivityTarget={target} />
        {children}
      </WriteQueueProvider>
    );
    return organizer ? (
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar />
        {queue}
      </OrganizerProvider>
    ) : (
      queue
    );
  };
  return renderHook(() => useWriteQueueContext(), { wrapper });
}

/** Let the mount drain (or any pending drain) settle under fake timers. */
async function settle(ms = 0) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

beforeEach(() => {
  const map = new Map<string, string>();
  const storage: LocalStorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  resetSessionFallbackStorage();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
  resetSessionFallbackStorage();
  jest.useRealTimers();
});

describe('describeQueuedWrite / failedLabel', () => {
  it('names every write kind, with a calm fallback', () => {
    expect(describeQueuedWrite('chore-complete')).toBe('Marking a chore done');
    expect(describeQueuedWrite('chore-undo')).toBe('Undoing a chore');
    expect(describeQueuedWrite('cart-add')).toBe('Adding to the cart');
    expect(describeQueuedWrite('hub-glance')).toBe('Recording a hub view');
    expect(describeQueuedWrite('something-new')).toBe('A change');
  });

  it('counts failed writes in plain words', () => {
    expect(failedLabel(1)).toBe('1 change did not go through');
    expect(failedLabel(3)).toBe('3 changes did not go through');
  });
});

describe('SyncIndicator', () => {
  it('indicator-reflects-state: online and offline events toggle the indicator', async () => {
    const target = fakeTarget();
    await renderIndicator(queueClient(() => confirmed), { target });

    const connection = () => screen.getByTestId('sync-indicator-connection');
    await waitFor(() => expect(connection()).toHaveTextContent(/Online/));
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe('Online');
    expect(screen.getByTestId('sync-indicator').props.accessibilityLiveRegion).toBe('polite');

    await act(async () => {
      target.emit('offline');
    });
    expect(connection()).toHaveTextContent(/Offline/);
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe('Offline');

    await act(async () => {
      target.emit('online');
    });
    expect(connection()).toHaveTextContent(/Online/);
  });

  it('reads offline when the browser starts offline', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
    await renderIndicator(queueClient(() => confirmed));

    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Offline/);
  });

  it('stays offline while the hub is serving last-known data, even when the browser says online', async () => {
    await renderIndicator(queueClient(() => confirmed), { apiUnreachable: true });

    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Offline/);
  });

  it('stays offline while the queue cannot reach the API, and returns to online once it syncs', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [stored('c1')]);
    let offline = true;
    const { result } = await renderIndicator(queueClient(() => (offline ? unreachable : confirmed)));
    await settle();

    // The browser says online, but the drain could not reach the API.
    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Offline/);
    expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/);

    offline = false;
    await act(async () => {
      result.current.flush();
    });
    await settle();

    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Online/);
    expect(screen.queryByTestId('sync-indicator-pending')).toBeNull();
    expect(screen.getByTestId('sync-indicator-synced')).toHaveTextContent(/All synced\./);
  });

  it('pending-count-updates: enqueuing writes raises the count, and it is hidden at zero', async () => {
    const { result } = await renderIndicator(queueClient(() => unreachable));

    expect(screen.queryByTestId('sync-indicator-pending')).toBeNull();

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/),
    );

    await act(async () => {
      result.current.enqueue(completion('c2'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/2 waiting to sync/),
    );
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe(
      'Offline. 2 waiting to sync',
    );
  });

  it('cleared-after-sync: a drain that confirms the queue clears pending and briefly confirms it', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [stored('c1'), stored('c2')]);
    await renderIndicator(queueClient(() => confirmed));
    await settle();

    expect(screen.queryByTestId('sync-indicator-pending')).toBeNull();
    expect(screen.getByTestId('sync-indicator-synced')).toHaveTextContent(/All synced\./);
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe('Online. All synced.');

    // Brief and non-blocking: it simply goes, nobody dismisses it.
    await settle(SYNC_CONFIRMATION_MS - 1);
    expect(screen.getByTestId('sync-indicator-synced')).toBeOnTheScreen();
    await settle(1);
    expect(screen.queryByTestId('sync-indicator-synced')).toBeNull();
    expect(screen.getByTestId('sync-indicator-connection')).toHaveTextContent(/Online/);
  });

  it('shows no confirmation on mount or when a drain confirms nothing', async () => {
    jest.useFakeTimers();
    const { result } = await renderIndicator(queueClient(() => unreachable));
    await settle();
    expect(screen.queryByTestId('sync-indicator-synced')).toBeNull();

    await act(async () => {
      result.current.enqueue(completion('c1'));
    });
    await settle();
    expect(screen.getByTestId('sync-indicator-pending')).toBeOnTheScreen();
    expect(screen.queryByTestId('sync-indicator-synced')).toBeNull();
  });

  it('does not claim all synced while writes are still waiting', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [stored('c1'), stored('c2')]);
    let calls = 0;
    // The first write gets through, then the network drops before the second.
    await renderIndicator(queueClient(() => (++calls === 1 ? confirmed : unreachable)));
    await settle();

    expect(screen.getByTestId('sync-indicator-pending')).toHaveTextContent(/1 waiting to sync/);
    expect(screen.queryByTestId('sync-indicator-synced')).toBeNull();
  });

  it('stops the confirmation timer on unmount', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [stored('c1')]);
    const set = jest.spyOn(globalThis, 'setTimeout');
    const clear = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await renderIndicator(queueClient(() => confirmed));
    await settle();
    expect(screen.getByTestId('sync-indicator-synced')).toBeOnTheScreen();

    const armed = set.mock.calls.findIndex(([, delay]) => delay === SYNC_CONFIRMATION_MS);
    expect(armed).toBeGreaterThanOrEqual(0);
    const timer = set.mock.results[armed].value as unknown;

    await unmount();
    expect(clear).toHaveBeenCalledWith(timer);
    set.mockRestore();
    clear.mockRestore();
  });

  it('failed-write-is-surfaced: a flagged write stays visible and is never auto-cleared', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [flagged('c1')]);
    await renderIndicator(queueClient(() => confirmed));
    await settle();

    expect(screen.getByTestId('sync-indicator-failed')).toHaveTextContent(
      /1 change did not go through/,
    );
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe(
      'Online. 1 change did not go through',
    );

    await settle(SYNC_CONFIRMATION_MS + OFFLINE_RETRY_MS);
    await settle(10 * OFFLINE_RETRY_MS);
    expect(screen.getByTestId('sync-indicator-failed')).toHaveTextContent(
      /1 change did not go through/,
    );
  });

  it('never says all synced beside a failed write', async () => {
    jest.useFakeTimers();
    // One write flagged earlier, and one tap queued since that does get through.
    saveWriteQueue('hh-1', [flagged('c1'), stored('c2')]);
    await renderIndicator(queueClient(() => confirmed));
    await settle();

    expect(screen.getByTestId('sync-indicator-synced')).toHaveTextContent(/Synced\./);
    expect(screen.getByTestId('sync-indicator-synced')).not.toHaveTextContent(/All synced/);
    expect(screen.getByTestId('sync-indicator').props.accessibilityLabel).toBe(
      'Online. Synced. 1 change did not go through',
    );
    expect(screen.getByTestId('sync-indicator-failed')).toHaveTextContent(
      /1 change did not go through/,
    );
  });

  it('uses the plural for more than one failed write', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [flagged('c1'), flagged('c2')]);
    await renderIndicator(queueClient(() => confirmed));
    await settle();

    expect(screen.getByTestId('sync-indicator-failed')).toHaveTextContent(
      /2 changes did not go through/,
    );
  });

  it('a participant sees only the failed count, not the detail', async () => {
    jest.useFakeTimers();
    saveWriteQueue('hh-1', [flagged('c1')]);
    await renderIndicator(queueClient(() => confirmed), { organizer: true });
    await settle();

    expect(screen.getByTestId('sync-indicator-failed')).toBeOnTheScreen();
    expect(screen.queryByTestId('sync-indicator-failed-detail')).toBeNull();
  });

  it('organizer sees which write failed and why', async () => {
    jest.useFakeTimers();
    const undo = { ...flagged('c2', { lastError: undefined }), kind: 'chore-undo' as const };
    const cart: QueuedWrite = {
      kind: 'cart-add',
      dedupeKey: 'cart|milk',
      method: 'POST',
      path: '/households/hh-1/carts/current/items',
      body: {},
      enqueuedAtMs: 1,
      attempts: MAX_WRITE_ATTEMPTS,
      status: 'failed',
      lastError: 'Out of stock',
    };
    const unknownKind = {
      ...flagged('c3', { lastError: 'Nope' }),
      kind: 'mystery' as unknown as QueuedWrite['kind'],
    };
    // A pending write alongside is not part of the failed detail.
    saveWriteQueue('hh-1', [flagged('c1'), undo, cart, unknownKind, stored('c4')]);
    await renderIndicator(queueClient(() => unreachable), { organizer: true });
    await settle();

    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });

    expect(screen.getByTestId('sync-indicator-failed')).toHaveTextContent(
      /4 changes did not go through/,
    );
    expect(screen.getByTestId('sync-indicator-failed-detail')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`sync-indicator-failed-${assignmentDedupeKey(WEEK, 'c1')}`),
    ).toHaveTextContent('Marking a chore done: Conflict');
    expect(
      screen.getByTestId(`sync-indicator-failed-${assignmentDedupeKey(WEEK, 'c2')}`),
    ).toHaveTextContent('Undoing a chore: It could not be synced.');
    expect(screen.getByTestId('sync-indicator-failed-cart|milk')).toHaveTextContent(
      'Adding to the cart: Out of stock',
    );
    expect(
      screen.getByTestId(`sync-indicator-failed-${assignmentDedupeKey(WEEK, 'c3')}`),
    ).toHaveTextContent('A change: Nope');
    expect(
      screen.queryByTestId(`sync-indicator-failed-${assignmentDedupeKey(WEEK, 'c4')}`),
    ).toBeNull();
  });
});
