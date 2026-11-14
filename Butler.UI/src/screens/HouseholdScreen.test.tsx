import { render, screen, waitFor } from '@testing-library/react-native';

import { HouseholdScreen } from './HouseholdScreen';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client that answers `/me` with `me` and the room/chore lists with empty arrays. */
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

describe('HouseholdScreen', () => {
  it('shows the Household editor for an authenticated organizer', async () => {
    useApiClientMock.mockReturnValue(
      clientWithMe({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null }),
    );

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('household-editor')).toBeOnTheScreen());
    await waitFor(() => expect(screen.getByTestId('new-room-name')).toBeOnTheScreen());
  });

  it('blocks a non-organizer from reaching the editor', async () => {
    useApiClientMock.mockReturnValue(
      clientWithMe({ ok: false, error: { kind: 'http', status: 403, title: 'Forbidden' } }),
    );

    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HouseholdScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen());
    expect(screen.queryByTestId('household-editor')).toBeNull();
  });
});
