import { useWindowDimensions } from 'react-native';

import {
  densityHub,
  lineHeightFor,
  minTouchTarget,
  nameTileMinHeight,
  space,
  typeScale,
} from './tokens';

/**
 * The hub's per-window layouts (#118): which arrangement and density the
 * always-on hub uses for the window it is given, and a fit model that sums the
 * heights of what that layout renders.
 *
 * - `landscape-compact` (a 1280x800 tablet): the ADR-0005 three-zone band at the
 *   smaller type steps and spacing. Groceries and the balance move to a side
 *   column beside the Today panel, and the Today panel lays its person groups
 *   out in two columns.
 * - `landscape-roomy` (a 1920x1200 tablet): the same zones at the larger steps.
 * - `portrait` (an 800x1280 tablet, and the jest default): the fallback single
 *   stack inside a page scroll, at the compact steps.
 *
 * Every landscape density keeps the 64px hub row height (ADR-0008); roomy differs
 * from compact only in type step and spacing. Every font size, line height,
 * padding, gap and fixed height below is read from `design-tokens.json` through
 * `./tokens` (AC6). A fixed height is `max(token floor, content height)`, and the
 * box renders it as a `minHeight` with single-line content, so the rendered box
 * and the model agree.
 *
 * The fit model ({@link measureHubBoard}) covers the page padding, the chrome
 * row (the organizer sign-in button), the header, the name-tile row and the
 * Today panel with its day buckets, person groups and rows. It leaves out what
 * only appears some of the time: the signed-in organizer bar or its PIN pad,
 * the `LastKnownBanner`, the `SyncIndicator` detail rows, and the
 * board's clock notice.
 */
export type HubLayoutName = 'landscape-roomy' | 'landscape-compact' | 'portrait';

export type HubLayout = Readonly<{
  name: HubLayoutName;
  orientation: 'landscape' | 'portrait';
  /** Padding around the whole hub. */
  pagePadding: number;
  /** The gap between the hub's zones (chrome, header, tiles, main). */
  zoneGap: number;
  /** The chrome row's floor (the organizer sign-in button). */
  chromeHeight: number;
  /** The gap inside the chrome row. */
  chromeGap: number;
  nameSize: number;
  nameLineHeight: number;
  headerHeight: number;
  headerGap: number;
  dateSize: number;
  dateLineHeight: number;
  statusSize: number;
  tileNameSize: number;
  tileNameLineHeight: number;
  tilePaddingY: number;
  tilePaddingX: number;
  tileHeight: number;
  tileGap: number;
  /** Tiles per wrapped row, or `null` for one non-wrapping row. */
  tilesPerRow: number | null;
  panelPadding: number;
  panelHeadingSize: number;
  panelHeadingLineHeight: number;
  panelHeadingGap: number;
  dayLabelSize: number;
  dayLabelLineHeight: number;
  dayGap: number;
  personLabelSize: number;
  personLabelLineHeight: number;
  /** The gap inside a person group (label to row, row to row). */
  groupGap: number;
  /** The gap between person groups, and between day buckets. */
  groupSpacing: number;
  rowTitleSize: number;
  rowTitleLineHeight: number;
  rowPaddingY: number;
  rowPaddingX: number;
  rowHeight: number;
  /** Person-group columns in the Today panel. */
  boardColumns: number;
  /** Whether groceries and the balance sit in a side column beside Today. */
  sideColumn: boolean;
}>;

/** A name tile's border width (each side). */
export const TILE_BORDER = 2;
/** A chore row's widest border (each side): 2 while it glows, else 1. */
export const ROW_BORDER_MAX = 2;
/** The Today panel's widest border (each side): 2 when accented, else 1. */
export const PANEL_BORDER_MAX = 2;

/** The smallest window height that gets the roomy landscape density. */
export const ROOMY_MIN_HEIGHT = 1000;

const compactRowContent =
  lineHeightFor(typeScale.subhead) + 2 * space.s3 + 2 * ROW_BORDER_MAX;
const roomyRowContent = lineHeightFor(typeScale.title) + 2 * space.s3 + 2 * ROW_BORDER_MAX;

