/**
 * WCAG 2.1 relative luminance and contrast ratio for `#RRGGBB` colours (#120
 * AC8/AC9, ADR-0010). Used by the claim colour contrast test; the formula is
 * the one in https://www.w3.org/TR/WCAG21/#dfn-relative-luminance.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** One sRGB channel (0..255) linearised. */
function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance (0..1) of a `#RRGGBB` colour. Throws on any other format. */
export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) {
    throw new Error(`Expected a #RRGGBB colour, got "${hex}".`);
  }
  const r = linearChannel(parseInt(hex.slice(1, 3), 16));
  const g = linearChannel(parseInt(hex.slice(3, 5), 16));
  const b = linearChannel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio (1..21) between two `#RRGGBB` colours, in either order. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
