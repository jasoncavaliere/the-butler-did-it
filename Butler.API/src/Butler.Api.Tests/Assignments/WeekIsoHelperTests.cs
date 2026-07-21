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

    [Fact]
    public void StartOfWeekUtc_returns_the_monday_midnight_of_the_week()
    {
        // 2026-W29 runs Monday 2026-07-13 .. Sunday 2026-07-19.
        var monday = WeekIso.StartOfWeekUtc("2026-W29");

        Assert.Equal(new DateTimeOffset(2026, 7, 13, 0, 0, 0, TimeSpan.Zero), monday);
    }

    [Fact]
    public void StartOfWeekUtc_round_trips_with_For()
    {
        // The start-of-week instant must map back to the same week string.
        Assert.Equal("2026-W29", WeekIso.For(WeekIso.StartOfWeekUtc("2026-W29")));
        Assert.Equal("2020-W53", WeekIso.For(WeekIso.StartOfWeekUtc("2020-W53")));
        Assert.Equal("2019-W01", WeekIso.For(WeekIso.StartOfWeekUtc("2019-W01")));
    }

    [Fact]
    public void StartOfWeekUtc_resolves_week_01_across_the_year_boundary()
    {
        // ISO week 01 of 2019 begins Monday 2018-12-31.
        Assert.Equal(
            new DateTimeOffset(2018, 12, 31, 0, 0, 0, TimeSpan.Zero),
            WeekIso.StartOfWeekUtc("2019-W01"));
    }

    [Theory]
    [InlineData("2026-29")]        // missing the W separator
    [InlineData("2026W29")]        // missing the dash
    [InlineData("26-W29")]         // year is not four digits
    [InlineData("2026-W9")]        // week is not two digits
    [InlineData("2026-W299")]      // too long
    [InlineData("abcd-W29")]       // non-numeric year
    [InlineData("2026-Wzz")]       // non-numeric week
    public void StartOfWeekUtc_rejects_a_malformed_string(string weekIso)
    {
        Assert.Throws<FormatException>(() => WeekIso.StartOfWeekUtc(weekIso));
    }

    [Theory]
    [InlineData("2026-W00")]       // below the first week
    [InlineData("2026-W54")]       // beyond the maximum ISO week (53) any year can have
    [InlineData("2021-W53")]       // 2021 is a 52-week year, so W53 is invalid
    public void StartOfWeekUtc_rejects_a_week_outside_the_years_range(string weekIso)
    {
        Assert.Throws<FormatException>(() => WeekIso.StartOfWeekUtc(weekIso));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void StartOfWeekUtc_rejects_a_blank_string(string? weekIso)
    {
        Assert.ThrowsAny<ArgumentException>(() => WeekIso.StartOfWeekUtc(weekIso!));
    }
}