const COMPACT_METRICS = {
  pagePadding: space.s6,
  zoneGap: space.s4,
  chromeHeight: minTouchTarget,
  chromeGap: space.s2,
  nameSize: typeScale.title,
  nameLineHeight: lineHeightFor(typeScale.title),
  headerHeight: Math.max(space.s8, lineHeightFor(typeScale.title)),
  headerGap: space.s3,
  dateSize: typeScale.body,
  dateLineHeight: lineHeightFor(typeScale.body),
  statusSize: typeScale.body,
  tileNameSize: typeScale.subhead,
  tileNameLineHeight: lineHeightFor(typeScale.subhead),
  tilePaddingY: space.s3,
  tilePaddingX: space.s4,
  tileHeight: Math.max(
    nameTileMinHeight,
    lineHeightFor(typeScale.subhead) + 2 * space.s3 + 2 * TILE_BORDER,
  ),
  tileGap: space.s3,
  panelPadding: space.s4,
  panelHeadingSize: typeScale.caption,
  panelHeadingLineHeight: lineHeightFor(typeScale.caption),
  panelHeadingGap: space.s2,
  dayLabelSize: typeScale.caption,
  dayLabelLineHeight: lineHeightFor(typeScale.caption),
  dayGap: space.s2,
  personLabelSize: typeScale.body,
  personLabelLineHeight: lineHeightFor(typeScale.body),
  groupGap: space.s1,
  groupSpacing: space.s3,
  rowTitleSize: typeScale.subhead,
  rowTitleLineHeight: lineHeightFor(typeScale.subhead),
  rowPaddingY: space.s3,
  rowPaddingX: space.s4,
  rowHeight: Math.max(densityHub.rowMinHeight, compactRowContent),
} as const;

/** The 1280x800 class: the three zones at the compact type steps. */
export const LANDSCAPE_COMPACT: HubLayout = Object.freeze({
  name: 'landscape-compact',
  orientation: 'landscape',
  ...COMPACT_METRICS,
  tilesPerRow: null,
  boardColumns: 2,
  sideColumn: true,
});

/** The 1920x1200 class: the three zones at the roomy type steps. */
export const LANDSCAPE_ROOMY: HubLayout = Object.freeze({
  name: 'landscape-roomy',
  orientation: 'landscape',
  pagePadding: space.s7,
  zoneGap: space.s6,
  chromeHeight: minTouchTarget,
  chromeGap: space.s2,
  nameSize: typeScale.display,
  nameLineHeight: lineHeightFor(typeScale.display),
  headerHeight: Math.max(space.s9, lineHeightFor(typeScale.display)),
  headerGap: space.s4,
  dateSize: typeScale.subhead,
  dateLineHeight: lineHeightFor(typeScale.subhead),
  statusSize: typeScale.subhead,
  tileNameSize: typeScale.title,
  tileNameLineHeight: lineHeightFor(typeScale.title),
  tilePaddingY: space.s4,
  tilePaddingX: space.s6,
  tileHeight: Math.max(
    nameTileMinHeight,
    lineHeightFor(typeScale.title) + 2 * space.s4 + 2 * TILE_BORDER,
  ),
  tileGap: space.s4,
  tilesPerRow: null,
  panelPadding: space.s6,
  panelHeadingSize: typeScale.title,
  panelHeadingLineHeight: lineHeightFor(typeScale.title),
  panelHeadingGap: space.s4,
  dayLabelSize: typeScale.body,
  dayLabelLineHeight: lineHeightFor(typeScale.body),
  dayGap: space.s2,
  personLabelSize: typeScale.body,
  personLabelLineHeight: lineHeightFor(typeScale.body),
  groupGap: space.s2,
  groupSpacing: space.s4,
  rowTitleSize: typeScale.title,
  rowTitleLineHeight: lineHeightFor(typeScale.title),
  rowPaddingY: space.s3,
  rowPaddingX: space.s4,
  rowHeight: Math.max(densityHub.rowMinHeight, roomyRowContent),
  boardColumns: 2,
  sideColumn: true,
});

