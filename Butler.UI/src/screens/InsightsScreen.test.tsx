import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { InsightsScreen } from './InsightsScreen';
import type { ApiClient, ApiResult } from '../api/client';
import type { InsightsResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { colors } from '../components/Screen';
import { typeScale } from '../layout/tokens';
import { HouseholdProvider } from '../state/HouseholdContext';
import { claimColors } from '../theme/theme';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const ME: ApiResult<unknown> = {
  ok: true,
  status: 200,
  data: { subject: 'org', name: 'Org' },
  etag: null,
};

/** Two weeks, three members (Kit has no claim colour), three days and two months. */
const INSIGHTS: InsightsResponse = {
  windowStartWeekIso: '2026-W28',
  windowEndWeekIso: '2026-W29',
  windowWeeks: 2,
  members: [
    { personId: 'p1', displayName: 'Alex', claimColor: '#C2185B' },
    { personId: 'p2', displayName: 'Sam', claimColor: '#1565C0' },
    { personId: 'p3', displayName: 'Kit', claimColor: null },
  ],
  weeks: [
    {
      weekIso: '2026-W28',
      totalEffort: 5,
      topContributorPersonId: 'p1',
      topContributorShare: 0.6,
      completions: [
        { personId: 'p1', completions: 3 },
        { personId: 'p2', completions: 2 },
        { personId: 'p3', completions: 0 },
      ],
    },
    {
      weekIso: '2026-W29',
      totalEffort: 0,
      topContributorPersonId: null,
      topContributorShare: 0,
      completions: [
        { personId: 'p1', completions: 0 },
        { personId: 'p2', completions: 0 },
        { personId: 'p3', completions: 0 },
      ],
    },
  ],
  glancesPerDay: [
    { date: '2026-07-13', count: 2 },
    { date: '2026-07-14', count: 0 },
    { date: '2026-07-15', count: 1 },
  ],
  cartsConfirmedPerMonth: [
    { month: '2026-06', count: 1 },
    { month: '2026-07', count: 2 },
  ],
};

const OK_INSIGHTS: ApiResult<unknown> = { ok: true, status: 200, data: INSIGHTS, etag: null };
const FAILED: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'http', status: 500, title: 'Server error' },
};

/** A client that answers `/me` with `me` and the insights read with each of `insights` in turn. */
function clientWith(me: ApiResult<unknown>, ...insights: ApiResult<unknown>[]): ApiClient {
  const queue = [...insights];
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> =>
      path === '/me' ? me : (queue.length > 1 ? queue.shift() : queue[0])!,
    ) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

async function renderScreen(client: ApiClient, householdId: string | null = 'hh-1') {
  useApiClientMock.mockReturnValue(client);
  await render(
    <HouseholdProvider initialHouseholdId={householdId}>
      <InsightsScreen />
    </HouseholdProvider>,
  );
}

function backgroundOf(testID: string): unknown {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).backgroundColor;
}

