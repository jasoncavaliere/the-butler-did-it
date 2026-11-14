import tokensJson from '../../design-tokens.json';

/**
 * The typed theme module (#120 AC1): the single place UI code reads design
 * values from. It is a frozen, typed view over `design-tokens.json` (the design
 * contract from spike #42; ADR-0003 for the claim colours, ADR-0010 for the
 * WCAG 2.1 AA contrast rule), the same pattern as `src/layout/tokens.ts`: the
 * JSON's shape is proven by `theme.test.ts`, not by a runtime parser.
 *
 * - `claimColors`: the six person colours in token order, each with its glyph
 *   and its light and dark variants. The hub is dark-only, so a person's stored
 *   claim colour is the dark variant (#120 AC3).
 * - `onClaim`: the ink that sits on a filled claim colour in each theme.
 * - `themes`: the light (`colors`) and dark (`colors_dark`) palettes.
 * - Sizes: the spacing scale, radii and the touch-target floors, re-exported
 *   from `src/layout/tokens.ts`. The hub's targets (name tiles, chore rows) are
 *   at least `hubTouchTarget` (48) square and sit at least `minTargetGap` (8)
 *   apart (#120 AC4/AC5).
 *
 * The hub's rendered palette stays in `src/components/Screen.tsx`; this module
 * does not re-skin it.
 */

export {
  hubTouchTarget,
  minTargetGap,
  minTouchTarget,
  radii,
  space,
  spacingScale,
} from '../layout/tokens';

/** The six claim colour names, in token order. */
const CLAIM_COLOR_NAMES = ['berry', 'marigold', 'grass', 'blue', 'violet', 'clay'] as const;

/** A claim colour's token name. */
export type ClaimColorName = (typeof CLAIM_COLOR_NAMES)[number];

/** One claim colour: its name, its paired glyph, and its per-theme variants (#RRGGBB). */
export type ClaimColor = Readonly<{
  name: ClaimColorName;
  glyph: string;
  light: string;
  dark: string;
}>;

/** The six token claim colours, in token order (berry, marigold, grass, blue, violet, clay). */
export const claimColors: readonly ClaimColor[] = Object.freeze(
  CLAIM_COLOR_NAMES.map((name) => {
    const { glyph, light, dark } = tokensJson.claim_colors[name];
    return Object.freeze({ name, glyph, light, dark });
  }),
);

/** The ink on a filled claim colour: white on the light variants, warm black on the dark ones. */
export const onClaim: Readonly<{ light: string; dark: string }> = Object.freeze({
  light: tokensJson.claim_colors['on-claim'],
  dark: tokensJson.claim_colors['on-claim-dark'],
});

/** One theme's palette, with the token kebab-case keys in camelCase. */
export type ThemePalette = Readonly<{
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  border: string;
  borderStrong: string;
  success: string;
  danger: string;
  focusRing: string;
}>;

/** Map one `colors` / `colors_dark` block onto a {@link ThemePalette}. */
function toPalette(colors: typeof tokensJson.colors): ThemePalette {
  return Object.freeze({
    bg: colors.bg,
    surface: colors.surface,
    text: colors.text,
    textMuted: colors['text-muted'],
    primary: colors.primary,
    onPrimary: colors['on-primary'],
    border: colors.border,
    borderStrong: colors['border-strong'],
    success: colors.success,
    danger: colors.danger,
    focusRing: colors['focus-ring'],
  });
}

/** The light and dark palettes from `colors` and `colors_dark`. */
export const themes: Readonly<{ light: ThemePalette; dark: ThemePalette }> = Object.freeze({
  light: toPalette(tokensJson.colors),
  dark: toPalette(tokensJson.colors_dark),
});
