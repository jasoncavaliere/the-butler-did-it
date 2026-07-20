import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { OrganizerBar } from './OrganizerBar';
import type { IAuthProvider, OrganizerSession } from './authProvider';
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
        <OrganizerBar />
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
        <OrganizerBar />
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

  it('defaults sensitive-action handlers to a safe no-op', async () => {
    await render(
      <OrganizerProvider authProvider={fakeProvider()}>
        <OrganizerBar />
      </OrganizerProvider>,
    );

    await press('organizer-sign-in');
    // Pressing with no handlers wired must not throw (the default no-op runs).
    for (const id of SENSITIVE) {
      await press(id);
    }
    expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen();
  });
});
