import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { AppConfigProvider, defaultAppConfig } from './AppConfigContext';
import { OrganizerProvider, useOrganizer } from './OrganizerContext';
import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';

const ORGANIZER: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin Organizer' },
  token: 'bearer-abc',
};

/** A fake provider injected through the real IAuthProvider seam. */
function fakeProvider(overrides: Partial<IAuthProvider> = {}): IAuthProvider {
  return {
    kind: 'fake',
    signIn: overrides.signIn ?? (() => Promise.resolve(ORGANIZER)),
    signOut: overrides.signOut ?? (() => Promise.resolve()),
  };
}

function Probe() {
  const { organizer, token, isSignedIn, signIn, signOut, clearSession, providerKind } = useOrganizer();
  return (
    <>
      <Text testID="kind">{providerKind}</Text>
      <Pressable testID="do-pin-sign-in" onPress={() => void signIn({ pin: '2468' })}>
        <Text>pin</Text>
      </Pressable>
      <Pressable testID="do-clear" onPress={() => clearSession()}>
        <Text>clear</Text>
      </Pressable>
      <Text testID="who">{organizer ? organizer.name : 'none'}</Text>
      <Text testID="token">{token ?? 'no-token'}</Text>
      <Text testID="signed-in">{String(isSignedIn)}</Text>
      <Pressable testID="do-sign-in" onPress={() => void signIn()}>
        <Text>in</Text>
      </Pressable>
      <Pressable testID="do-sign-out" onPress={() => void signOut()}>
        <Text>out</Text>
      </Pressable>
    </>
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('OrganizerContext', () => {
  it('exposes the participant-only state to consumers outside a provider', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('who')).toHaveTextContent('none');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
    // The no-op sign-in/out/clear must not throw when there is no provider.
    expect(screen.getByTestId('kind')).toHaveTextContent('dev');
    await press('do-sign-in');
    await press('do-sign-out');
    await press('do-clear');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
  });

  it('signs in through the injected provider and exposes identity + token', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <Probe />
      </OrganizerProvider>,
    );

    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
    await press('do-sign-in');

    expect(screen.getByTestId('who')).toHaveTextContent('Robin Organizer');
    expect(screen.getByTestId('token')).toHaveTextContent('bearer-abc');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true');
  });

  it('leaves state unchanged when sign-in returns null (redirect in flight)', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider({ signIn: () => Promise.resolve(null) })}>
        <Probe />
      </OrganizerProvider>,
    );

    await press('do-sign-in');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
    expect(screen.getByTestId('who')).toHaveTextContent('none');
  });

  it('sign-out clears the organizer and calls the provider', async () => {
    const signOut = jest.fn(() => Promise.resolve());
    await render(
      <OrganizerProvider authProvider={fakeProvider({ signOut })}>
        <Probe />
      </OrganizerProvider>,
    );

    await press('do-sign-in');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true');

    await press('do-sign-out');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
  });

  it('defaults to the config-selected provider (dev organizer) when none is injected', async () => {
    // No authProvider prop: the provider is built from the app config, which is
    // dev mode in the test env, so signing in yields the dev organizer.
    await render(
      <OrganizerProvider>
        <Probe />
      </OrganizerProvider>,
    );

    await press('do-sign-in');
    expect(screen.getByTestId('who')).toHaveTextContent('Development Organizer');
    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true');
  });

  it('passes sign-in credentials through and exposes the provider kind (#105)', async () => {
    const signIn = jest.fn(() => Promise.resolve(ORGANIZER));
    await render(
      <OrganizerProvider authProvider={{ ...fakeProvider({ signIn }), kind: 'pin' }}>
        <Probe />
      </OrganizerProvider>,
    );

    expect(screen.getByTestId('kind')).toHaveTextContent('pin');
    await press('do-pin-sign-in');

    expect(signIn).toHaveBeenCalledWith({ pin: '2468' });
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true');
  });

  it('clearSession drops the organizer locally without calling the provider (#105)', async () => {
    const signOut = jest.fn(() => Promise.resolve());
    await render(
      <OrganizerProvider authProvider={fakeProvider({ signOut })}>
        <Probe />
      </OrganizerProvider>,
    );

    await press('do-sign-in');
    await press('do-clear');

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false');
    expect(screen.getByTestId('token')).toHaveTextContent('no-token');
  });

  it('builds the PIN provider from the app config when it selects pin (#105)', async () => {
    const config = {
      ...defaultAppConfig,
      apiBaseUrl: 'https://api.test',
      auth: { ...defaultAppConfig.auth, provider: 'pin' as const, disableAuthentication: false },
    };
    await render(
      <AppConfigProvider value={config}>
        <OrganizerProvider>
          <Probe />
        </OrganizerProvider>
      </AppConfigProvider>,
    );

    expect(screen.getByTestId('kind')).toHaveTextContent('pin');
  });
});
