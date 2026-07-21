using System.Globalization;

namespace Butler.Api.Domain.Scheduling;

/// <summary>
/// Deterministic ISO-8601 year-week helper. It turns an instant into the
/// canonical <c>{year}-W{week}</c> string (for example <c>2026-W29</c>) that the
/// chore assignment engine, completions ledger, and grocery carts all bucket on
/// (Engineering Contract 7.3). The value is computed from a <b>supplied</b>
/// <see cref="DateTimeOffset"/> - never <c>DateTime.Now</c> - so callers inject a
/// <see cref="TimeProvider"/> clock and the week math stays reproducible in tests.
/// </summary>
public static class WeekIso
{
    /// <summary>
    /// Returns the ISO-8601 year-week string for <paramref name="instant"/>,
    /// normalized to its UTC instant. Uses the ISO week-numbering year
    /// (<see cref="ISOWeek"/>), so a late-December date can belong to week 01 of
    /// the following year and an early-January date to week 52/53 of the prior
    /// year. The week is always two digits (<c>W01</c>..<c>W53</c>).
    /// </summary>
    /// <param name="instant">The instant to bucket; its offset is normalized to UTC first.</param>
    /// <returns>The year-week string, for example <c>2026-W29</c>.</returns>
    public static string For(DateTimeOffset instant)
    {
        // Normalize to the UTC calendar date so the same instant always maps to
        // the same week regardless of the offset it was expressed in.
        var utcDate = instant.UtcDateTime;

        // ISOWeek.GetYear is the week-numbering year, which is NOT always the
        // calendar year at the December/January boundary - that is the whole point.
        var year = ISOWeek.GetYear(utcDate);
        var week = ISOWeek.GetWeekOfYear(utcDate);

        return string.Create(
            CultureInfo.InvariantCulture,
            $"{year:D4}-W{week:D2}");
    }
}
