import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import { HubPairing } from './HubPairing';
import type { IAuthProvider, OrganizerSession } from './authProvider';
import type { ApiClient, ApiResult } from '../api/client';
import type { HubDevicePairingResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';
import { HubDeviceProvider, useHubDevice } from '../state/HubDeviceContext';
import { OrganizerProvider, useOrganizer } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const SESSION: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin Organizer' },
  token: 'bearer-abc',
};

function fakeProvider(): IAuthProvider {
  return {
    kind: 'fake',
    signIn: () => Promise.resolve(SESSION),
    signOut: () => Promise.resolve(),
  };
}

const PAIRING: HubDevicePairingResponse = {
  householdId: 'hh-1',
  deviceId: 'dev-1',
  deviceName: 'This tablet',
  pairedUtc: '2026-07-20T09:00:00Z',
  token: 'device-token-xyz',
};

/** A client whose pair call records the request and resolves to {@link result}. */
function pairingClient(result: ApiResult<unknown>): { client: ApiClient; update: jest.Mock } {
  const update = jest.fn(async (): Promise<ApiResult<unknown>> => result);
  return {
    update,
    client: {
      baseUrl: 'http://api.test:1',
      get: jest.fn() as unknown as ApiClient['get'],
      update: update as unknown as ApiClient['update'],
    },
  };
}

/** Surfaces the stored device token so a test can assert it was persisted. */
function TokenProbe() {
  const { deviceToken } = useHubDevice();
  return <Text testID="device-token-probe">{deviceToken ?? 'none'}</Text>;
}

/** A tappable that signs the organizer in through the real context seam. */
function SignIn() {
  const { signIn } = useOrganizer();
  return <Text testID="sign-in" onPress={() => void signIn()} />;
}

function withProviders(children: ReactNode, householdId: string | null = 'hh-1') {
  return (
    <OrganizerProvider authProvider={fakeProvider()}>
      <HouseholdProvider initialHouseholdId={householdId}>
        <HubDeviceProvider>{children}</HubDeviceProvider>
      </HouseholdProvider>
    </OrganizerProvider>
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HubPairing', () => {
  it('is hidden without a signed-in organizer', async () => {
    useApiClientMock.mockReturnValue(
      pairingClient({ ok: true, status: 200, data: PAIRING, etag: null }).client,
    );

    // No OrganizerProvider override -> the participant-only default (signed out).
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HubDeviceProvider>
          <HubPairing />
        </HubDeviceProvider>
      </HouseholdProvider>,
    );

    expect(screen.queryByTestId('hub-pairing')).toBeNull();
    expect(screen.queryByTestId('hub-pairing-button')).toBeNull();
  });

  it('calls the pair endpoint and stores the returned device token', async () => {
    const { client, update } = pairingClient({ ok: true, status: 200, data: PAIRING, etag: null });
    useApiClientMock.mockReturnValue(client);

    await render(
      withProviders(
        <>
          <SignIn />
          <HubPairing />
          <TokenProbe />
        </>,
      ),
    );

    // Not signed in yet: affordance hidden, token unset.
    expect(screen.queryByTestId('hub-pairing-button')).toBeNull();
    expect(screen.getByTestId('device-token-probe')).toHaveTextContent('none');

    await press('sign-in');

    // Now visible; tapping it calls the organizer-gated pair endpoint.
    const button = await screen.findByTestId('hub-pairing-button');
    expect(button).toBeOnTheScreen();

    await press('hub-pairing-button');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      '/households/hh-1/hub-devices/pair',
      { deviceName: 'This tablet' },
      { method: 'POST' },
    );

    // The returned token is stored for the hub's subsequent use.
    await waitFor(() =>
      expect(screen.getByTestId('device-token-probe')).toHaveTextContent('device-token-xyz'),
    );
    expect(screen.getByTestId('hub-pairing-button')).toHaveTextContent('Tablet paired');
  });

  it('reads as already paired when a device token is present', async () => {
    const { client, update } = pairingClient({ ok: true, status: 200, data: PAIRING, etag: null });
    useApiClientMock.mockReturnValue(client);

    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <HouseholdProvider initialHouseholdId="hh-1">
          <HubDeviceProvider initialDeviceToken="already-paired">
            <SignIn />
            <HubPairing />
          </HubDeviceProvider>
        </HouseholdProvider>
      </OrganizerProvider>,
    );

    await press('sign-in');

    // The prior pairing is reflected without any further call.
    const button = await screen.findByTestId('hub-pairing-button');
    expect(button).toHaveTextContent('Tablet paired');
    expect(update).not.toHaveBeenCalled();
  });

  it('surfaces a pairing failure without storing a token', async () => {
    const { client } = pairingClient({
      ok: false,
      error: { kind: 'http', status: 403, title: 'Forbidden' },
    });
    useApiClientMock.mockReturnValue(client);

    await render(
      withProviders(
        <>
          <SignIn />
          <HubPairing />
          <TokenProbe />
        </>,
      ),
    );

    await press('sign-in');
    await press('hub-pairing-button');

    await waitFor(() => expect(screen.getByTestId('hub-pairing-error')).toBeOnTheScreen());
    expect(screen.getByTestId('device-token-probe')).toHaveTextContent('none');
  });

  it('refuses to pair before a household is set up', async () => {
    const { client, update } = pairingClient({ ok: true, status: 200, data: PAIRING, etag: null });
    useApiClientMock.mockReturnValue(client);

    await render(
      withProviders(
        <>
          <SignIn />
          <HubPairing />
        </>,
        null,
      ),
    );

    await press('sign-in');
    await press('hub-pairing-button');

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId('hub-pairing-error')).toBeOnTheScreen();
  });
});