/** The portrait fallback: one stack in a page scroll, at the compact steps. */
export const PORTRAIT: HubLayout = Object.freeze({
  name: 'portrait',
  orientation: 'portrait',
  ...COMPACT_METRICS,
  tilesPerRow: 3,
  boardColumns: 1,
  sideColumn: false,
});

/** The layout a component uses when it is not handed one (the jest default window). */
export const DEFAULT_HUB_LAYOUT: HubLayout = PORTRAIT;

/**
 * Pick the hub layout for a window. Landscape (including square) at or above
 * {@link ROOMY_MIN_HEIGHT} tall is roomy, shorter landscape is compact, and a
 * window taller than it is wide is portrait. Always returns one of the shared
 * frozen constants, so a re-render with the same class keeps the same reference.
 */
export function selectHubLayout({ width, height }: { width: number; height: number }): HubLayout {
  if (height > width) {
    return PORTRAIT;
  }
  return height >= ROOMY_MIN_HEIGHT ? LANDSCAPE_ROOMY : LANDSCAPE_COMPACT;
}

/** The hub layout for the current window; re-selects when the window changes. */
export function useHubLayout(): HubLayout {
  return selectHubLayout(useWindowDimensions());
}

/** What the fit model needs to know about a household's board. */
export type HubBoardShape = {
  /** Name tiles shown (the household's chore-doing members). */
  people: number;
  /** Rows due today per person, in roster order (zeros are skipped). */
  todayRowsByPerson: readonly number[];
  /** Rows due this week per person (the second bucket); omitted means none. */
  weekRowsByPerson?: readonly number[];
};

/** The modelled height of each measured piece, and their total (px). */
export type HubBoardMeasure = {
  chrome: number;
  header: number;
  tiles: number;
  today: number;
  total: number;
};

/** One person group: label, then rows, all separated by the group gap. */
function groupHeight(layout: HubLayout, rows: number): number {
  return (
    layout.personLabelLineHeight + layout.groupGap + rows * layout.rowHeight + (rows - 1) * layout.groupGap
  );
}

/** One day bucket: its label, then its groups laid out in `boardColumns` columns. */
function bucketHeight(layout: HubLayout, rowsByPerson: readonly number[]): number {
  const groups = rowsByPerson.filter((rows) => rows > 0).map((rows) => groupHeight(layout, rows));
  let body = 0;
  let chunks = 0;
  for (let start = 0; start < groups.length; start += layout.boardColumns) {
    body += Math.max(...groups.slice(start, start + layout.boardColumns));
    chunks += 1;
  }
  return layout.dayLabelLineHeight + layout.dayGap + body + (chunks - 1) * layout.groupSpacing;
}

/**
 * Sum the height of everything the layout renders for a household's board
 * (see the module notes for what is left out). `total` is what has to fit the
 * window height for the board to show without a scroll.
 */
export function measureHubBoard(layout: HubLayout, shape: HubBoardShape): HubBoardMeasure {
  const chrome = layout.chromeHeight;
  const header = layout.headerHeight;

  const tileRows =
    layout.tilesPerRow === null ? 1 : Math.max(1, Math.ceil(shape.people / layout.tilesPerRow));
  const tiles = tileRows * layout.tileHeight + (tileRows - 1) * layout.tileGap;

  const buckets = [shape.todayRowsByPerson, shape.weekRowsByPerson ?? []]
    .filter((rows) => rows.some((n) => n > 0))
    .map((rows) => bucketHeight(layout, rows));
  const board =
    buckets.length === 0
      ? 0
      : buckets.reduce((sum, height) => sum + height, 0) + (buckets.length - 1) * layout.groupSpacing;
  const today =
    2 * layout.panelPadding +
    2 * PANEL_BORDER_MAX +
    layout.panelHeadingLineHeight +
    layout.panelHeadingGap +
    board;

  const total = 2 * layout.pagePadding + chrome + 3 * layout.zoneGap + header + tiles + today;
  return { chrome, header, tiles, today, total };
}
