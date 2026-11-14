import tokensJson from '../../design-tokens.json';

/**
 * A typed view over `design-tokens.json`, the machine-readable design contract
 * (spike #42, ADR-0001..0010). Layout code reads font sizes and spacing from
 * here instead of writing literals (#118 AC6). The JSON's shape is proven by
 * `hubLayout.test.ts` rather than a runtime parser, the same pattern as
 * `src/setup/starterTemplates.ts`.
 *
 * Only sizes and spacing are exposed. The palette stays in
 * `src/components/Screen.tsx` and is not changed here.
 */

/** The type scale (px): caption 14, body 18, subhead 22, title 28, display 44. */
export const typeScale: Readonly<{
  caption: number;
  body: number;
  subhead: number;
  title: number;
  display: number;
}> = Object.freeze({ ...tokensJson.type_scale });

/**
 * The spacing scale, named after the mockup CSS variables
 * (`design/mockups/hub-neutral.html`): `--s1` .. `--s9`, with no `--s5`.
 */
export const space: Readonly<{
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s6: number;
  s7: number;
  s8: number;
  s9: number;
}> = Object.freeze({
  s1: tokensJson.spacing[0],
  s2: tokensJson.spacing[1],
  s3: tokensJson.spacing[2],
  s4: tokensJson.spacing[3],
  s6: tokensJson.spacing[4],
  s7: tokensJson.spacing[5],
  s8: tokensJson.spacing[6],
  s9: tokensJson.spacing[7],
});

/** Every spacing value the tokens allow, in scale order. */
export const spacingScale: readonly number[] = Object.freeze([...tokensJson.spacing]);

/** Corner radii: sm 4, md 8, lg 16, pill 999. */
export const radii: Readonly<{ sm: number; md: number; lg: number; pill: number }> = Object.freeze({
  ...tokensJson.radii,
});

/** The smallest tappable box (px). */
export const minTouchTarget: number = tokensJson.min_touch_target;

/** The hub (ambient) density's row floor, ADR-0008: 64. */
export const densityHub: Readonly<{ rowMinHeight: number }> = Object.freeze({
  rowMinHeight: tokensJson.density.hub['row-min-height'],
});

/** The name tile's floor height (px). */
export const nameTileMinHeight: number = tokensJson.components['name-tile']['min-height'];

/** The name tile's floor width (px). */
export const nameTileMinWidth: number = tokensJson.components['name-tile']['min-width'];

/** The offline chip's floor height (px). */
export const chipMinHeight: number = tokensJson.components['offline-chip']['min-height'];

/** The tight line-height ratio (1.2) used for single-line labels. */
export const tightLineHeight: number = tokensJson.line_heights.tight;

/** A single-line label's line height for a font size: `round(size * 1.2)`. */
export function lineHeightFor(size: number): number {
  return Math.round(size * tightLineHeight);
}
