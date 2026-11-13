import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import type { ApiClient, ApiResult } from '../api/client';
import { resetSessionFallbackStorage, type LocalStorageLike } from './storage';
import { WriteQueueProvider, useWriteQueueContext } from './WriteQueueContext';
import type { WriteQueueState } from './useWriteQueue';
import { currentWeekIso } from './weekIso';
import { assignmentDedupeKey, readWriteQueue, saveWriteQueue, type QueuedWrite } from './writeQueue';

const WEEK = currentWeekIso();

const confirmed: ApiResult<unknown> = { ok: true, status: 200, data: {}, etag: null };

function stored(choreId: string): QueuedWrite {
  return {
    kind: 'chore-complete',
    dedupeKey: assignmentDedupeKey(WEEK, choreId),
    method: 'POST',
    path: `/households/hh-1/assignments/${WEEK}/${choreId}/complete`,
    body: { personId: 'p1' },
    enqueuedAtMs: 1,
    attempts: 0,
    status: 'pending',
  };
}

function queueClient(answer: () => ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn() as unknown as ApiClient['get'],
    update: jest.fn(async () => answer()) as unknown as ApiClient['update'],
  };
}

beforeEach(() => {
  const map = new Map<string, string>();
  const storage: LocalStorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  resetSessionFallbackStorage();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  resetSessionFallbackStorage();
});

describe('WriteQueueProvider', () => {
  it('shares one queue: two consumers see the same state and the queue drains once', async () => {
    saveWriteQueue('hh-1', [stored('c1')]);
    const client = queueClient(() => confirmed);
    const seen: { a?: WriteQueueState; b?: WriteQueueState } = {};

    function Consumer({ name }: { name: 'a' | 'b' }) {
      const queue = useWriteQueueContext();
      seen[name] = queue;
      return <Text testID={`pending-${name}`}>{String(queue.pending)}</Text>;
    }

    await render(
      <WriteQueueProvider householdId="hh-1" client={client}>
        <Consumer name="a" />
        <Consumer name="b" />
      </WriteQueueProvider>,
    );

    await waitFor(() => expect(readWriteQueue('hh-1')).toEqual([]));
    await waitFor(() => expect(screen.getByTestId('pending-a')).toHaveTextContent('0'));
    expect(screen.getByTestId('pending-b')).toHaveTextContent('0');
    // One queue instance, so one drain: the single stored write went out once.
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(seen.a).toBe(seen.b);
    expect(seen.a?.confirmedRevision).toBe(1);
  });

  it('a write enqueued by one consumer is pending for the other', async () => {
    const client = queueClient(() => ({
      ok: false,
      error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
    }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WriteQueueProvider householdId="hh-1" client={client}>
        {children}
      </WriteQueueProvider>
    );
    const { result } = await renderHook(
      () => ({ writer: useWriteQueueContext(), reader: useWriteQueueContext() }),
      { wrapper },
    );

    await act(async () => {
      result.current.writer.enqueue(stored('c1'));
    });

    await waitFor(() => expect(result.current.reader.pending).toBe(1));
    expect(result.current.reader.unreachable).toBe(true);
  });

  it('useWriteQueueContext throws outside a provider rather than dropping writes', async () => {
    // React logs the thrown render error; keep the test output quiet.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(renderHook(() => useWriteQueueContext())).rejects.toThrow(
        'useWriteQueueContext must be used inside a WriteQueueProvider',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
