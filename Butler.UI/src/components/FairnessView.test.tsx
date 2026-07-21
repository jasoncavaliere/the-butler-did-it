import { act, render, screen, waitFor } from '@testing-library/react-native';

import { FairnessView, type FairnessPerson } from './FairnessView';
import type { ApiClient, ApiResult } from '../api/client';
import type { FairnessResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, etag: null });

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

const people: FairnessPerson[] = [
  { personId: 'p1', claimColor: '#B0206F' },
  { personId: 'p2', claimColor: null },
];

// Alex 6 (75%), Sam 2 (25%), total 8; Alex is the top contributor.
const balance: FairnessResponse = {
  windowStartWeekIso: '2026-W26',
  windowEndWeekIso: '2026-W29',
  windowWeeks: 4,
  totalEffort: 8,
  topContributorPersonId: 'p1',
  shares: [
    { personId: 'p1', displayName: 'Alex', totalEffort: 6, share: 0.75, sharePercent: 75 },
    { personId: 'p2', displayName: 'Sam', totalEffort: 2, share: 0.25, sharePercent: 25 },
  ],
};

/** A client whose fairness read resolves to `result` (defaults to the balance above). */
function fairnessClient(result?: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (): Promise<ApiResult<unknown>> => result ?? ok(balance)) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

