import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import type {
  AssignmentView,
  ChoreResponse,
  FairnessResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider } from '../auth/authProvider';
import {
  LANDSCAPE_COMPACT,
  LANDSCAPE_ROOMY,
  NATIVE_STACK_HEADER_HEIGHT,
  PORTRAIT,
  measureHubBoard,
  type HubLayout,
} from '../layout/hubLayout';
import { resetSessionFallbackStorage } from '../offline/storage';
import { hubTouchTarget, minTargetGap } from '../theme/theme';
import { currentWeekIso } from '../offline/weekIso';
import { HouseholdProvider } from '../state/HouseholdContext';
import { OrganizerProvider } from '../state/OrganizerContext';

/**
 * The hub's per-window layouts (#118): the shell rendered at the three named
 * tablet windows, checked against the layout constants and the fit model in
 * `src/layout/hubLayout.ts`.
 */

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx. Here it would add
// an extra POST (and, with the API down, an extra queued write) to every test.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type HostNode = {
  props: Record<string, unknown> & { testID?: string; style?: unknown };
  parent: HostNode | null;
  children: (HostNode | string)[];
};

const WEEK = currentWeekIso();
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, etag: null });

/** A 4-person household... */
const roster: RosterEntryResponse[] = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
  { personId: 'p2', displayName: 'Sam', claimColor: '#8A6410', isChild: true },
  { personId: 'p3', displayName: 'Jordan', claimColor: '#3F7A1E', isChild: false },
  { personId: 'p4', displayName: 'Riley', claimColor: '#2A5AD0', isChild: true },
];

/** ...with 8 chores due today, 2 each (#118 AC4/AC5). */
const chores: ChoreResponse[] = Array.from({ length: 8 }, (_, i) => ({
  choreId: `c${i + 1}`,
  title: `Chore ${i + 1}`,
  roomId: 'r1',
  cadence: 'Daily',
  effort: 1,
  minAge: null,
  active: true,
  eTag: `e${i + 1}`,
}));
const assignments: AssignmentView[] = chores.map((chore, i) => ({
  choreId: chore.choreId,
  assignedPersonId: roster[Math.floor(i / 2)].personId,
  effort: 1,
  status: 'Open',
}));

const emptyCart = {
  weekIso: WEEK,
  status: 'Building',
  confirmedByPersonId: null,
  confirmedUtc: null,
  eTag: 'W/"cart-1"',
  items: [],
  estimatedTotal: 0,
  customItemCount: 0,
};

/** An empty but successful fairness answer (#210 AC3: no auto-retry timer). */
const emptyFairness: FairnessResponse = {
  windowStartWeekIso: WEEK,
  windowEndWeekIso: WEEK,
  windowWeeks: 4,
  totalEffort: 0,
  topContributorPersonId: null,
  shares: [],
};

/**
 * A client that answers every read the hub makes, routed by path. Fairness
 * answers 500 unless `fairnessOk` is set; a failing region auto-retries on a
 * timer, which a call-count test must not race (#210).
 */
function hubClient({ fairnessOk = false }: { fairnessOk?: boolean } = {}): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === DATASET_PATH) {
        return ok({ datasetId: 'ds-1' });
      }
      if (path.includes('/chores')) {
        return ok(chores);
      }
      if (path.includes('/carts/')) {
        return ok(emptyCart);
      }
      if (path.includes('/fairness')) {
        if (fairnessOk) {
          return ok(emptyFairness);
        }
        return { ok: false, error: { kind: 'http', status: 500, title: 'Not in this test.' } };
      }
      if (path.endsWith('/people')) {
        return ok(roster);
      }
      // The board's lazy week read (#110), answered for the week it asked for.
      const week = /\/assignments\/(\d{4}-W\d{2})$/.exec(path)?.[1];
      if (week !== undefined) {
        return ok({ weekIso: week, currentWeekIso: week, assignments, unassigned: [] });
      }
      return ok({ householdId: 'hh-1', name: 'The Rivera Home' });
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (): Promise<ApiResult<unknown>> => ok(null)) as unknown as ApiClient['update'],
  };
}

function setWindow(width: number, height: number) {
  Dimensions.set({ window: { width, height, scale: 1, fontScale: 1 } });
}

async function renderHubAt(width: number, height: number) {
  setWindow(width, height);
  useApiClientMock.mockReturnValue(hubClient());
  await render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubShell />
    </HouseholdProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId(/^chore-item-c\d+$/)).toHaveLength(8));
}

function node(testID: string): HostNode {
  return screen.getByTestId(testID) as unknown as HostNode;
}

