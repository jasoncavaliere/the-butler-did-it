import { render, screen, waitFor } from '@testing-library/react-native';

import { RootNavigator } from './RootNavigator';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client whose `get` answers both the /me probe and the /health probe. */
function client(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('RootNavigator', () => {
  it('routes to the onboarding flow when no household is selected', async () => {
    useApiClientMock.mockReturnValue(
      client({ ok: true, status: 200, data: { subject: 'org', status: 'ok' }, etag: null }),
    );

    await render(
      <HouseholdProvider>
        <RootNavigator />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('step-household')).toBeOnTheScreen());
  });

  it('routes to the Home hub once a household is selected', async () => {
    useApiClientMock.mockReturnValue(
      client({ ok: true, status: 200, data: { subject: 'org', status: 'ok' }, etag: null }),
    );

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <RootNavigator />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('Welcome home')).toBeOnTheScreen();
  });
});