async function renderView(
  client: ApiClient,
  props: { people?: FairnessPerson[]; windowWeeks?: number } = {},
) {
  useApiClientMock.mockReturnValue(client);
  return render(<FairnessView householdId="hh-1" {...props} />);
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('FairnessView', () => {
  it('renders the per-person distribution and highlights the top contributor', async () => {
    await renderView(fairnessClient(), { people });

    await waitFor(() => expect(screen.getByTestId('fairness-view')).toBeOnTheScreen());

    // A row and a bar per person, labelled with their name and share.
    expect(screen.getByTestId('fairness-row-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('fairness-row-p2')).toBeOnTheScreen();
    expect(screen.getByTestId('fairness-percent-p1')).toHaveTextContent('75%');
    expect(screen.getByTestId('fairness-percent-p2')).toHaveTextContent('25%');

    // The top contributor is called out; the other person is not.
    expect(screen.getByText('Alex (top)')).toBeOnTheScreen();
    expect(screen.getByText('Sam')).toBeOnTheScreen();
    expect(screen.queryByText('Sam (top)')).toBeNull();

    // The bar fills to the share, accented by the person's claim colour.
    const topBar = screen.getByTestId('fairness-bar-p1');
    expect(topBar.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '75%', backgroundColor: '#B0206F' })]),
    );
  });

  it('requests the given trailing window when one is supplied', async () => {
    const client = fairnessClient();
    await renderView(client, { windowWeeks: 8 });

    await waitFor(() => expect(screen.getByTestId('fairness-view')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledWith('/households/hh-1/fairness?windowWeeks=8');
  });

  it('requests the default window (no query) when none is supplied', async () => {
    const client = fairnessClient();
    await renderView(client);

    await waitFor(() => expect(screen.getByTestId('fairness-view')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledWith('/households/hh-1/fairness');
  });

  it('falls back to the neutral accent for a person with no claim colour and one off the roster', async () => {
    // p2 has a null claim colour; "ghost" is not in the people list at all - both
    // resolve to the brass accent rather than crashing.
    const withGhost: FairnessResponse = {
      ...balance,
      totalEffort: 10,
      topContributorPersonId: 'ghost',
      shares: [
        { personId: 'ghost', displayName: 'ghost', totalEffort: 6, share: 0.6, sharePercent: 60 },
        { personId: 'p2', displayName: 'Sam', totalEffort: 4, share: 0.4, sharePercent: 40 },
      ],
    };
    await renderView(fairnessClient(ok(withGhost)), { people });

    await waitFor(() => expect(screen.getByTestId('fairness-view')).toBeOnTheScreen());
    expect(screen.getByText('ghost (top)')).toBeOnTheScreen();
    const ghostBar = screen.getByTestId('fairness-bar-ghost');
    expect(ghostBar.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#D9B25A' })]),
    );
  });

  it('renders a one-decimal percentage when the share is fractional', async () => {
    const fractional: FairnessResponse = {
      ...balance,
      totalEffort: 3,
      topContributorPersonId: 'p1',
      shares: [
        { personId: 'p1', displayName: 'Alex', totalEffort: 2, share: 0.667, sharePercent: 66.7 },
        { personId: 'p2', displayName: 'Sam', totalEffort: 1, share: 0.333, sharePercent: 33.3 },
      ],
    };
    await renderView(fairnessClient(ok(fractional)));

    await waitFor(() => expect(screen.getByTestId('fairness-percent-p1')).toHaveTextContent('66.7%'));
    expect(screen.getByTestId('fairness-percent-p2')).toHaveTextContent('33.3%');
  });

  it('clamps an out-of-range share percent to the [0, 100] band', async () => {
    const wild: FairnessResponse = {
      ...balance,
      totalEffort: 5,
      topContributorPersonId: 'p1',
      shares: [
        { personId: 'p1', displayName: 'Alex', totalEffort: 5, share: 1, sharePercent: 140 },
        { personId: 'p2', displayName: 'Sam', totalEffort: 0, share: 0, sharePercent: -10 },
      ],
    };
    await renderView(fairnessClient(ok(wild)));

    await waitFor(() => expect(screen.getByTestId('fairness-view')).toBeOnTheScreen());
    // 140 clamps to 100, -10 clamps to 0.
    expect(screen.getByTestId('fairness-bar-p1').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })]),
    );
    expect(screen.getByTestId('fairness-bar-p2').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '0%' })]),
    );
  });

  it('shows a calm empty state when no chores have been completed (zero total)', async () => {
    const empty: FairnessResponse = {
      ...balance,
      totalEffort: 0,
      topContributorPersonId: null,
      shares: [
        { personId: 'p1', displayName: 'Alex', totalEffort: 0, share: 0, sharePercent: 0 },
      ],
    };
    await renderView(fairnessClient(ok(empty)));

    await waitFor(() => expect(screen.getByTestId('fairness-empty')).toBeOnTheScreen());
    expect(screen.getByTestId('fairness-view')).toBeOnTheScreen();
  });

  it('shows the empty state when the response has no shares', async () => {
    await renderView(fairnessClient(ok({ ...balance, totalEffort: 0, shares: [] })));

    await waitFor(() => expect(screen.getByTestId('fairness-empty')).toBeOnTheScreen());
  });

  it('treats a read with no body as an empty balance', async () => {
    await renderView(fairnessClient({ ok: true, status: 200, data: undefined, etag: null }));

    await waitFor(() => expect(screen.getByTestId('fairness-empty')).toBeOnTheScreen());
  });

  it('shows the loading state until the read resolves', async () => {
    let resolve: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((r) => {
      resolve = r;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };
    await renderView(client);

    expect(screen.getByTestId('fairness-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(ok(balance));
      await pending;
    });

    await waitFor(() => expect(screen.queryByTestId('fairness-loading')).toBeNull());
    expect(screen.getByTestId('fairness-view')).toBeOnTheScreen();
  });

  it('surfaces a calm error when the read fails', async () => {
    await renderView(fairnessClient(unreachable));

    await waitFor(() => expect(screen.getByTestId('fairness-error')).toBeOnTheScreen());
    expect(screen.getByTestId('fairness-error')).toHaveTextContent(/unreachable/);
  });

  it('surfaces a calm error when the read returns nothing', async () => {
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => undefined as unknown as ApiResult<unknown>) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };
    await renderView(client);

    await waitFor(() => expect(screen.getByTestId('fairness-error')).toBeOnTheScreen());
    expect(screen.getByTestId('fairness-error')).toHaveTextContent(/unavailable/);
  });

  it('ignores a read that resolves after the view unmounts', async () => {
    let resolve: (value: ApiResult<unknown>) => void = () => {};
    const pending = new Promise<ApiResult<unknown>>((r) => {
      resolve = r;
    });
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn(async () => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };
    const view = await renderView(client);

    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      resolve(ok(balance));
      await pending;
    });

    expect(screen.queryByTestId('fairness-view')).toBeNull();
  });
});
