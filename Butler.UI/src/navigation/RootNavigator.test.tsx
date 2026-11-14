import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RootNavigator } from './RootNavigator';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider } from '../auth/authProvider';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx; this client's
// writes resolve to nothing, so the real hook would have no result to read.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client whose `get` answers by path: /me, the household read, the roster, rooms, and chores. */
function pathAwareClient(): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path.endsWith('/people') || path.endsWith('/rooms') || path.endsWith('/chores')) {
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

  it('opens the Household screen from the organizer bar', async () => {
    useApiClientMock.mockReturnValue(pathAwareClient());
    const authProvider: IAuthProvider = {
      kind: 'fake',
      signIn: () =>
        Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
      signOut: () => Promise.resolve(),
    };

    await render(
      <HouseholdProvider initialHouseholdId="hh-77">
        <OrganizerProvider authProvider={authProvider}>
          <RootNavigator />
        </OrganizerProvider>
      </HouseholdProvider>,
    );

    expect(await screen.findByTestId('hub-shell')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('affordance-edit-household'));
    });

    expect(await screen.findByTestId('household-editor')).toBeOnTheScreen();
  });
});
