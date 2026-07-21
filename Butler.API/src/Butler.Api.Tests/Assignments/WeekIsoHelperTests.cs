using Butler.Api.Domain.Scheduling;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criterion: <see cref="WeekIso"/> computes the ISO-8601 year-week string from a
/// supplied instant, using the ISO week-numbering year so the December/January
/// boundary is handled correctly. These cases are load-bearing - an off-by-one
/// here silently mis-buckets completions and breaks the fairness math (issue #20
/// risk note), so the year-boundary rows are the AC, not optional.
/// </summary>
public sealed class WeekIsoHelperTests
{
    [Fact]
    public void For_returns_the_year_week_for_the_ac_example()
    {
        // 2026-07-14 -> 2026-W29 (the example spelled out in the acceptance criteria).
        var instant = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal("2026-W29", WeekIso.For(instant));
    }

    [Fact]
    public void For_pads_a_single_digit_week_to_two_digits()
    {
        // 2026-01-05 is the Monday of ISO week 02 of 2026.
        var instant = new DateTimeOffset(2026, 1, 5, 12, 0, 0, TimeSpan.Zero);

        Assert.Equal("2026-W02", WeekIso.For(instant));
    }

    [Fact]
    public void For_yields_week_53_in_a_53_week_year()
    {
        // 2020 is an ISO 53-week year; 2020-12-31 (Thursday) is in week 53.
        var instant = new DateTimeOffset(2020, 12, 31, 23, 59, 0, TimeSpan.Zero);

        Assert.Equal("2020-W53", WeekIso.For(instant));
    }

    [Fact]
    public void For_maps_an_early_january_date_into_the_prior_week_numbering_year()
    {
        // 2021-01-01 (Friday) belongs to ISO week 53 of the 2020 week-numbering year,
        // NOT week 01 of 2021 - the calendar year and the ISO year differ here.
        var instant = new DateTimeOffset(2021, 1, 1, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal("2020-W53", WeekIso.For(instant));
    }

    [Fact]
    public void For_maps_a_late_december_date_into_the_next_week_numbering_year()
    {
        // 2018-12-31 (Monday) belongs to ISO week 01 of the 2019 week-numbering year.
        var instant = new DateTimeOffset(2018, 12, 31, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal("2019-W01", WeekIso.For(instant));
    }

    [Fact]
    public void For_normalizes_the_offset_to_the_utc_instant()
    {
        // The same instant expressed in UTC and in +05:00 must bucket identically.
        var utc = new DateTimeOffset(2026, 7, 14, 2, 0, 0, TimeSpan.Zero);
        var shifted = new DateTimeOffset(2026, 7, 14, 7, 0, 0, TimeSpan.FromHours(5));

        Assert.Equal(WeekIso.For(utc), WeekIso.For(shifted));
    }

    [Fact]
    public void For_uses_the_utc_calendar_date_when_the_offset_crosses_midnight()
    {
        // Local time is 2018-12-30 23:00-05:00, but the UTC instant is 2018-12-31 04:00,
        // which is ISO week 01 of 2019 - proving the helper buckets on the UTC date.
        var lateNightLocal = new DateTimeOffset(2018, 12, 30, 23, 0, 0, TimeSpan.FromHours(-5));

        Assert.Equal("2019-W01", WeekIso.For(lateNightLocal));
    }
}
