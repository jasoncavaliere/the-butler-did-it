namespace Butler.Api.Application.Assignments;

/// <summary>
/// Thrown when a chore completion or undo targets a week outside the accepted window
/// (the current ISO week, or the previous week within 24 hours of the Monday 00:00
/// UTC rollover; issue #86). The API maps it to <c>409</c> with the problem
/// extensions <c>reason</c>, <c>requestedWeekIso</c>, and <c>currentWeekIso</c>.
/// Use <see cref="ForWeeks"/> to carry both weeks.
/// </summary>
public sealed class WeekNotCurrentException : InvalidOperationException
{
    private const string DefaultMessage = "The week is not open for chore changes.";

    public WeekNotCurrentException()
        : base(DefaultMessage)
    {
    }

    public WeekNotCurrentException(string message)
        : base(message)
    {
    }

    public WeekNotCurrentException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    private WeekNotCurrentException(string message, string requestedWeekIso, string currentWeekIso)
        : base(message)
    {
        RequestedWeekIso = requestedWeekIso;
        CurrentWeekIso = currentWeekIso;
    }

    /// <summary>The ISO year-week the request targeted (empty when not supplied).</summary>
    public string RequestedWeekIso { get; } = string.Empty;

    /// <summary>The current ISO year-week at the time of the request (empty when not supplied).</summary>
    public string CurrentWeekIso { get; } = string.Empty;

    /// <summary>Creates the exception naming the requested week and the current week.</summary>
    /// <param name="requestedWeekIso">The week the request targeted.</param>
    /// <param name="currentWeekIso">The current week from the injected clock.</param>
    public static WeekNotCurrentException ForWeeks(string requestedWeekIso, string currentWeekIso) =>
        new(
            $"Week '{requestedWeekIso}' is not open for chore changes; the current week is '{currentWeekIso}'.",
            requestedWeekIso,
            currentWeekIso);
}
