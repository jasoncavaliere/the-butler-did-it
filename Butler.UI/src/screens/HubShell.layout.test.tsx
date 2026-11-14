import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import type { AssignmentView, ChoreResponse, RosterEntryResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import {
  LANDSCAPE_COMPACT,
  LANDSCAPE_ROOMY,
  PORTRAIT,
  measureHubBoard,
  type HubLayout,
} from '../layout/hubLayout';
import { resetSessionFallbackStorage } from '../offline/storage';
import { hubTouchTarget, minTargetGap } from '../theme/theme';
import { currentWeekIso } from '../offline/weekIso';
import { HouseholdProvider } from '../state/HouseholdContext';

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

/** A client that answers every read the hub makes, routed by path. */
function hubClient(): ApiClient {
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
        return { ok: false, error: { kind: 'http', status: 500, title: 'Not in this test.' } };
      }
      if (path.endsWith('/people')) {
        return ok(roster);
      }
      return ok({ householdId: 'hh-1', name: 'The Rivera Home' });
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (): Promise<ApiResult<unknown>> =>
      ok({ weekIso: WEEK, assignments, unassigned: [] }),
    ) as unknown as ApiClient['update'],
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
  expect(screen.queryByTestId('hub-scroll')).toBeNull();
  expect(shellZones()).toEqual(['hub-chrome', 'hub-header', 'hub-name-tiles', 'hub-main-landscape']);
  expect(hostChildren(node('hub-main-landscape')).map((child) => child.props.testID)).toEqual([
    'hub-today-zone',
    'hub-side',
  ]);
  expect(styleOf('hub-main-landscape')).toMatchObject({ flexDirection: 'row' });
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
    const measure = measureHubBoard(LANDSCAPE_COMPACT, { people: 4, todayRowsByPerson: rows });
    expect(measure.total).toBeLessThanOrEqual(800);
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
    const measure = measureHubBoard(LANDSCAPE_ROOMY, { people: 4, todayRowsByPerson: rows });
    expect(measure.total).toBeLessThanOrEqual(1200);
  });

  it('renders the portrait fallback when useWindowDimensions reports 800x1280 (AC3)', async () => {
    await renderHubAt(800, 1280);

    expect(screen.getByTestId('hub-scroll')).toBeOnTheScreen();
    expect(within(screen.getByTestId('hub-scroll')).getByTestId('hub-shell')).toBeOnTheScreen();
    expect(screen.queryByTestId('hub-main-landscape')).toBeNull();
    expect(screen.queryByTestId('hub-side')).toBeNull();
    expect(screen.queryByTestId('today-panel-scroll')).toBeNull();
    // The single stack: every region is a direct child of the shell, in order.
    const zones = shellZones();
    expect(zones).toEqual([
      'hub-chrome',
      'hub-header',
      'hub-name-tiles',
      'today-panel',
      'hub-groceries',
      'hub-balance',
    ]);
    expect(styleOf('hub-name-tiles')).toMatchObject({ flexWrap: 'wrap' });
    expect(styleOf('chore-board-groups-today')).toMatchObject({ flexDirection: 'column' });
    expect(styleOf('name-tile-p1')).toMatchObject({ flexBasis: '30%', flexGrow: 1 });
    expectStylesFrom(PORTRAIT);
  });

  it('re-lays the hub out when the tablet rotates', async () => {
    await renderHubAt(1280, 800);
    expect(screen.getByTestId('hub-main-landscape')).toBeOnTheScreen();

    await act(async () => {
      setWindow(800, 1280);
    });

    expect(screen.queryByTestId('hub-main-landscape')).toBeNull();
    expect(screen.getByTestId('hub-scroll')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^chore-item-c\d+$/)).toHaveLength(8);
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