function styleOf(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(node(testID).props.style as never) ?? {}) as Record<string, unknown>;
}

function hostChildren(parent: HostNode): HostNode[] {
  return parent.children.filter((child): child is HostNode => typeof child !== 'string');
}

/** The direct host children of hub-shell, by testID. */
function shellZones(): (string | undefined)[] {
  return hostChildren(node('hub-shell')).map((child) => child.props.testID);
}

/** Rows rendered per person in the Today bucket, in roster order. */
function todayRowsByPerson(): number[] {
  return roster.map(
    (person) =>
      within(screen.getByTestId(`chore-board-person-today-${person.personId}`)).queryAllByTestId(
        /^chore-item-c\d+$/,
      ).length,
  );
}

/** The style values the rendered hub reads from the layout. */
function expectStylesFrom(layout: HubLayout) {
  expect(styleOf('hub-shell')).toMatchObject({ padding: layout.pagePadding, gap: layout.zoneGap });
  expect(styleOf('hub-chrome')).toMatchObject({ minHeight: layout.chromeHeight });
  expect(styleOf('hub-header')).toMatchObject({ minHeight: layout.headerHeight });
  expect(styleOf('hub-household-name')).toMatchObject({
    fontSize: layout.nameSize,
    lineHeight: layout.nameLineHeight,
  });
  expect(styleOf('hub-name-tiles')).toMatchObject({ minHeight: layout.tileHeight, gap: layout.tileGap });
  expect(styleOf('name-tile-p1')).toMatchObject({
    minHeight: layout.tileHeight,
    paddingVertical: layout.tilePaddingY,
    paddingHorizontal: layout.tilePaddingX,
  });
  expect(styleOf('today-panel')).toMatchObject({ padding: layout.panelPadding });
  expect(styleOf('chore-board-day-today')).toMatchObject({ gap: layout.dayGap });
  expect(styleOf('chore-board-groups-today')).toMatchObject({ gap: layout.groupSpacing });
  expect(styleOf('chore-board-person-today-p1')).toMatchObject({ gap: layout.groupGap });
  expect(styleOf('chore-item-c1')).toMatchObject({
    minHeight: layout.rowHeight,
    paddingVertical: layout.rowPaddingY,
    paddingHorizontal: layout.rowPaddingX,
  });
}

/** The landscape three-zone arrangement (ADR-0005). */
function expectLandscapeZones() {
  // The page ScrollView is kept (#210) but does not scroll; the panels do.
  expect(node('hub-scroll').props.scrollEnabled).toBe(false);
  // Exactly the window height, so the inner panels scroll instead of clipping.
  expect(StyleSheet.flatten(node('hub-scroll').props.contentContainerStyle as never)).toMatchObject({ flex: 1 });
  expect(node('hub-side').props.scrollEnabled).toBe(true);
  expect(node('today-panel-scroll').props.scrollEnabled).toBe(true);
  expect(shellZones()).toEqual(['hub-chrome', 'hub-header', 'hub-name-tiles', 'hub-main']);
  expect(hostChildren(node('hub-main')).map((child) => child.props.testID)).toEqual([
    'hub-today-zone',
    'hub-side',
  ]);
  expect(styleOf('hub-main')).toMatchObject({ flexDirection: 'row' });
  expect(within(screen.getByTestId('hub-today-zone')).getByTestId('today-panel')).toBeOnTheScreen();
  expect(within(screen.getByTestId('hub-today-zone')).getByTestId('today-panel-scroll')).toBeOnTheScreen();
  const side = within(screen.getByTestId('hub-side'));
  expect(side.getByTestId('hub-groceries')).toBeOnTheScreen();
  expect(side.getByTestId('hub-balance')).toBeOnTheScreen();
  expect(within(screen.getByTestId('hub-today-zone')).queryByTestId('hub-groceries')).toBeNull();
  // The tiles stay on one row, and the Today groups sit in two columns.
  expect(styleOf('hub-name-tiles')).toMatchObject({ flexWrap: 'nowrap' });
  expect(styleOf('chore-board-groups-today')).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  expect(styleOf('chore-board-person-today-p1')).toMatchObject({ flexBasis: '40%', flexGrow: 1 });
}

beforeEach(() => {
  resetSessionFallbackStorage();
});

afterEach(() => {
  useApiClientMock.mockReset();
  Dimensions.set({ window: { width: 750, height: 1334, scale: 2, fontScale: 2 } });
});

