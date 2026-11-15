import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { YOUR_DATA_COPY, YourDataScreen } from './YourDataScreen';
import type { IAuthProvider } from '../auth/authProvider';
import { OrganizerBar } from '../auth/OrganizerBar';
import { typeScale } from '../theme/theme';
import { OrganizerProvider } from '../state/OrganizerContext';

const organizerAuth: IAuthProvider = {
  kind: 'fake',
  signIn: () =>
    Promise.resolve({ organizer: { subject: 'oid-1', name: 'Robin Organizer' }, token: 'bearer' }),
  signOut: () => Promise.resolve(),
};

/** Render the page beside an organizer bar under one organizer session. */
async function renderWithOrganizer(onOpenTeardown?: () => void) {
  await render(
    <OrganizerProvider authProvider={organizerAuth}>
      <OrganizerBar />
      <YourDataScreen onOpenTeardown={onOpenTeardown} />
    </OrganizerProvider>,
  );
}

async function signIn() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('organizer-sign-in'));
  });
}

/** Every table registered with AddTableRepository on main, with its plain label. */
const REGISTERED_TABLES: readonly [string, string][] = [
  ['Households', 'Households'],
  ['People', 'People'],
  ['Rooms', 'Rooms'],
  ['Chores', 'Chores'],
  ['Assignments', 'Assignments'],
  ['ChoreCompletions', 'Chore completions'],
  ['Carts', 'Carts'],
  ['CartItems', 'Cart items'],
  ['HubDevices', 'Hub devices'],
  ['Events', 'Usage events'],
  ['Datasets', 'Install marker'],
];

describe('YourDataScreen (#125)', () => {
  it('renders the heading and intro', async () => {
    await render(<YourDataScreen />);

    expect(screen.getByTestId('your-data-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Your data' })).toBeOnTheScreen();
    expect(screen.getByText(/what Butler keeps, where it keeps it/)).toBeOnTheScreen();
  });

  it('lists every registered table in plain words (AC3)', async () => {
    await render(<YourDataScreen />);

    const stored = screen.getByTestId('your-data-stored');
    expect(within(stored).getByRole('header', { name: 'What Butler stores' })).toBeOnTheScreen();
    for (const [table, label] of REGISTERED_TABLES) {
      const row = within(stored).getByTestId(`your-data-table-${table}`);
      expect(within(row).getByText(label)).toBeOnTheScreen();
    }
    expect(YOUR_DATA_COPY.stored.tables.map((row) => row.table)).toEqual(
      REGISTERED_TABLES.map(([table]) => table),
    );
    expect(within(stored).getByText(/keeps working offline/)).toBeOnTheScreen();
  });

  it('lists usage events as stored now that #122 registered the Events table (AC4)', async () => {
    await render(<YourDataScreen />);

    const stored = screen.getByTestId('your-data-stored');
    const events = within(stored).getByTestId('your-data-table-Events');
    expect(events).toHaveTextContent(/Usage events/);
    expect(events).toHaveTextContent(/ids only, never a name or anything said/);
    expect(screen.queryByText(/planned/i)).toBeNull();
  });

  it('says a child profile holds only a first name, a child flag, and a claim colour (AC5)', async () => {
    await render(<YourDataScreen />);

    const kids = screen.getByTestId('your-data-kids');
    expect(within(kids).getByRole('header', { name: "Kids' profiles" })).toBeOnTheScreen();
    expect(
      within(kids).getByText(
        "A child's profile holds only a first name, a child flag, and a claim colour.",
      ),
    ).toBeOnTheScreen();
    expect(within(kids).getByText(/they never sign in/)).toBeOnTheScreen();
  });

  it('says the demo runs locally and no household data leaves the home (AC6)', async () => {
    await render(<YourDataScreen />);

    const local = screen.getByTestId('your-data-local');
    expect(within(local).getByText(/runs locally, on the organizer's computer/)).toBeOnTheScreen();
    expect(within(local).getByText(/No household data leaves the home/)).toBeOnTheScreen();
  });

  it('explains how an organizer deletes the household and that it removes all its data (AC7)', async () => {
    await render(<YourDataScreen />);

    const deletion = screen.getByTestId('your-data-delete');
    expect(
      within(deletion).getByRole('header', { name: 'Deleting everything' }),
    ).toBeOnTheScreen();
    expect(within(deletion).getByText(/Delete household/)).toBeOnTheScreen();
    expect(within(deletion).getByText(/type the household's name exactly/)).toBeOnTheScreen();
    expect(within(deletion).getByText(/removes all of the household's data/)).toBeOnTheScreen();
    expect(within(deletion).getByText('It cannot be undone.')).toBeOnTheScreen();
  });

  it('keeps every copy string plain ASCII (AC8)', async () => {
    await render(<YourDataScreen />);

    // eslint-disable-next-line no-control-regex
    expect(JSON.stringify(YOUR_DATA_COPY)).toMatch(/^[\x00-\x7F]*$/);
    // eslint-disable-next-line no-control-regex
    expect(JSON.stringify(screen.toJSON())).toMatch(/^[\x00-\x7F]*$/);
  });

  it('sets the page text at or above the body size (ADR-0004)', async () => {
    await render(<YourDataScreen />);

    const detail = screen.getByText(YOUR_DATA_COPY.stored.onTablet);
    expect(StyleSheet.flatten(detail.props.style).fontSize).toBeGreaterThanOrEqual(typeScale.body);
  });

  describe('Delete household link (#168 AC12)', () => {
    it('shows the Delete household link to a signed-in organizer and calls onOpenTeardown', async () => {
      const onOpenTeardown = jest.fn();
      await renderWithOrganizer(onOpenTeardown);
      await signIn();

      const deletion = screen.getByTestId('your-data-delete');
      const link = within(deletion).getByTestId('your-data-teardown-link');
      expect(link).toHaveTextContent(YOUR_DATA_COPY.deletion.link);
      await act(async () => {
        fireEvent.press(link);
      });

      expect(onOpenTeardown).toHaveBeenCalledTimes(1);
    });

    it('hides the link without an organizer', async () => {
      await renderWithOrganizer(jest.fn());

      expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
      expect(screen.queryByTestId('your-data-teardown-link')).toBeNull();
    });

    it('hides the link without onOpenTeardown', async () => {
      await renderWithOrganizer();
      await signIn();

      expect(screen.getByTestId('organizer-identity')).toBeOnTheScreen();
      expect(screen.queryByTestId('your-data-teardown-link')).toBeNull();
    });
  });
});
