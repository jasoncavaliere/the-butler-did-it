/**
 * The hub's hidden organizer menu (#131): a 3 s hold on the household name
 * shows the organizer PIN pad, and only a successful sign-in opens the menu.
 * The menu's own status rows and confirmations are covered by
 * HiddenOrganizerMenu.test.tsx; these tests cover the gesture, the PIN gate,
 * and the two actions the hub itself carries out (clear cache, sign out).
 */
import { fireEvent, render, screen, userEvent, waitFor, within } from '@testing-library/react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import { PING_PATH } from '../api/ping';
import { useApiClient } from '../api/useApiClient';
import { VERSION_PATH } from '../api/version';
import type { IAuthProvider, OrganizerSession, SignInCredentials } from '../auth/authProvider';
import { PinSignInError } from '../auth/pinAuthProvider';
import { HIDDEN_MENU_HOLD_MS } from '../components/HiddenOrganizerMenu';
import { forgetHouseholdOffline } from '../offline/forgetHousehold';
import { resetSessionFallbackStorage } from '../offline/storage';
import { currentWeekIso } from '../offline/weekIso';
import { assignmentDedupeKey, readWriteQueue, saveWriteQueue, type QueuedWrite } from '../offline/writeQueue';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));
// The real function, wrapped so a test can see the hub called it.
jest.mock('../offline/forgetHousehold', () => {
  const actual = jest.requireActual<typeof import('../offline/forgetHousehold')>('../offline/forgetHousehold');
  return { forgetHouseholdOffline: jest.fn(actual.forgetHouseholdOffline) };
});

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;
const forgetMock = forgetHouseholdOffline as jest.MockedFunction<typeof forgetHouseholdOffline>;

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });

const okHousehold = ok({ householdId: 'hh-1', name: 'The Riveras' });
const okPeople = ok([{ personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false }]);
const okCart = ok({
  weekIso: '2026-W29',
  status: 'Building',
  confirmedByPersonId: null,
  confirmedUtc: null,
  eTag: 'W/"cart-1"',
  items: [],
  estimatedTotal: 0,
  customItemCount: 0,
});

/** A client that answers every hub read calmly, plus the menu's ping and version reads. */
function clientWith(): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === DATASET_PATH) {
        return ok({ datasetId: 'ds-1' });
      }
      if (path === PING_PATH) {
        return ok({ status: 'ok', service: 'Butler.Api', timestampUtc: '2026-11-15T10:00:00Z' });
      }
      if (path === VERSION_PATH) {
        return ok({ sha: 'api1234', buildTime: null });
      }
      if (path.includes('/chores')) {
        return ok([]);
      }
      if (path.includes('/carts/')) {
        return okCart;
      }
      // The board's lazy week read (#110): an empty set for the week it asked for.
      const week = /\/assignments\/(\d{4}-W\d{2})$/.exec(path)?.[1];
      if (week !== undefined) {
        return ok({ weekIso: week, currentWeekIso: week, assignments: [], unassigned: [] });
      }
      return path.endsWith('/people') ? okPeople : okHousehold;
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (): Promise<ApiResult<unknown>> => ok(null)) as unknown as ApiClient['update'],
  };
}

const PIN = '2468';
const ORGANIZER: OrganizerSession = {
  organizer: { subject: 'oid-1', name: 'Robin Organizer' },
  token: 'bearer-abc',
};

/** A PIN provider (#105) through the real IAuthProvider seam: only {@link PIN} signs in. */
function pinProvider(): IAuthProvider {
  return {
    kind: 'pin',
    signIn: jest.fn(async (credentials?: SignInCredentials) => {
      if (credentials?.pin !== PIN) {
        throw new PinSignInError('invalid', 'That PIN is not right.');
      }
      return ORGANIZER;
    }),
    signOut: jest.fn(async () => undefined),
  };
}

