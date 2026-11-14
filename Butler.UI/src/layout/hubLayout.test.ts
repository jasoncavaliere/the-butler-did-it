import tokensJson from '../../design-tokens.json';
import {
  DEFAULT_HUB_LAYOUT,
  LANDSCAPE_COMPACT,
  LANDSCAPE_ROOMY,
  PANEL_BORDER_MAX,
  PORTRAIT,
  ROOMY_MIN_HEIGHT,
  ROW_BORDER_MAX,
  TILE_BORDER,
  measureHubBoard,
  selectHubLayout,
  type HubLayout,
} from './hubLayout';
import {
  chipMinHeight,
  densityHub,
  lineHeightFor,
  minTouchTarget,
  nameTileMinHeight,
  nameTileMinWidth,
  radii,
  space,
  spacingScale,
  typeScale,
} from './tokens';

const LAYOUTS: HubLayout[] = [LANDSCAPE_COMPACT, LANDSCAPE_ROOMY, PORTRAIT];

/** A 4-person household with 8 chores due today (#118 AC4/AC5). */
const FOUR_PEOPLE_EIGHT_TODAY = { people: 4, todayRowsByPerson: [2, 2, 2, 2] };

describe('tokens', () => {
  it('maps the spacing scale onto the mockup names s1..s9 (no s5)', () => {
    expect(space).toEqual({ s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s7: 32, s8: 48, s9: 64 });
    expect(spacingScale).toEqual(tokensJson.spacing);
  });

  it('reads sizes, radii and component floors from design-tokens.json', () => {
    expect(typeScale).toEqual(tokensJson.type_scale);
    expect(radii).toEqual(tokensJson.radii);
    expect(minTouchTarget).toBe(44);
    expect(densityHub.rowMinHeight).toBe(64);
    expect(nameTileMinHeight).toBe(64);
    expect(nameTileMinWidth).toBe(96);
    expect(chipMinHeight).toBe(32);
  });

  it('derives a tight line height from a font size', () => {
    expect(lineHeightFor(14)).toBe(17);
    expect(lineHeightFor(18)).toBe(22);
    expect(lineHeightFor(22)).toBe(26);
    expect(lineHeightFor(28)).toBe(34);
    expect(lineHeightFor(44)).toBe(53);
  });
});

describe('selectHubLayout', () => {
  it('picks landscape-compact at 1280x800 (AC1)', () => {
    expect(selectHubLayout({ width: 1280, height: 800 })).toBe(LANDSCAPE_COMPACT);
  });

  it('picks landscape-roomy at 1920x1200 (and at the 1600x1000 / 1920x1080 boundaries) (AC2)', () => {
    expect(selectHubLayout({ width: 1920, height: 1200 })).toBe(LANDSCAPE_ROOMY);
    expect(selectHubLayout({ width: 1600, height: ROOMY_MIN_HEIGHT })).toBe(LANDSCAPE_ROOMY);
    expect(selectHubLayout({ width: 1920, height: 1080 })).toBe(LANDSCAPE_ROOMY);
  });

  it('keeps a landscape window just under the roomy height compact', () => {
    expect(selectHubLayout({ width: 1600, height: 999 })).toBe(LANDSCAPE_COMPACT);
  });

  it('picks portrait at 800x1280 (AC3)', () => {
    expect(selectHubLayout({ width: 800, height: 1280 })).toBe(PORTRAIT);
  });

  it('treats a square window as landscape', () => {
    expect(selectHubLayout({ width: 900, height: 900 })).toBe(LANDSCAPE_COMPACT);
    expect(selectHubLayout({ width: 1200, height: 1200 })).toBe(LANDSCAPE_ROOMY);
  });

  it('returns the shared frozen constants, never a fresh object', () => {
    const a = selectHubLayout({ width: 1280, height: 800 });
    const b = selectHubLayout({ width: 1366, height: 768 });
    expect(a).toBe(b);
    for (const layout of LAYOUTS) {
      expect(Object.isFrozen(layout)).toBe(true);
    }
  });

  it('defaults components to the portrait layout (the jest window)', () => {
    expect(DEFAULT_HUB_LAYOUT).toBe(PORTRAIT);
  });
});

