/**
 * The client half of the ISO year-week vocabulary (Epic 60 O3).
 *
 * The API buckets assignments, completions, and carts on a canonical
 * `{year}-W{week}` string (Engineering Contract 7.3; see the API's
 * `Butler.Api.Domain.Scheduling.WeekIso`). The hub normally never computes one -
 * it reads the week off the C3 assignment set and echoes it back on a write.
 *
 * It has to, for exactly one reason. Any board carries the `weekIso` it was
 * loaded with - a cached one the *cached* week, a live one the week the server
 * named at load time - and the API resolves a completion by
 * `(householdId, weekIso, choreId)` with no current-week check. The wall tablet
 * is never reloaded, so a board can easily outlive its week, whether it came
 * from the O2 read cache after an outage or straight from the API on Sunday
 * night. A tap on such a row would write - or queue, and then successfully
 * replay - a completion into last week: last week's chore goes `Done` while
 * this week's stays `Open`, silently. So the board's week is checked against
 * this helper before any write is taken (#89), a board whose week has rolled
 * over is a read-only display until it reloads, and a queued write whose week
 * ended before it could sync is flagged rather than replayed at drain time.
 * {@link msUntilNextWeekIso} tells the board when that boundary is, so it can
 * redraw (and reload) at the moment the week turns rather than at the next tap.
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
 * Whether `weekIso` is still the week the hub is in. This is the guard on every
 * write taken from a board, live or cached, and on every queued assignment write
 * at the moment it is replayed: `true` means the completion lands in the week it
 * was meant for, `false` means the board (or the outage) outlived the week and
 * the write must not reach the API at all.
 */
export function isCurrentWeek(weekIso: string, now: Date = new Date()): boolean {
  return weekIso === currentWeekIso(now);
}

/**
 * Milliseconds from `now` until the next ISO week starts - the next Monday at
 * 00:00:00.000 UTC, the same instant the API's week flips.
 *
 * A board uses it to arm a single timer for the boundary, so a wall hub that is
 * never reloaded still notices the week turning without polling the clock. At
 * exactly Monday midnight it answers a whole week, never 0: that instant is
 * already the new week, and a zero delay would fire the timer in a tight loop.
 */
export function msUntilNextWeekIso(now: Date = new Date()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // `getUTCDay()` is Sunday-first (0..6); ISO counts Monday..Sunday as 1..7, so
  // the next Monday is 8 - isoDay days after today's midnight (7 on a Monday).
  const isoDay = now.getUTCDay() || 7;
  return midnight + (8 - isoDay) * MS_PER_DAY - now.getTime();
}
