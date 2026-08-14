/**
 * The client half of the ISO year-week vocabulary (Epic 60 O3).
 *
 * The API buckets assignments, completions, and carts on a canonical
 * `{year}-W{week}` string (Engineering Contract 7.3; see the API's
 * `Butler.Api.Domain.Scheduling.WeekIso`). The hub normally never computes one -
 * it reads the week off the C3 assignment set and echoes it back on a write.
 *
 * Offline it has to, for exactly one reason. A board served from the O2 read
 * cache carries the *cached* `weekIso`, and the API resolves a completion by
 * `(householdId, weekIso, choreId)` with no current-week check. If an outage
 * spans a week boundary, a tap on that cached row would queue - and then
 * successfully replay - a completion into last week: last week's chore goes
 * `Done` while this week's stays `Open`, silently. So before the queue will
 * accept a write from a cached board, the board's week is checked against this
 * helper, and a cached board whose week has rolled over stays the read-only
 * display O2 made it.
 *
 * It mirrors the API's semantics deliberately, because the two values are
 * compared for equality:
 * - the **ISO week-numbering year**, which is not always the calendar year at
 *   the December/January boundary (2021-01-01 is `2020-W53`; 2018-12-31 is
 *   `2019-W01`) - an off-by-one here mis-buckets a completion exactly as it
 *   would server-side;
 * - the **UTC** calendar date, so a hub in any timezone buckets an instant the
 *   same way the server does;
 * - a two-digit, zero-padded week (`W01`..`W53`).
 *
 * The instant is a parameter, never an ambient clock read inside the math, so
 * the week logic is reproducible in tests the same way the API's is.
 */

/** Milliseconds in a whole day - the ISO week arithmetic below counts in these. */
const MS_PER_DAY = 86_400_000;

/**
 * The ISO-8601 year-week string for `instant`, computed from its UTC calendar
 * date - for example `2026-W29`.
 *
 * The algorithm is the standard Thursday rule: an ISO week belongs to whichever
 * year owns its Thursday, so shifting the date to its own week's Thursday yields
 * the week-numbering year directly, and counting weeks from the Thursday of the
 * week containing January 4th (which is always ISO week 01) yields the number.
 */
export function weekIsoFor(instant: Date): string {
  // Strip the time of day: only the UTC calendar date decides the week.
  const thursday = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  // `getUTCDay()` is Sunday-first (0..6); ISO counts Monday..Sunday as 1..7.
  const isoDay = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoDay);

  // The week-numbering year is the year that owns this Thursday.
  const year = thursday.getUTCFullYear();

  // January 4th is by definition in ISO week 01, so its week's Thursday anchors
  // the count for the whole year.
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstIsoDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstIsoDay);

  // Both anchors are Thursdays at UTC midnight, so the gap is a whole number of
  // weeks and no DST/rounding subtlety can bleed in.
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));

  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

/**
 * The ISO year-week the hub is currently in. The clock is injectable so the
 * week-boundary guard can be tested without waiting for one.
 */
export function currentWeekIso(now: Date = new Date()): string {
  return weekIsoFor(now);
}

/**
 * Whether `weekIso` is still the week the hub is in. This is the guard on an
 * offline write taken from a cached board: `true` means a queued completion will
 * replay into the week it was meant for, `false` means the outage outlived the
 * week and the board must not be a control at all.
 */
export function isCurrentWeek(weekIso: string, now: Date = new Date()): boolean {
  return weekIso === currentWeekIso(now);
}
