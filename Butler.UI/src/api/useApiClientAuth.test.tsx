import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { useApiClient } from './useApiClient';
import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';
import { HubDeviceProvider } from '../state/HubDeviceContext';
import { OrganizerProvider, useOrganizer } from '../state/OrganizerContext';

const SESSION: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin' },
  token: 'bearer-abc',
};

const provider: IAuthProvider = {
  kind: 'fake',
  signIn: () => Promise.resolve(SESSION),
  signOut: () => Promise.resolve(),
};

function Probe() {
  const client = useApiClient();
  const { signIn, signOut } = useOrganizer();
  return (
    <>
      <Pressable testID="in" onPress={() => void signIn()}>
        <Text>in</Text>
      </Pressable>
      <Pressable testID="out" onPress={() => void signOut()}>
        <Text>out</Text>
      </Pressable>
      <Pressable testID="call" onPress={() => void client.get('/me')}>
        <Text>call</Text>
      </Pressable>
    </>
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('useApiClient token threading (T4)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => '',
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function lastAuthHeader(): string | undefined {
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return (init.headers as Record<string, string>).Authorization;
  }

  it('sends no bearer before sign-in, the organizer token after, and none after sign-out', async () => {
    await render(
      <OrganizerProvider authProvider={provider}>
        <Probe />
      </OrganizerProvider>,
    );

    await press('call');
    expect(lastAuthHeader()).toBeUndefined();

    await press('in');
    await press('call');
    expect(lastAuthHeader()).toBe('Bearer bearer-abc');

    await press('out');
    await press('call');
    expect(lastAuthHeader()).toBeUndefined();
  });

  it('falls back to the paired hub-device token when no organizer is signed in (T5)', async () => {
    await render(
      <OrganizerProvider authProvider={provider}>
        <HubDeviceProvider initialDeviceToken="device-xyz">
          <Probe />
        </HubDeviceProvider>
      </OrganizerProvider>,
    );

    // No organizer signed in - the always-on tablet's normal state - so the
    // hub-device token authenticates the request instead of going out anonymous.
    await press('call');
    expect(lastAuthHeader()).toBe('Bearer device-xyz');
  });

  it('prefers the organizer token over the device token when both are present', async () => {
    await render(
      <OrganizerProvider authProvider={provider}>
        <HubDeviceProvider initialDeviceToken="device-xyz">
          <Probe />
        </HubDeviceProvider>
      </OrganizerProvider>,
    );

    await press('in');
    await press('call');
    expect(lastAuthHeader()).toBe('Bearer bearer-abc');

    // Signing out drops back to the device token rather than to anonymous.
    await press('out');
    await press('call');
    expect(lastAuthHeader()).toBe('Bearer device-xyz');
  });
});
