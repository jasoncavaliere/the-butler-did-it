import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { OrganizerBar } from './OrganizerBar';
import type { IAuthProvider, OrganizerSession } from './authProvider';
import { PinSignInError } from './pinAuthProvider';
import { OrganizerProvider } from '../state/OrganizerContext';

const SESSION: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin Organizer' },
  token: 'bearer-abc',
};

function fakeProvider(overrides: Partial<IAuthProvider> = {}): IAuthProvider {
  return {
    kind: 'fake',
    signIn: overrides.signIn ?? (() => Promise.resolve(SESSION)),
    signOut: overrides.signOut ?? (() => Promise.resolve()),
  };
}

const SENSITIVE = [
  'affordance-edit-household',
  'affordance-edit-roster',
  'affordance-confirm-order',
  'affordance-household-teardown',
];

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('OrganizerBar', () => {
  it('gated-affordance-hidden-without-organizer: only sign-in shows, no sensitive actions', async () => {
    await render(<OrganizerBar />);

    expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
    for (const id of SENSITIVE) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByTestId('organizer-sign-out')).toBeNull();
  });

  it('gated-affordance-shown-with-organizer: sensitive actions appear once signed in', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar
          onEditHousehold={jest.fn()}
          onEditRoster={jest.fn()}
          onConfirmOrder={jest.fn()}
          onHouseholdTeardown={jest.fn()}
        />
      </OrganizerProvider>,
    );

    // Not signed in yet: sensitive actions absent.
    expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();

    await press('organizer-sign-in');

    expect(screen.getByTestId('organizer-identity')).toHaveTextContent('Robin Organizer');
    for (const id of SENSITIVE) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
    }
    expect(screen.getByTestId('organizer-sign-out')).toBeOnTheScreen();
    expect(screen.queryByTestId('organizer-sign-in')).toBeNull();
  });

  it('sign-out-clears-organizer: affordances disappear after signing out', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar
          onEditHousehold={jest.fn()}
          onEditRoster={jest.fn()}
          onConfirmOrder={jest.fn()}
          onHouseholdTeardown={jest.fn()}
        />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');
    expect(screen.getByTestId('affordance-edit-roster')).toBeOnTheScreen();

    await press('organizer-sign-out');

    for (const id of SENSITIVE) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
  });

  it('hides the Household button when no organizer is signed in', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar onEditHousehold={jest.fn()} />
      </OrganizerProvider>,
    );

    expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
    expect(screen.queryByTestId('affordance-edit-household')).toBeNull();
  });

  it('shows the Household button for a signed-in organizer and calls onEditHousehold', async () => {
    const onEditHousehold = jest.fn();
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar onEditHousehold={onEditHousehold} />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');

    expect(screen.getByTestId('affordance-edit-household')).toHaveTextContent('Household');
    expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();

    await press('affordance-edit-household');
    expect(onEditHousehold).toHaveBeenCalledTimes(1);
  });

  it('invokes the affordance handlers when a signed-in organizer taps them', async () => {
    const onEditRoster = jest.fn();
    const onConfirmOrder = jest.fn();
    const onHouseholdTeardown = jest.fn();

    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar
          onEditRoster={onEditRoster}
          onConfirmOrder={onConfirmOrder}
          onHouseholdTeardown={onHouseholdTeardown}
        />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');
    await press('affordance-edit-roster');
    await press('affordance-confirm-order');
    await press('affordance-household-teardown');

    expect(onEditRoster).toHaveBeenCalledTimes(1);
    expect(onConfirmOrder).toHaveBeenCalledTimes(1);
    expect(onHouseholdTeardown).toHaveBeenCalledTimes(1);
  });

  it('renders no sensitive-action button whose handler is not supplied', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');

    // Signed in, but no handler wired: no button that would do nothing.
    for (const id of SENSITIVE) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen();
    expect(screen.getByTestId('organizer-sign-out')).toBeOnTheScreen();
  });

  it('renders only the sensitive actions whose handlers are supplied', async () => {
    const onConfirmOrder = jest.fn();

    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar onConfirmOrder={onConfirmOrder} />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');

    expect(screen.getByTestId('affordance-confirm-order')).toBeOnTheScreen();
    expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();
    expect(screen.queryByTestId('affordance-household-teardown')).toBeNull();

    await press('affordance-confirm-order');
    expect(onConfirmOrder).toHaveBeenCalledTimes(1);
  });

  it('renders each sensitive action independently of the others', async () => {
    const onEditRoster = jest.fn();
    const onHouseholdTeardown = jest.fn();

    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar onEditRoster={onEditRoster} onHouseholdTeardown={onHouseholdTeardown} />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');

    expect(screen.getByTestId('affordance-edit-roster')).toBeOnTheScreen();
    expect(screen.getByTestId('affordance-household-teardown')).toBeOnTheScreen();
    expect(screen.queryByTestId('affordance-confirm-order')).toBeNull();
  });

  describe('with the demo PIN provider (#105)', () => {
    function pinProvider(overrides: Partial<IAuthProvider> = {}): IAuthProvider {
      return { ...fakeProvider(overrides), kind: 'pin' };
    }

    async function signInWithPin(pin: string) {
      await press('organizer-sign-in');
      for (const digit of pin) {
        await press(`pin-digit-${digit}`);
      }
      await press('pin-submit');
    }

    it('pin provider: renders no sensitive actions until signed in through the PIN pad', async () => {
      const signIn = jest.fn(() => Promise.resolve(SESSION));
      await render(
        <OrganizerProvider authProvider={pinProvider({ signIn })}>
          <OrganizerBar
            onEditHousehold={jest.fn()}
            onEditRoster={jest.fn()}
            onConfirmOrder={jest.fn()}
            onHouseholdTeardown={jest.fn()}
          />
        </OrganizerProvider>,
      );

      expect(screen.queryByTestId('organizer-pin-pad')).toBeNull();
      await press('organizer-sign-in');
      expect(screen.getByTestId('organizer-pin-pad')).toBeOnTheScreen();
      expect(signIn).not.toHaveBeenCalled();
      for (const id of SENSITIVE) {
        expect(screen.queryByTestId(id)).toBeNull();
      }

      for (const digit of '2468') {
        await press(`pin-digit-${digit}`);
      }
      await press('pin-submit');

      expect(signIn).toHaveBeenCalledWith({ pin: '2468' });
      expect(screen.queryByTestId('organizer-pin-pad')).toBeNull();
      for (const id of SENSITIVE) {
        expect(screen.getByTestId(id)).toBeOnTheScreen();
      }
    });

    it('pin provider: a wrong PIN keeps the pad open and the actions hidden', async () => {
      await render(
        <OrganizerProvider
          authProvider={pinProvider({ signIn: () => Promise.reject(new PinSignInError('invalid', 'no')) })}
        >
          <OrganizerBar onEditRoster={jest.fn()} />
        </OrganizerProvider>,
      );

      await signInWithPin('1111');

      expect(screen.getByTestId('pin-error')).toHaveTextContent('That PIN is not right.');
      expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();
    });

    it('pin provider: the sign-in button and Cancel close the pad', async () => {
      await render(
        <OrganizerProvider authProvider={pinProvider()}>
          <OrganizerBar />
        </OrganizerProvider>,
      );

      await press('organizer-sign-in');
      await press('organizer-sign-in');
      expect(screen.queryByTestId('organizer-pin-pad')).toBeNull();

      await press('organizer-sign-in');
      await press('pin-cancel');
      expect(screen.queryByTestId('organizer-pin-pad')).toBeNull();
    });

    it('pin provider: signing out returns to participant-only', async () => {
      const signOut = jest.fn(() => Promise.resolve());
      await render(
        <OrganizerProvider authProvider={pinProvider({ signOut })}>
          <OrganizerBar onEditRoster={jest.fn()} />
        </OrganizerProvider>,
      );
      await signInWithPin('2468');
      expect(screen.getByTestId('affordance-edit-roster')).toBeOnTheScreen();

      await press('organizer-sign-out');

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('affordance-edit-roster')).toBeNull();
      expect(screen.queryByTestId('organizer-identity')).toBeNull();
      expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
      expect(screen.queryByTestId('organizer-pin-pad')).toBeNull();
    });
  });
});
