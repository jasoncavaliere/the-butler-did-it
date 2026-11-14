import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HouseholdSetupScreen } from './HouseholdSetupScreen';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

function clientWithGet(result: ApiResult<unknown>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HouseholdSetupScreen', () => {
  it('shows the setup flow for an authenticated organizer', async () => {
    useApiClientMock.mockReturnValue(
      clientWithGet({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null }),
    );

    await render(
      <HouseholdProvider>
        <HouseholdSetupScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('household-setup')).toBeOnTheScreen());
    expect(screen.getByTestId('step-household')).toBeOnTheScreen();
  });

  it('leaves the context menu alone outside the hub (#130)', async () => {
    useApiClientMock.mockReturnValue(
      clientWithGet({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null }),
    );

    await render(
      <HouseholdProvider>
        <HouseholdSetupScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('household-setup')).toBeOnTheScreen());
    // Only the hub is a kiosk: no ancestor of the setup flow handles the context menu.
    type HostNode = { props: Record<string, unknown>; parent: HostNode | null };
    for (let at = screen.getByTestId('household-setup') as unknown as HostNode | null; at !== null; at = at.parent) {
      expect(at.props.onContextMenu).toBeUndefined();
    }
    const preventDefault = jest.fn();
    await fireEvent(screen.getByTestId('step-household'), 'contextMenu', {
      target: { tagName: 'DIV' },
      preventDefault,
    });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('blocks a non-organizer from reaching the flow', async () => {
    useApiClientMock.mockReturnValue(
      clientWithGet({ ok: false, error: { kind: 'http', status: 403, title: 'Forbidden' } }),
    );

    await render(
      <HouseholdProvider>
        <HouseholdSetupScreen />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen());
    expect(screen.queryByTestId('household-setup')).toBeNull();
  });
});
