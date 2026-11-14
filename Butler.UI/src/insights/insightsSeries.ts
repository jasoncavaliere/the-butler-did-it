import type { InsightsMember } from '../api/models';
import { claimColors } from '../theme/theme';

/**
 * Pure helpers behind the organizer Insights screen (#123): colour resolution,
 * bar sizing and the axis labels. They read no clock and no locale, so the
 * labels are the same on every device (the API buckets in UTC).
 */

/** The window the Insights screen asks the API for, in ISO weeks. */
export const INSIGHTS_WEEKS = 8;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Each member's series colour, keyed by person id: their claim colour when they
 * have one, otherwise a token claim colour picked by their position (the dark
 * variant, since the hub shell is dark), so every series is still distinct.
 */
export function resolveMemberColors(members: readonly InsightsMember[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  members.forEach((member, index) => {
    resolved[member.personId] =
      member.claimColor ?? claimColors[index % claimColors.length].dark;
  });
  return resolved;
}

/** A bar's height as a fraction of the chart's tallest value, clamped to [0, 1]. */
export function barFraction(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / max));
}

/** A [0, 1] share as a whole percentage, for example `0.625` as `63%`. */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The short label for an ISO week: `2026-W29` is `W29`. */
export function weekLabel(weekIso: string): string {
  const separator = weekIso.indexOf('-');
  return separator === -1 ? weekIso : weekIso.slice(separator + 1);
}

/** The short label for a `yyyy-MM-dd` date: `2026-07-15` is `Jul 15`. */
export function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  const name = monthName(month);
  return name === undefined || day === undefined ? date : `${name} ${Number(day)}`;
}

/** The label for a `yyyy-MM` month: `2026-07` is `Jul 2026`. */
export function monthLabel(month: string): string {
  const [year, monthPart] = month.split('-');
  const name = monthName(monthPart);
  return name === undefined ? month : `${name} ${year}`;
}

function monthName(month: string | undefined): string | undefined {
  return MONTHS[Number(month) - 1];
}