describe('layout metrics', () => {
  const sizeKeys: (keyof HubLayout)[] = [
    'nameSize',
    'dateSize',
    'statusSize',
    'tileNameSize',
    'panelHeadingSize',
    'dayLabelSize',
    'personLabelSize',
    'rowTitleSize',
  ];
  const spacingKeys: (keyof HubLayout)[] = [
    'pagePadding',
    'zoneGap',
    'chromeGap',
    'headerGap',
    'tilePaddingY',
    'tilePaddingX',
    'tileGap',
    'panelPadding',
    'panelHeadingGap',
    'dayGap',
    'groupGap',
    'groupSpacing',
    'rowPaddingY',
    'rowPaddingX',
  ];
  const lineHeightPairs: [keyof HubLayout, keyof HubLayout][] = [
    ['nameSize', 'nameLineHeight'],
    ['dateSize', 'dateLineHeight'],
    ['tileNameSize', 'tileNameLineHeight'],
    ['panelHeadingSize', 'panelHeadingLineHeight'],
    ['dayLabelSize', 'dayLabelLineHeight'],
    ['personLabelSize', 'personLabelLineHeight'],
    ['rowTitleSize', 'rowTitleLineHeight'],
  ];

  it.each(LAYOUTS.map((layout) => [layout.name, layout] as const))(
    'every font size and spacing metric in %s is a design-tokens.json value (AC6)',
    (_name, layout) => {
      const sizes = Object.values(tokensJson.type_scale);
      for (const key of sizeKeys) {
        expect(sizes).toContain(layout[key]);
      }
      for (const key of spacingKeys) {
        expect(tokensJson.spacing).toContain(layout[key]);
      }
      for (const [size, lineHeight] of lineHeightPairs) {
        expect(layout[lineHeight]).toBe(lineHeightFor(layout[size] as number));
      }
      expect(layout.chromeHeight).toBe(tokensJson.min_touch_target);
      expect(layout.rowHeight).toBe(tokensJson.density.hub['row-min-height']);
    },
  );

  it.each(LAYOUTS.map((layout) => [layout.name, layout] as const))(
    'every fixed box in %s is at least as tall as its single-line content',
    (_name, layout) => {
      expect(layout.rowTitleLineHeight + 2 * layout.rowPaddingY + 2 * ROW_BORDER_MAX).toBeLessThanOrEqual(
        layout.rowHeight,
      );
      expect(
        layout.tileNameLineHeight + 2 * layout.tilePaddingY + 2 * TILE_BORDER,
      ).toBeLessThanOrEqual(layout.tileHeight);
      expect(layout.tileHeight).toBeGreaterThanOrEqual(nameTileMinHeight);
      expect(layout.nameLineHeight).toBeLessThanOrEqual(layout.headerHeight);
      expect(layout.dateLineHeight).toBeLessThanOrEqual(layout.headerHeight);
      expect(chipMinHeight).toBeLessThanOrEqual(layout.headerHeight);
    },
  );

  it('roomy steps up the type and spacing but keeps the 64px hub row (ADR-0008)', () => {
    expect(LANDSCAPE_ROOMY.rowHeight).toBe(LANDSCAPE_COMPACT.rowHeight);
    expect(LANDSCAPE_ROOMY.nameSize).toBeGreaterThan(LANDSCAPE_COMPACT.nameSize);
    expect(LANDSCAPE_ROOMY.rowTitleSize).toBeGreaterThan(LANDSCAPE_COMPACT.rowTitleSize);
    expect(LANDSCAPE_ROOMY.pagePadding).toBeGreaterThan(LANDSCAPE_COMPACT.pagePadding);
    expect(LANDSCAPE_COMPACT.headerHeight).toBe(48);
    expect(LANDSCAPE_ROOMY.headerHeight).toBe(64);
    expect(LANDSCAPE_COMPACT.tileHeight).toBe(64);
    expect(LANDSCAPE_ROOMY.tileHeight).toBe(70);
  });

  it('lays landscape out in zones and portrait as one stack', () => {
    expect(LANDSCAPE_COMPACT).toMatchObject({ orientation: 'landscape', sideColumn: true, boardColumns: 2, tilesPerRow: null });
    expect(LANDSCAPE_ROOMY).toMatchObject({ orientation: 'landscape', sideColumn: true, boardColumns: 2, tilesPerRow: null });
    expect(PORTRAIT).toMatchObject({ orientation: 'portrait', sideColumn: false, boardColumns: 1, tilesPerRow: 3 });
  });
});