function heightOf(testID: string): unknown {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).height;
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('InsightsScreen', () => {
  it('requests the insights endpoint for the selected household with weeks=8', async () => {
    const client = clientWith(ME, OK_INSIGHTS);

    await renderScreen(client);

    await waitFor(() => expect(screen.getByTestId('insights-chart-top-share')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledWith('/households/hh-1/insights?weeks=8');
  });

  it('renders the four insight series as charts', async () => {
    await renderScreen(clientWith(ME, OK_INSIGHTS));

    await waitFor(() => expect(screen.getByTestId('insights-chart-top-share')).toBeOnTheScreen());
    expect(screen.getByTestId('insights-screen')).toBeOnTheScreen();

    // Top contributor's share: a bar per week sized to the share.
    const topShare = within(screen.getByTestId('insights-chart-top-share'));
    expect(topShare.getByText('W28')).toBeOnTheScreen();
    expect(topShare.getByText('60%')).toBeOnTheScreen();
    expect(topShare.getByText('Alex')).toBeOnTheScreen();
    expect(topShare.getByText('0%')).toBeOnTheScreen();
    expect(heightOf('insights-chart-top-share-bar-2026-W28')).toBe('60%');
    expect(heightOf('insights-chart-top-share-bar-2026-W29')).toBe('0%');
    expect(screen.getByTestId('insights-chart-top-share-bar-2026-W29').props.accessibilityLabel).toBe(
      'W29: no completed effort',
    );

    // Completions per member per week: one bar per member per week, scaled to the max.
    expect(heightOf('insights-chart-completions-bar-2026-W28-p1')).toBe('100%');
    expect(heightOf('insights-chart-completions-bar-2026-W28-p2')).toBe(`${(2 / 3) * 100}%`);
    expect(heightOf('insights-chart-completions-bar-2026-W29-p3')).toBe('0%');
    expect(screen.getByTestId('insights-legend-p3')).toHaveTextContent('Kit');

    // Glances per day: a bar per day, first and last day labels, and a total.
    expect(heightOf('insights-chart-glances-bar-2026-07-13')).toBe('100%');
    expect(heightOf('insights-chart-glances-bar-2026-07-15')).toBe('50%');
    const glances = within(screen.getByTestId('insights-chart-glances'));
    expect(glances.getByText('Jul 13')).toBeOnTheScreen();
    expect(glances.getByText('Jul 15')).toBeOnTheScreen();
    expect(screen.getByTestId('insights-glances-total')).toHaveTextContent('3 glances in total');

    // Carts confirmed per month.
    const carts = within(screen.getByTestId('insights-chart-carts'));
    expect(carts.getByText('Jun 2026')).toBeOnTheScreen();
    expect(carts.getByText('Jul 2026')).toBeOnTheScreen();
    expect(heightOf('insights-chart-carts-bar-2026-06')).toBe('50%');
    expect(backgroundOf('insights-chart-carts-bar-2026-07')).toBe(colors.brass);
  });

  it("colours each person's series with their claim colour", async () => {
    await renderScreen(clientWith(ME, OK_INSIGHTS));

    await waitFor(() => expect(screen.getByTestId('insights-chart-completions')).toBeOnTheScreen());

    expect(backgroundOf('insights-chart-completions-bar-2026-W28-p1')).toBe('#C2185B');
    expect(backgroundOf('insights-chart-completions-bar-2026-W28-p2')).toBe('#1565C0');
    // No claim colour: a token claim colour by position (third member).
    expect(backgroundOf('insights-chart-completions-bar-2026-W28-p3')).toBe(claimColors[2].dark);
    expect(backgroundOf('insights-legend-p1-swatch')).toBe('#C2185B');
    expect(backgroundOf('insights-legend-p3-swatch')).toBe(claimColors[2].dark);

    // The top-share bar takes the top contributor's colour; a week without one is muted.
    expect(backgroundOf('insights-chart-top-share-bar-2026-W28')).toBe('#C2185B');
    expect(backgroundOf('insights-chart-top-share-bar-2026-W29')).toBe(colors.muted);
  });

  it('keeps every chart text at or above the 18px body floor', async () => {
    await renderScreen(clientWith(ME, OK_INSIGHTS));

    await waitFor(() => expect(screen.getByTestId('insights-chart-carts')).toBeOnTheScreen());

    const texts = screen.getAllByText(/\S/);
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) {
      const fontSize = StyleSheet.flatten(text.props.style).fontSize;
      expect(fontSize).toBeGreaterThanOrEqual(typeScale.body);
    }
  });

  it('still renders all four charts when every series is empty', async () => {
    const empty: InsightsResponse = {
      ...INSIGHTS,
      members: [],
      weeks: [],
      glancesPerDay: [],
      cartsConfirmedPerMonth: [],
    };

    await renderScreen(clientWith(ME, { ok: true, status: 200, data: empty, etag: null }));

    await waitFor(() => expect(screen.getByTestId('insights-chart-top-share')).toBeOnTheScreen());
    expect(screen.getByTestId('insights-chart-completions')).toBeOnTheScreen();
    expect(screen.getByTestId('insights-chart-glances')).toBeOnTheScreen();
    expect(screen.getByTestId('insights-chart-carts')).toBeOnTheScreen();
    expect(screen.getByTestId('insights-glances-total')).toHaveTextContent('0 glances in total');
  });

  it('shows an error at the body size and retries on Try again', async () => {
    const client = clientWith(ME, FAILED, OK_INSIGHTS);

    await renderScreen(client);

    await waitFor(() => expect(screen.getByTestId('insights-error')).toBeOnTheScreen());
    expect(StyleSheet.flatten(screen.getByTestId('insights-error').props.style).fontSize).toBe(
      typeScale.body,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('insights-retry'));
    });

    await waitFor(() => expect(screen.getByTestId('insights-chart-top-share')).toBeOnTheScreen());
    expect(screen.queryByTestId('insights-error')).toBeNull();
  });

  it('shows a loading line while the insights are on their way', async () => {
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn((path: string) =>
        path === '/me' ? Promise.resolve(ME) : new Promise<ApiResult<unknown>>(() => undefined),
      ) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };

    await renderScreen(client);

    await waitFor(() => expect(screen.getByTestId('insights-loading')).toBeOnTheScreen());
  });

  it('blocks a non-organizer from reaching the dashboard', async () => {
    const client = clientWith(
      { ok: false, error: { kind: 'http', status: 403, title: 'Forbidden' } },
      OK_INSIGHTS,
    );

    await renderScreen(client);

    await waitFor(() => expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen());
    expect(screen.queryByTestId('insights-screen')).toBeNull();
    expect(client.get).not.toHaveBeenCalledWith('/households/hh-1/insights?weeks=8');
  });

  it('asks for a household when none is selected', async () => {
    const client = clientWith(ME, OK_INSIGHTS);

    await renderScreen(client, null);

    await waitFor(() => expect(screen.getByTestId('insights-no-household')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that lands after the screen unmounts', async () => {
    let resolveInsights: (result: ApiResult<unknown>) => void = () => undefined;
    const client: ApiClient = {
      baseUrl: 'http://api.test:1',
      get: jest.fn((path: string) =>
        path === '/me'
          ? Promise.resolve(ME)
          : new Promise<ApiResult<unknown>>((resolve) => {
              resolveInsights = resolve;
            }),
      ) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    };

    await renderScreen(client);
    await waitFor(() => expect(screen.getByTestId('insights-loading')).toBeOnTheScreen());

    await act(async () => {
      screen.unmount();
    });
    await act(async () => {
      resolveInsights(OK_INSIGHTS);
    });

    expect(screen.queryByTestId('insights-chart-top-share')).toBeNull();
  });
});