describe('HubShell layout (#118)', () => {
  it('renders the landscape three-zone layout at compact density when useWindowDimensions reports 1280x800 (AC1)', async () => {
    await renderHubAt(1280, 800);

    expectLandscapeZones();
    expectStylesFrom(LANDSCAPE_COMPACT);
  });

  it('the rendered 1280x800 board matches the fit model (AC4)', async () => {
    await renderHubAt(1280, 800);

    expect(screen.getAllByTestId(/^name-tile-p\d$/)).toHaveLength(4);
    const rows = todayRowsByPerson();
    expect(rows).toEqual([2, 2, 2, 2]);
    expect(screen.queryByTestId('chore-board-day-this-week')).toBeNull();
    const measure = measureHubBoard(LANDSCAPE_COMPACT, { people: 4, todayRowsByPerson: rows }, 800);
    expect(measure.fits).toBe(true);
    expect(measure.total + NATIVE_STACK_HEADER_HEIGHT).toBeLessThanOrEqual(800);
  });

  it('renders the landscape three-zone layout at roomy density when useWindowDimensions reports 1920x1200 (AC2)', async () => {
    await renderHubAt(1920, 1200);

    expectLandscapeZones();
    expectStylesFrom(LANDSCAPE_ROOMY);
  });

  it('the rendered 1920x1200 board matches the fit model (AC5)', async () => {
    await renderHubAt(1920, 1200);

    const rows = todayRowsByPerson();
    expect(rows).toEqual([2, 2, 2, 2]);
    const measure = measureHubBoard(LANDSCAPE_ROOMY, { people: 4, todayRowsByPerson: rows }, 1200);
    expect(measure.fits).toBe(true);
    expect(measure.total + NATIVE_STACK_HEADER_HEIGHT).toBeLessThanOrEqual(1200);
  });

  it('renders the portrait fallback when useWindowDimensions reports 800x1280 (AC3)', async () => {
    await renderHubAt(800, 1280);

    expect(within(screen.getByTestId('hub-scroll')).getByTestId('hub-shell')).toBeOnTheScreen();
    // The page scrolls; the side column and the Today panel do not (#210).
    expect(node('hub-scroll').props.scrollEnabled).toBe(true);
    expect(StyleSheet.flatten(node('hub-scroll').props.contentContainerStyle as never)).toMatchObject({ flexGrow: 1 });
    expect(node('hub-side').props.scrollEnabled).toBe(false);
    expect(node('today-panel-scroll').props.scrollEnabled).toBe(false);
    // The same zones as landscape, stacked in one column, in order.
    expect(shellZones()).toEqual(['hub-chrome', 'hub-header', 'hub-name-tiles', 'hub-main']);
    expect(hostChildren(node('hub-main')).map((child) => child.props.testID)).toEqual([
      'hub-today-zone',
      'hub-side',
    ]);
    expect(styleOf('hub-main')).toMatchObject({ flexDirection: 'column' });
    expect(within(screen.getByTestId('hub-today-zone')).getByTestId('today-panel')).toBeOnTheScreen();
    expect(
      hostChildren(hostChildren(node('hub-side'))[0]).map((child) => child.props.testID),
    ).toEqual(['hub-groceries', 'hub-balance']);
    expect(styleOf('hub-name-tiles')).toMatchObject({ flexWrap: 'wrap' });
    expect(styleOf('chore-board-groups-today')).toMatchObject({ flexDirection: 'column' });
    expect(styleOf('name-tile-p1')).toMatchObject({ flexBasis: '30%', flexGrow: 1 });
    expectStylesFrom(PORTRAIT);
  });

  it('re-lays the hub out when the tablet rotates', async () => {
    await renderHubAt(1280, 800);
    expect(styleOf('hub-main')).toMatchObject({ flexDirection: 'row' });
    expect(node('hub-scroll').props.scrollEnabled).toBe(false);

    await act(async () => {
      setWindow(800, 1280);
    });

    expect(styleOf('hub-main')).toMatchObject({ flexDirection: 'column' });
    expect(node('hub-scroll').props.scrollEnabled).toBe(true);
    expect(screen.getAllByTestId(/^chore-item-c\d+$/)).toHaveLength(8);
  });
});

/**
 * A rotation re-lays the hub out without remounting any widget (#210): every
 * layout renders the same element tree and only styles and scrolling switch, so
 * local state survives and no read is repeated.
 */
