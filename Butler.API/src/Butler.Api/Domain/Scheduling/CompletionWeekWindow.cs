namespace Butler.Api.Domain.Scheduling;

/// <summary>
/// The week window a chore completion or undo may target (issue #86). A request is
/// accepted for the current ISO week, or for the immediately previous ISO week while
/// <c>now</c> is less than <see cref="GracePeriod"/> after the Monday 00:00 UTC
/// rollover. Every other week - two or more back, the previous week after the grace
/// window, or any future week - is rejected. The rule is pure: the caller supplies
/// <c>now</c> from its injected <see cref="TimeProvider"/>, and the requested week
/// string is never parsed, so a malformed value is simply rejected.
/// </summary>
public static class CompletionWeekWindow
{
    /// <summary>How long after the Monday 00:00 UTC rollover the previous week stays open.</summary>
    public static readonly TimeSpan GracePeriod = TimeSpan.FromHours(24);

    /// <summary>
    /// Returns <c>true</c> when <paramref name="weekIso"/> is open for chore changes at
    /// <paramref name="now"/>.
    /// </summary>
    /// <param name="weekIso">The requested ISO year-week (for example <c>2026-W29</c>).</param>
    /// <param name="now">The current instant, from the injected clock; normalized to UTC.</param>
    /// <returns><c>true</c> when the week is the current week or the previous week within grace.</returns>
    public static bool Accepts(string weekIso, DateTimeOffset now)
    {
        var current = WeekIso.For(now);
        if (string.Equals(weekIso, current, StringComparison.Ordinal))
        {
            return true;
        }

        // Only the current week string (always well-formed) is parsed; the requested
        // value is compared, never parsed, so it can never throw.
        var rollover = WeekIso.StartOfWeekUtc(current);
        if (now - rollover >= GracePeriod)
        {
            return false;
        }

        var previous = WeekIso.For(rollover.AddDays(-7));
        return string.Equals(weekIso, previous, StringComparison.Ordinal);
    }
}
