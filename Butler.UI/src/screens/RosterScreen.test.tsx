import { render, screen, waitFor } from '@testing-library/react-native';

import { RosterScreen } from './RosterScreen';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client that answers `/me` with `me` and the roster with an empty list. */
function clientWithMe(me: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> =>
      path === '/me' ? me : { ok: true, status: 200, data: [], etag: null },
    ) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('RosterScreen', () => {
  it('shows the Roster editor for an authenticated organizer', async () => {
    useApiClientMock.mockReturnValue(
      clientWithMe({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null }),
    );

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <RosterScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('roster-editor')).toBeOnTheScreen());
    await waitFor(() => expect(screen.getByTestId('roster-empty')).toBeOnTheScreen());
  });

  it('blocks a non-organizer from reaching the editor', async () => {
    useApiClientMock.mockReturnValue(
      clientWithMe({ ok: false, error: { kind: 'http', status: 403, title: 'Forbidden' } }),
    );

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <RosterScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen());
    expect(screen.queryByTestId('roster-editor')).toBeNull();
  });
});
