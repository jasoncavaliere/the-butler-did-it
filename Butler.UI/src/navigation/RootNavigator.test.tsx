import { render, screen, waitFor } from '@testing-library/react-native';

import { RootNavigator } from './RootNavigator';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client whose `get` answers by path: /me, the household read, and the roster. */
function pathAwareClient(): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.endsWith('/people')) {
        return { ok: true, status: 200, data: [], etag: null };
      }
      if (path === '/me') {
        return { ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null };
      }
      return { ok: true, status: 200, data: { name: 'The Test Household' }, etag: null };
    }) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('RootNavigator', () => {
  it('routes to the onboarding flow when no household is selected', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());

    await render(
      <HouseholdProvider>
        <RootNavigator />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('step-household')).toBeOnTheScreen());
  });

  it('routes to the Home hub shell once a household is selected', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <RootNavigator />
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Test Household'),
    );
  });
});