describe('measureHubBoard', () => {
  it('a 4-person household with 8 chores due today fits 800px at 1280x800 (AC4)', () => {
    const layout = selectHubLayout({ width: 1280, height: 800 });
    const measure = measureHubBoard(layout, FOUR_PEOPLE_EIGHT_TODAY);

    expect(measure).toEqual({ chrome: 44, header: 48, tiles: 64, today: 414, total: 666 });
    // The AC's literal sum (header + tile row + rows x row height) is inside it.
    expect(measure.header + measure.tiles + 8 * layout.rowHeight).toBe(624);
    expect(measure.total).toBeLessThanOrEqual(800);
  });

  it('a 4-person household with 8 chores due today fits 1200px at 1920x1200 (AC5)', () => {
    const layout = selectHubLayout({ width: 1920, height: 1200 });
    const measure = measureHubBoard(layout, FOUR_PEOPLE_EIGHT_TODAY);

    expect(measure).toEqual({ chrome: 44, header: 64, tiles: 70, today: 480, total: 794 });
    expect(measure.total).toBeLessThanOrEqual(1200);
  });

  it('still fits when the 8 chores are skewed across the 4 people', () => {
    expect(measureHubBoard(LANDSCAPE_COMPACT, { people: 4, todayRowsByPerson: [3, 3, 1, 1] }).total).toBe(666);
    expect(measureHubBoard(LANDSCAPE_COMPACT, { people: 4, todayRowsByPerson: [4, 2, 1, 1] }).total).toBe(734);
    expect(measureHubBoard(LANDSCAPE_ROOMY, { people: 4, todayRowsByPerson: [8, 0, 0, 0] }).total).toBe(1044);
    // A 5-1-1-1 split models 802px at compact: beyond the guarantee, which the
    // Today panel's own scroll absorbs (automatic paging is out of scope).
    for (const rows of [[3, 3, 1, 1], [4, 2, 1, 1], [1, 2, 3, 2], [2, 3, 1, 2]]) {
      expect(measureHubBoard(LANDSCAPE_COMPACT, { people: 4, todayRowsByPerson: rows }).total).toBeLessThanOrEqual(800);
      expect(measureHubBoard(LANDSCAPE_ROOMY, { people: 4, todayRowsByPerson: rows }).total).toBeLessThanOrEqual(1200);
    }
  });

  it('measures an empty board as just the panel frame', () => {
    const measure = measureHubBoard(LANDSCAPE_COMPACT, { people: 0, todayRowsByPerson: [] });
    expect(measure.today).toBe(
      2 * LANDSCAPE_COMPACT.panelPadding +
        2 * PANEL_BORDER_MAX +
        LANDSCAPE_COMPACT.panelHeadingLineHeight +
        LANDSCAPE_COMPACT.panelHeadingGap,
    );
    expect(measure.tiles).toBe(LANDSCAPE_COMPACT.tileHeight);
  });

  it('adds a second day bucket, separated by the group spacing', () => {
    const todayOnly = measureHubBoard(LANDSCAPE_COMPACT, FOUR_PEOPLE_EIGHT_TODAY);
    const withWeek = measureHubBoard(LANDSCAPE_COMPACT, {
      ...FOUR_PEOPLE_EIGHT_TODAY,
      weekRowsByPerson: [1, 0, 0, 0],
    });
    const weekBucket =
      LANDSCAPE_COMPACT.dayLabelLineHeight +
      LANDSCAPE_COMPACT.dayGap +
      LANDSCAPE_COMPACT.personLabelLineHeight +
      LANDSCAPE_COMPACT.groupGap +
      LANDSCAPE_COMPACT.rowHeight;
    expect(withWeek.today - todayOnly.today).toBe(weekBucket + LANDSCAPE_COMPACT.groupSpacing);
  });

  it('gives an odd last group its own row in two columns', () => {
    const three = measureHubBoard(LANDSCAPE_COMPACT, { people: 3, todayRowsByPerson: [1, 1, 1] });
    const two = measureHubBoard(LANDSCAPE_COMPACT, { people: 3, todayRowsByPerson: [1, 1] });
    const group = LANDSCAPE_COMPACT.personLabelLineHeight + LANDSCAPE_COMPACT.groupGap + LANDSCAPE_COMPACT.rowHeight;
    expect(three.today - two.today).toBe(group + LANDSCAPE_COMPACT.groupSpacing);
  });

  it('wraps portrait tiles three to a row and stacks every group', () => {
    const measure = measureHubBoard(PORTRAIT, FOUR_PEOPLE_EIGHT_TODAY);
    expect(measure.tiles).toBe(2 * PORTRAIT.tileHeight + PORTRAIT.tileGap);
    const group = PORTRAIT.personLabelLineHeight + 2 * PORTRAIT.groupGap + 2 * PORTRAIT.rowHeight;
    const bucket = PORTRAIT.dayLabelLineHeight + PORTRAIT.dayGap + 4 * group + 3 * PORTRAIT.groupSpacing;
    expect(measure.today).toBe(
      2 * PORTRAIT.panelPadding + 2 * PANEL_BORDER_MAX + PORTRAIT.panelHeadingLineHeight + PORTRAIT.panelHeadingGap + bucket,
    );
    expect(measureHubBoard(PORTRAIT, { people: 0, todayRowsByPerson: [] }).tiles).toBe(PORTRAIT.tileHeight);
  });
});
