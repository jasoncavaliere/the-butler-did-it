import tokensJson from '../../design-tokens.json';
import {
  claimColors,
  hubTouchTarget,
  minTargetGap,
  minTouchTarget,
  onClaim,
  radii,
  space,
  spacingScale,
  themes,
} from './theme';

describe('theme module', () => {
  it('exposes the six token claim colours in token order with glyph, light and dark', () => {
    expect(claimColors.map((color) => color.name)).toEqual([
      'berry',
      'marigold',
      'grass',
      'blue',
      'violet',
      'clay',
    ]);
    for (const color of claimColors) {
      expect(color).toEqual({ name: color.name, ...tokensJson.claim_colors[color.name] });
      expect(Object.isFrozen(color)).toBe(true);
    }
    expect(claimColors[0]).toEqual({ name: 'berry', glyph: 'star', light: '#B0206F', dark: '#EC77B4' });
    expect(claimColors[3]).toEqual({ name: 'blue', glyph: 'wave', light: '#2A5AD0', dark: '#77A8FF' });
    expect(Object.isFrozen(claimColors)).toBe(true);
  });

  it('exposes the light and dark palettes from colors and colors_dark (and onClaim)', () => {
    expect(themes.light).toEqual({
      bg: '#FAF7F2',
      surface: '#FFFFFF',
      text: '#22201C',
      textMuted: '#6B6259',
      primary: '#0F5A54',
      onPrimary: '#FFFFFF',
      border: '#E7E0D6',
      borderStrong: '#918979',
      success: '#1F7A46',
      danger: '#A5332A',
      focusRing: '#0F5A54',
    });
    expect(themes.dark.bg).toBe(tokensJson.colors_dark.bg);
    expect(themes.dark.surface).toBe(tokensJson.colors_dark.surface);
    expect(themes.dark.textMuted).toBe(tokensJson.colors_dark['text-muted']);
    expect(themes.dark.onPrimary).toBe(tokensJson.colors_dark['on-primary']);
    expect(themes.dark.borderStrong).toBe(tokensJson.colors_dark['border-strong']);
    expect(themes.dark.focusRing).toBe(tokensJson.colors_dark['focus-ring']);
    expect(Object.isFrozen(themes)).toBe(true);
    expect(Object.isFrozen(themes.light)).toBe(true);
    expect(Object.isFrozen(themes.dark)).toBe(true);

    expect(onClaim).toEqual({ light: '#FFFFFF', dark: '#0E0B08' });
    expect(Object.isFrozen(onClaim)).toBe(true);
  });

  it('exposes spacing and touch-target sizes from the token scale', () => {
    expect(space).toEqual({ s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s7: 32, s8: 48, s9: 64 });
    expect(spacingScale).toEqual(tokensJson.spacing);
    expect(radii).toEqual(tokensJson.radii);
    expect(minTouchTarget).toBe(tokensJson.min_touch_target);
    expect(hubTouchTarget).toBe(48);
    expect(hubTouchTarget).toBe(space.s8);
    expect(hubTouchTarget).toBeGreaterThanOrEqual(minTouchTarget);
    expect(minTargetGap).toBe(8);
    expect(minTargetGap).toBe(space.s2);
  });
});
