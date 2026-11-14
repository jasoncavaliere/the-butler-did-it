import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PinPad, pinErrorMessage } from './PinPad';
import type { IAuthProvider, OrganizerSession, SignInCredentials } from './authProvider';
import { PinSignInError } from './pinAuthProvider';
import { OrganizerProvider, useOrganizer } from '../state/OrganizerContext';

const SESSION: OrganizerSession = {
  organizer: { subject: 'dev-organizer', name: 'Demo Organizer' },
  token: 'tok-1',
};

function pinProvider(signIn: (credentials?: SignInCredentials) => Promise<OrganizerSession | null>): IAuthProvider {
  return { kind: 'pin', signIn, signOut: () => Promise.resolve() };
}

function Who() {
  const { organizer } = useOrganizer();
  return <Text testID="who">{organizer?.name ?? 'nobody'}</Text>;
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function type(pin: string) {
  for (const digit of pin) {
    await press(`pin-digit-${digit}`);
  }
}

async function renderPad(
  signIn: (credentials?: SignInCredentials) => Promise<OrganizerSession | null>,
  props: Parameters<typeof PinPad>[0] = {},
) {
  await render(
    <OrganizerProvider authProvider={pinProvider(signIn)}>
      <PinPad {...props} />
      <Who />
    </OrganizerProvider>,
  );
}

describe('PinPad (#105)', () => {
  it('masks the entry, enables submit only at 4-6 digits, and caps at 6', async () => {
    await renderPad(jest.fn());

    expect(screen.getByTestId('pin-display')).toHaveTextContent('Enter PIN');
    expect(screen.getByTestId('pin-submit')).toBeDisabled();

    await type('123');
    expect(screen.getByTestId('pin-display')).toHaveTextContent('•••');
    expect(screen.getByTestId('pin-submit')).toBeDisabled();

    await type('4');
    expect(screen.getByTestId('pin-submit')).toBeEnabled();

    await type('5678');
    expect(screen.getByTestId('pin-display')).toHaveTextContent('•'.repeat(6));

    await press('pin-backspace');
    expect(screen.getByTestId('pin-display')).toHaveTextContent('•'.repeat(5));
    expect(screen.queryByTestId('pin-cancel')).toBeNull();
  });

  it('signs in with the typed PIN and calls onSignedIn', async () => {
    const signIn = jest.fn(async () => SESSION);
    const onSignedIn = jest.fn();
    await renderPad(signIn, { onSignedIn });

    await type('2468');
    await press('pin-submit');

    expect(signIn).toHaveBeenCalledWith({ pin: '2468' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('who')).toHaveTextContent('Demo Organizer');
    expect(screen.getByTestId('pin-display')).toHaveTextContent('Enter PIN');
  });

  it('signs in without an onSignedIn callback', async () => {
    await renderPad(jest.fn(async () => SESSION));

    await type('2468');
    await press('pin-submit');

    expect(screen.getByTestId('who')).toHaveTextContent('Demo Organizer');
  });

  it('shows "That PIN is not right." for a wrong PIN, clears the entry, and clears the error on the next digit', async () => {
    await renderPad(jest.fn(async () => Promise.reject(new PinSignInError('invalid', 'The PIN is not correct.'))));

    await type('1111');
    await press('pin-submit');

    expect(screen.getByTestId('pin-error')).toHaveTextContent('That PIN is not right.');
    expect(screen.getByTestId('pin-display')).toHaveTextContent('Enter PIN');
    expect(screen.getByTestId('who')).toHaveTextContent('nobody');

    await type('1');
    expect(screen.queryByTestId('pin-error')).toBeNull();
  });

  it('shows the lockout seconds when locked out', async () => {
    await renderPad(jest.fn(async () => Promise.reject(new PinSignInError('locked', 'Too many', 37))));

    await type('2468');
    await press('pin-submit');

    expect(screen.getByTestId('pin-error')).toHaveTextContent('Too many tries. Try again in 37 seconds.');
  });

  it('offers Cancel when given a handler', async () => {
    const onCancel = jest.fn();
    await renderPad(jest.fn(), { onCancel });

    await press('pin-cancel');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('pinErrorMessage', () => {
  it('maps each refusal to its message', () => {
    expect(pinErrorMessage(new PinSignInError('invalid', 'x'))).toBe('That PIN is not right.');
    expect(pinErrorMessage(new PinSignInError('locked', 'x', 60))).toBe('Too many tries. Try again in 60 seconds.');
    expect(pinErrorMessage(new PinSignInError('locked', 'x'))).toBe('Too many tries. Try again in a minute.');
    expect(pinErrorMessage(new PinSignInError('unavailable', 'The API is unreachable.'))).toBe(
      'The API is unreachable.',
    );
    expect(pinErrorMessage(new Error('boom'))).toBe('Sign-in failed. Please try again.');
  });
});