describe('HubShell rotation keeps widget state (#210)', () => {
  async function rotate(width: number, height: number) {
    await act(async () => {
      setWindow(width, height);
    });
  }

  function readCalls(client: ApiClient): number {
    return (client.get as jest.Mock).mock.calls.length + (client.update as jest.Mock).mock.calls.length;
  }

  it('keeps an open organizer PIN pad open when the tablet rotates (AC1)', async () => {
    setWindow(1280, 800);
    useApiClientMock.mockReturnValue(hubClient());
    const pinProvider: IAuthProvider = {
      kind: 'pin',
      signIn: jest.fn(() => Promise.resolve(null)),
      signOut: () => Promise.resolve(),
    };
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <OrganizerProvider authProvider={pinProvider}>
          <HubShell />
        </OrganizerProvider>
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId(/^chore-item-c\d+$/)).toHaveLength(8));

    await act(async () => {
      fireEvent.press(screen.getByTestId('organizer-sign-in'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('pin-digit-1'));
    });
    expect(screen.getByTestId('pin-pad')).toBeOnTheScreen();
    expect(screen.getByTestId('pin-display').props.accessibilityLabel).toBe('1 digits entered');

    await rotate(800, 1280);
    expect(screen.getByTestId('pin-pad')).toBeOnTheScreen();
    expect(screen.getByTestId('pin-display').props.accessibilityLabel).toBe('1 digits entered');

    await rotate(1280, 800);
    expect(screen.getByTestId('pin-pad')).toBeOnTheScreen();
    expect(screen.getByTestId('pin-display').props.accessibilityLabel).toBe('1 digits entered');
  });

  it('keeps typed grocery text when the tablet rotates (AC2)', async () => {
    await renderHubAt(1280, 800);
    await waitFor(() => expect(screen.getByTestId('grocery-add-input')).toBeOnTheScreen());

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('grocery-add-input'), 'oat milk');
    });
    expect(screen.getByTestId('grocery-add-input').props.value).toBe('oat milk');

    // After a remount the cart shows its loading state first, so read the input
    // once it is back: the red result is an empty value, not a missing node.
    await rotate(800, 1280);
    await waitFor(() => expect(screen.getByTestId('grocery-add-input').props.value).toBe('oat milk'));

    await rotate(1280, 800);
    await waitFor(() => expect(screen.getByTestId('grocery-add-input').props.value).toBe('oat milk'));
  });

  it('issues no extra reads when the tablet rotates (AC3)', async () => {
    setWindow(1280, 800);
    const client = hubClient({ fairnessOk: true });
    useApiClientMock.mockReturnValue(client);
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <HubShell />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId(/^chore-item-c\d+$/)).toHaveLength(8));
    await waitFor(() => expect(screen.getByTestId('grocery-add-input')).toBeOnTheScreen());
    await waitFor(() => expect(screen.getByTestId('fairness-empty')).toBeOnTheScreen());
    await act(async () => {});
    const settled = readCalls(client);

    await rotate(800, 1280);
    await act(async () => {});
    expect(readCalls(client)).toBe(settled);

    await rotate(1280, 800);
    await act(async () => {});
    expect(readCalls(client)).toBe(settled);
  });
});

describe('HubShell touch targets (#120)', () => {
  const windows = [
    [1280, 800],
    [1920, 1200],
    [800, 1280],
  ] as const;

  it.each(windows)('name tiles and chore rows render at least 48x48 at %sx%s (AC4)', async (width, height) => {
    await renderHubAt(width, height);

    for (const person of roster) {
      const tile = styleOf(`name-tile-${person.personId}`);
      expect(tile.minHeight as number).toBeGreaterThanOrEqual(hubTouchTarget);
      expect(tile.minWidth as number).toBeGreaterThanOrEqual(hubTouchTarget);
    }
    for (const chore of chores) {
      const row = styleOf(`chore-item-${chore.choreId}`);
      expect(row.minHeight as number).toBeGreaterThanOrEqual(hubTouchTarget);
      expect(row.minWidth as number).toBeGreaterThanOrEqual(hubTouchTarget);
    }
  });

  it.each(windows)('adjacent tiles and chore rows sit at least 8dp apart at %sx%s (AC5)', async (width, height) => {
    await renderHubAt(width, height);

    // Tiles are siblings in the tile row; rows are siblings in a person group;
    // person groups are siblings in the groups container. Each container's gap
    // is the space between adjacent targets.
    expect(styleOf('hub-name-tiles').gap as number).toBeGreaterThanOrEqual(minTargetGap);
    for (const person of roster) {
      expect(styleOf(`chore-board-person-today-${person.personId}`).gap as number).toBeGreaterThanOrEqual(
        minTargetGap,
      );
    }
    expect(styleOf('chore-board-groups-today').gap as number).toBeGreaterThanOrEqual(minTargetGap);
  });
});
