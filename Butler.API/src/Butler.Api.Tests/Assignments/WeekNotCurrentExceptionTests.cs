using Butler.Api.Application.Assignments;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// <see cref="WeekNotCurrentException"/> carries the standard exception constructors
/// (CA1032) plus a <see cref="WeekNotCurrentException.ForWeeks"/> factory that names
/// the requested and current weeks for the 409 problem extensions (issue #86).
/// </summary>
public sealed class WeekNotCurrentExceptionTests
{
    [Fact]
    public void Default_message_is_populated()
    {
        var exception = new WeekNotCurrentException();

        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
        Assert.Equal(string.Empty, exception.RequestedWeekIso);
        Assert.Equal(string.Empty, exception.CurrentWeekIso);
    }

    [Fact]
    public void Carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new WeekNotCurrentException("custom").Message);

        var withInner = new WeekNotCurrentException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
        Assert.Equal(string.Empty, withInner.RequestedWeekIso);
    }

    [Fact]
    public void ForWeeks_carries_both_weeks()
    {
        var exception = WeekNotCurrentException.ForWeeks("2026-W27", "2026-W29");

        Assert.Equal("2026-W27", exception.RequestedWeekIso);
        Assert.Equal("2026-W29", exception.CurrentWeekIso);
        Assert.Contains("2026-W27", exception.Message, StringComparison.Ordinal);
        Assert.Contains("2026-W29", exception.Message, StringComparison.Ordinal);
    }
}
