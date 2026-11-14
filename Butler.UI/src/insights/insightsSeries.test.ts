import {
  INSIGHTS_WEEKS,
  barFraction,
  dayLabel,
  formatShare,
  monthLabel,
  resolveMemberColors,
  weekLabel,
} from './insightsSeries';
import { claimColors } from '../theme/theme';

describe('insightsSeries', () => {
  it('asks for an eight-week window', () => {
    expect(INSIGHTS_WEEKS).toBe(8);
  });

  describe('resolveMemberColors', () => {
    it('uses a claim colour when set and a token colour by position otherwise', () => {
      const members = Array.from({ length: 8 }, (_, index) => ({
        personId: `p${index}`,
        displayName: `Person ${index}`,
        claimColor: index === 1 ? '#123456' : null,
      }));

      const colors = resolveMemberColors(members);

      expect(colors.p0).toBe(claimColors[0].dark);
      expect(colors.p1).toBe('#123456');
      expect(colors.p2).toBe(claimColors[2].dark);
      // Wraps around the six token colours.
      expect(colors.p6).toBe(claimColors[0].dark);
      expect(colors.p7).toBe(claimColors[1].dark);
    });

    it('returns an empty map for no members', () => {
      expect(resolveMemberColors([])).toEqual({});
    });
  });

  describe('barFraction', () => {
    it('is zero when the maximum is not positive', () => {
      expect(barFraction(3, 0)).toBe(0);
      expect(barFraction(3, -1)).toBe(0);
    });

    it('scales and clamps to [0, 1]', () => {
      expect(barFraction(2, 4)).toBe(0.5);
      expect(barFraction(8, 4)).toBe(1);
      expect(barFraction(-2, 4)).toBe(0);
    });
  });

  it('formats a share as a whole percentage', () => {
    expect(formatShare(0.625)).toBe('63%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(1)).toBe('100%');
  });

  it('labels a week by its week number', () => {
    expect(weekLabel('2026-W29')).toBe('W29');
    expect(weekLabel('W29')).toBe('W29');
  });

  it('labels a day with a fixed English month', () => {
    expect(dayLabel('2026-07-15')).toBe('Jul 15');
    expect(dayLabel('2026-01-01')).toBe('Jan 1');
    expect(dayLabel('2026-12-31')).toBe('Dec 31');
  });

  it('returns a malformed day unchanged', () => {
    expect(dayLabel('2026-13-01')).toBe('2026-13-01');
    expect(dayLabel('2026-07')).toBe('2026-07');
    expect(dayLabel('nope')).toBe('nope');
  });

  it('labels a month with its year', () => {
    expect(monthLabel('2026-07')).toBe('Jul 2026');
    expect(monthLabel('2025-12')).toBe('Dec 2025');
  });

  it('returns a malformed month unchanged', () => {
    expect(monthLabel('2026-00')).toBe('2026-00');
    expect(monthLabel('nope')).toBe('nope');
  });
});
