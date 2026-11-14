import { contrastRatio, relativeLuminance } from './contrast';
import { claimColors, onClaim, themes } from './theme';

describe('contrast helpers (WCAG 2.1)', () => {
  it('rates black on white at 21:1 and a colour on itself at 1:1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#77A8FF', '#77A8FF')).toBe(1);
  });

  it('is order-independent and accepts lower-case hex', () => {
    expect(contrastRatio('#B0206F', '#FFFFFF')).toBe(contrastRatio('#FFFFFF', '#B0206F'));
    expect(contrastRatio('#b0206f', '#ffffff')).toBe(contrastRatio('#B0206F', '#FFFFFF'));
  });

  it('matches a known ratio (berry light on white is about 6.40:1)', () => {
    expect(contrastRatio('#B0206F', '#FFFFFF')).toBeCloseTo(6.4, 1);
  });

  it('linearises a near-black channel on the low branch', () => {
    // #0A0A0A: 10 / 255 = 0.0392 <= 0.03928, so each channel takes the linear branch.
    expect(relativeLuminance('#0A0A0A')).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it.each(['#FFF', 'FFFFFF', '#GGGGGG', '#FFFFFFFF', ''])('rejects %p as a colour', (bad) => {
    expect(() => relativeLuminance(bad)).toThrow('Expected a #RRGGBB colour');
  });
});

describe('claim colour contrast (ADR-0010)', () => {
  const each = claimColors.map((color) => [color.name, color] as const);

  it.each(each)('%s light variant is >= 3:1 on the light bg and surface (#120 AC8)', (_name, color) => {
    expect(contrastRatio(color.light, themes.light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.light, themes.light.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(each)('%s dark variant is >= 3:1 on the dark bg and surface (#120 AC8)', (_name, color) => {
    expect(contrastRatio(color.dark, themes.dark.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.dark, themes.dark.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(each)('on-claim is >= 4.5:1 on the %s light variant (#120 AC9)', (_name, color) => {
    expect(contrastRatio(onClaim.light, color.light)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(each)('on-claim-dark is >= 4.5:1 on the %s dark variant (#120 AC9)', (_name, color) => {
    expect(contrastRatio(onClaim.dark, color.dark)).toBeGreaterThanOrEqual(4.5);
  });
});