async function renderHub(provider: IAuthProvider = pinProvider()) {
  useApiClientMock.mockReturnValue(clientWith());
  await render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <OrganizerProvider authProvider={provider}>
        <HubShell />
      </OrganizerProvider>
    </HouseholdProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Riveras'));
  return provider;
}

function setupUser() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
}

async function holdName(durationMs: number) {
  await setupUser().longPress(screen.getByTestId('hub-household-name'), { duration: durationMs });
}

/** Type `pin` into the hidden menu's PIN pad and submit it. */
async function enterPin(pin: string) {
  const pad = within(screen.getByTestId('hub-hidden-menu-pin'));
  for (const digit of pin) {
    await fireEvent.press(pad.getByTestId(`pin-digit-${digit}`));
  }
  await fireEvent.press(pad.getByTestId('pin-submit'));
}

/** Hold the name for 3 s and sign in with the right PIN. */
async function openMenu() {
  await holdName(HIDDEN_MENU_HOLD_MS + 100);
  await enterPin(PIN);
  await waitFor(() => expect(screen.getByTestId('hub-hidden-menu')).toBeOnTheScreen());
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  useApiClientMock.mockReset();
  forgetMock.mockClear();
  jest.useRealTimers();
  resetSessionFallbackStorage();
});

describe('HubShell hidden organizer menu (#131)', () => {
  it('keeps the household name a header with its own testID inside the hold target', async () => {
    await renderHub();

    const name = screen.getByTestId('hub-household-name');
    expect(name.props.accessibilityRole).toBe('header');
    const hold = screen.getByTestId('hub-household-name-hold');
    expect(within(hold).getByTestId('hub-household-name')).toBe(name);
  });

  it('shows the organizer PIN prompt after a 3 s hold on the household name (AC1)', async () => {
    await renderHub();

    await holdName(HIDDEN_MENU_HOLD_MS + 100);

    const prompt = screen.getByTestId('hub-hidden-menu-pin');
    expect(within(prompt).getByTestId('pin-pad')).toBeOnTheScreen();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
  });

  it('shows no PIN prompt and no menu when the press is released before 3 s (AC2)', async () => {
    await renderHub();

    await holdName(HIDDEN_MENU_HOLD_MS - 500);
    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();

    await setupUser().press(screen.getByTestId('hub-household-name'));
    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
    expect(screen.queryByTestId('pin-pad')).toBeNull();
  });

  it('keeps the hidden menu closed on a wrong PIN (AC3)', async () => {
    await renderHub();
    await holdName(HIDDEN_MENU_HOLD_MS + 100);

    await enterPin('1111');

    const prompt = within(screen.getByTestId('hub-hidden-menu-pin'));
    await waitFor(() => expect(prompt.getByTestId('pin-error')).toHaveTextContent('That PIN is not right.'));
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
  });

  it('closes the PIN prompt on Cancel without opening the menu', async () => {
    await renderHub();
    await holdName(HIDDEN_MENU_HOLD_MS + 100);

    await fireEvent.press(within(screen.getByTestId('hub-hidden-menu-pin')).getByTestId('pin-cancel'));

    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
  });

  it('opens the hidden menu on the correct PIN (AC4)', async () => {
    await renderHub();

    await openMenu();

    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
    const menu = within(screen.getByTestId('hub-hidden-menu'));
    expect(menu.getByTestId('hidden-menu-api-url')).toHaveTextContent('http://api.test:1');
    await waitFor(() => expect(menu.getByTestId('hidden-menu-ping')).toHaveTextContent('OK'));
    await waitFor(() => expect(menu.getByTestId('hidden-menu-dataset')).toHaveTextContent('ds-1'));
    expect(menu.getByTestId('version-info')).toBeOnTheScreen();
  });

  it('asks for the PIN again even when an organizer is already signed in (AC1)', async () => {
    await renderHub();
    await openMenu();
    await fireEvent.press(screen.getByTestId('hidden-menu-close'));
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
    expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen();

    await holdName(HIDDEN_MENU_HOLD_MS + 100);

    expect(screen.getByTestId('hub-hidden-menu-pin')).toBeOnTheScreen();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
  });

  it('opens the menu through a non-PIN provider sign-in (AC4)', async () => {
    const provider: IAuthProvider = {
      kind: 'dev',
      signIn: jest.fn(async () => ORGANIZER),
      signOut: jest.fn(async () => undefined),
    };
    await renderHub(provider);

    await holdName(HIDDEN_MENU_HOLD_MS + 100);

    await waitFor(() => expect(screen.getByTestId('hub-hidden-menu')).toBeOnTheScreen());
    expect(provider.signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
  });

  it('keeps the menu closed when a non-PIN sign-in is refused or signs no one in', async () => {
    const provider: IAuthProvider = {
      kind: 'entra',
      signIn: jest
        .fn<Promise<OrganizerSession | null>, [SignInCredentials?]>()
        .mockRejectedValueOnce(new Error('cancelled'))
        .mockResolvedValueOnce(null),
      signOut: jest.fn(async () => undefined),
    };
    await renderHub(provider);

    await holdName(HIDDEN_MENU_HOLD_MS + 100);
    await waitFor(() => expect(provider.signIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();

    // A redirect in flight resolves with no session: still no menu.
    await holdName(HIDDEN_MENU_HOLD_MS + 100);
    await waitFor(() => expect(provider.signIn).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
    expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen();
  });

  it('closes when the organizer signs out from the bar and stays closed on the next bar sign-in (AC4)', async () => {
    await renderHub();
    await openMenu();

    await fireEvent.press(screen.getByTestId('organizer-sign-out'));
    await waitFor(() => expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen());
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();

    // Sign in again from the bar's own PIN pad: the hidden menu must not come back.
    await fireEvent.press(screen.getByTestId('organizer-sign-in'));
    const barPad = within(screen.getByTestId('organizer-pin-pad'));
    for (const digit of PIN) {
      await fireEvent.press(barPad.getByTestId(`pin-digit-${digit}`));
    }
    await fireEvent.press(barPad.getByTestId('pin-submit'));
    await waitFor(() => expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen());
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
  });

  it('clears the local cache and remounts with an empty queue (AC10)', async () => {
    const failed: QueuedWrite = {
      kind: 'chore-complete',
      dedupeKey: assignmentDedupeKey(currentWeekIso(), 'c1'),
      method: 'POST',
      path: `/households/hh-1/assignments/${currentWeekIso()}/c1/complete`,
      body: { personId: 'p1' },
      enqueuedAtMs: 1,
      attempts: 5,
      status: 'failed',
      lastError: 'Refused.',
    };
    saveWriteQueue('hh-1', [failed]);
    await renderHub();
    await waitFor(() => expect(screen.getByTestId('sync-indicator-failed')).toBeOnTheScreen());
    await openMenu();

    await fireEvent.press(screen.getByTestId('hidden-menu-clear-cache'));
    expect(forgetMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

    expect(forgetMock).toHaveBeenCalledTimes(1);
    expect(forgetMock).toHaveBeenCalledWith('hh-1');
    expect(readWriteQueue('hh-1')).toEqual([]);
    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Riveras'));
    expect(screen.queryByTestId('sync-indicator-failed')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
    // The organizer session lives above the body, so it survives the remount.
    expect(screen.getByTestId('organizer-actions')).toBeOnTheScreen();
  });

  it('signs the organizer out and returns to participant-only mode (AC11)', async () => {
    const provider = await renderHub();
    await openMenu();

    await fireEvent.press(screen.getByTestId('hidden-menu-sign-out'));
    expect(provider.signOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

    await waitFor(() => expect(screen.getByTestId('organizer-sign-in')).toBeOnTheScreen());
    expect(provider.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('organizer-actions')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu')).toBeNull();
    expect(screen.queryByTestId('hub-hidden-menu-pin')).toBeNull();
  });
});
