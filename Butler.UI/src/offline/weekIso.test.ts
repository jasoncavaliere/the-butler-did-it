import { currentWeekIso, isCurrentWeek, weekIsoFor } from './weekIso';

/**
 * These cases are deliberately the same ones the API's own `WeekIsoHelperTests`
 * pins down. The two implementations are compared for *equality* by the offline
 * write guard - the hub asks "is the week on this cached row still this week?" -
 * so an off-by-one on either side would either block a legitimate offline tap or,
 * far worse, wave a stale-week completion through into last week.
 */
describe('weekIsoFor', () => {
  const at = (iso: string) => new Date(iso);

  it.each([
    // The example spelled out in the C3/C4 acceptance criteria.
    ['the AC example', '2026-07-14T00:00:00.000Z', '2026-W29'],
    // A single-digit week is zero-padded to two digits.
    ['a single-digit week', '2026-01-05T12:00:00.000Z', '2026-W02'],
    // 2020 is an ISO 53-week year.
    ['a 53-week year', '2020-12-31T23:59:00.000Z', '2020-W53'],
    // The calendar year and the ISO week-numbering year differ here, both ways:
    ['early January in the prior week-numbering year', '2021-01-01T00:00:00.000Z', '2020-W53'],
    ['late December in the next week-numbering year', '2018-12-31T00:00:00.000Z', '2019-W01'],
    // Sunday is ISO day 7, not day 0 - the last day of its week, not the first.
    ['a Sunday, the last day of its ISO week', '2026-07-19T23:00:00.000Z', '2026-W29'],
    ['the Monday that opens the same week', '2026-07-13T00:00:00.000Z', '2026-W29'],
    // 2015-01-04 is itself a Sunday, so the week-01 anchor needs the same
    // Sunday-is-7 correction the date under test does.
    ['a year whose January 4th falls on a Sunday', '2015-01-05T00:00:00.000Z', '2015-W02'],
    ['the week that January 4th Sunday belongs to', '2015-01-04T00:00:00.000Z', '2015-W01'],
  ])('computes %s', (_label, instant, expected) => {
    expect(weekIsoFor(at(instant))).toBe(expected);
  });

  it('buckets on the UTC instant, not the local calendar date', () => {
    // 22:00 on 2018-12-30 in UTC-05:00 is 03:00 on 2018-12-31 UTC, which is ISO
    // week 01 of 2019 - the server buckets on the UTC date, so the hub must too
    // or a household in the Americas would compare weeks against a different one.
    expect(weekIsoFor(new Date('2018-12-30T22:00:00.000-05:00'))).toBe('2019-W01');
    // The same instant expressed two ways must bucket identically.
    expect(weekIsoFor(new Date('2026-07-14T02:00:00.000Z'))).toBe(
      weekIsoFor(new Date('2026-07-14T07:00:00.000+05:00')),
    );
  });

  it('is stable across every day of one ISO week', () => {
    // 2026-W29 runs Monday 2026-07-13 .. Sunday 2026-07-19; every day inside it
    // yields the same bucket, and the days either side do not.
    const week = [13, 14, 15, 16, 17, 18, 19].map((day) =>
      weekIsoFor(new Date(Date.UTC(2026, 6, day))),
    );

    expect(new Set(week)).toEqual(new Set(['2026-W29']));
    expect(weekIsoFor(new Date(Date.UTC(2026, 6, 12)))).toBe('2026-W28');
    expect(weekIsoFor(new Date(Date.UTC(2026, 6, 20)))).toBe('2026-W30');
  });
});

describe('currentWeekIso', () => {
  it('reads the supplied clock', () => {
    expect(currentWeekIso(new Date('2026-07-14T00:00:00.000Z'))).toBe('2026-W29');
  });

  it('falls back to the ambient clock, in the canonical shape', () => {
    // The guard runs with no clock argument in production, so the default has to
    // actually work; the value moves with the calendar, but its shape does not.
    expect(currentWeekIso()).toMatch(/^\d{4}-W\d{2}$/);
    expect(currentWeekIso()).toBe(weekIsoFor(new Date()));
  });
});

describe('isCurrentWeek', () => {
  const now = new Date('2026-07-14T00:00:00.000Z');

  it('accepts the week the hub is in, so an offline tap can be queued', () => {
    expect(isCurrentWeek('2026-W29', now)).toBe(true);
  });

  it.each([
    ['the week before - the outage spanned a boundary', '2026-W28'],
    ['a week far in the past', '2019-W01'],
    ['a week in the future', '2026-W30'],
    ['a value that is not a week at all', ''],
  ])('rejects %s', (_label, weekIso) => {
    expect(isCurrentWeek(weekIso, now)).toBe(false);
  });

  it('uses the ambient clock when none is supplied', () => {
    expect(isCurrentWeek(currentWeekIso())).toBe(true);
  });
});
