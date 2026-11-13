using Butler.Api.Domain.Scheduling;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (issue #86): <see cref="CompletionWeekWindow.Accepts"/> opens only the
/// current ISO week, plus the previous week while <c>now</c> is less than 24 hours
/// after the Monday 00:00 UTC rollover. Two weeks back, the previous week at or after
/// rollover + 24h, any future week, and a malformed value are all rejected. Instants
/// are fixed: 2026-W29 runs Mon 2026-07-13 to Sun 2026-07-19 and 2026-W30 starts
/// 2026-07-20T00:00Z.
/// </summary>
public sealed class CompletionWeekWindowTests
{
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Week30Rollover = new(2026, 7, 20, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Accepts_current_week()
    {
        Assert.True(CompletionWeekWindow.Accepts("2026-W29", MidWeek29));
    }

    [Fact]
    public void Accepts_current_week_at_the_rollover_instant()
    {
        Assert.True(CompletionWeekWindow.Accepts("2026-W30", Week30Rollover));
    }

    [Fact]
    public void Accepts_previous_week_at_the_rollover_instant()
    {
        Assert.True(CompletionWeekWindow.Accepts("2026-W29", Week30Rollover));
    }

    [Fact]
    public void Accepts_previous_week_one_second_before_grace_ends()
    {
        Assert.True(CompletionWeekWindow.Accepts("2026-W29", Week30Rollover.AddHours(24).AddSeconds(-1)));
    }

    [Fact]
    public void Rejects_previous_week_at_exactly_rollover_plus_24h()
    {
        Assert.False(CompletionWeekWindow.Accepts("2026-W29", Week30Rollover.AddHours(24)));
    }

    [Fact]
    public void Rejects_previous_week_mid_week()
    {
        Assert.False(CompletionWeekWindow.Accepts("2026-W28", MidWeek29));
    }

    [Fact]
    public void Rejects_two_weeks_back()
    {
        Assert.False(CompletionWeekWindow.Accepts("2026-W28", Week30Rollover));
        Assert.False(CompletionWeekWindow.Accepts("2026-W27", MidWeek29));
    }

    [Fact]
    public void Rejects_future_week()
    {
        Assert.False(CompletionWeekWindow.Accepts("2026-W30", MidWeek29));
        Assert.False(CompletionWeekWindow.Accepts("2026-W31", Week30Rollover));
    }

    [Fact]
    public void Accepts_previous_week_across_the_year_boundary()
    {
        // 2026 has 53 ISO weeks; 2027-W01 starts Monday 2027-01-04.
        var earlyW01 = new DateTimeOffset(2027, 1, 4, 10, 0, 0, TimeSpan.Zero);
        Assert.True(CompletionWeekWindow.Accepts("2027-W01", earlyW01));
        Assert.True(CompletionWeekWindow.Accepts("2026-W53", earlyW01));
        Assert.False(CompletionWeekWindow.Accepts("2026-W52", earlyW01));
    }

    [Fact]
    public void Rejects_previous_year_week_after_grace_across_the_year_boundary()
    {
        var afterGrace = new DateTimeOffset(2027, 1, 5, 0, 0, 0, TimeSpan.Zero);
        Assert.False(CompletionWeekWindow.Accepts("2026-W53", afterGrace));
        Assert.True(CompletionWeekWindow.Accepts("2027-W01", afterGrace));
    }

    [Fact]
    public void Normalizes_a_non_utc_offset()
    {
        // 2026-07-20T01:30+02:00 is 2026-07-19T23:30Z - still inside 2026-W29 in UTC,
        // so W29 is current and W30 is a future week.
        var local = new DateTimeOffset(2026, 7, 20, 1, 30, 0, TimeSpan.FromHours(2));
        Assert.True(CompletionWeekWindow.Accepts("2026-W29", local));
        Assert.False(CompletionWeekWindow.Accepts("2026-W30", local));

        // 2026-07-21T01:00+02:00 is 2026-07-20T23:00Z - inside W30's grace window.
        var insideGrace = new DateTimeOffset(2026, 7, 21, 1, 0, 0, TimeSpan.FromHours(2));
        Assert.True(CompletionWeekWindow.Accepts("2026-W29", insideGrace));
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("2026-w29")]
    [InlineData("2026-W99")]
    [InlineData(" ")]
    public void Rejects_malformed_week(string weekIso)
    {
        // Malformed values are compared, never parsed, so they are rejected rather
        // than throwing (which would surface as a 500).
        Assert.False(CompletionWeekWindow.Accepts(weekIso, MidWeek29));
        Assert.False(CompletionWeekWindow.Accepts(weekIso, Week30Rollover));
    }

    [Fact]
    public void Grace_period_is_24_hours()
    {
        Assert.Equal(TimeSpan.FromHours(24), CompletionWeekWindow.GracePeriod);
    }
}
