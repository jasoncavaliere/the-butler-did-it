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

    /// <summary>
    /// Parses a canonical <c>{year}-W{week}</c> string (as produced by
    /// <see cref="For"/>) back into the UTC instant at the start of that ISO week
    /// - Monday 00:00:00 UTC. This is the inverse anchor the assignment engine
    /// uses to bucket completions into a trailing week window and to derive a
    /// week's due date; like <see cref="For"/> it reads no ambient clock, so the
    /// math stays reproducible.
    /// </summary>
    /// <param name="weekIso">A year-week string, for example <c>2026-W29</c>.</param>
    /// <returns>The Monday of that ISO week at midnight UTC.</returns>
    /// <exception cref="FormatException">
    /// <paramref name="weekIso"/> is not a well-formed <c>{year}-W{week}</c>
    /// string, or names a week outside <c>01</c>..the year's last ISO week.
    /// </exception>
    public static DateTimeOffset StartOfWeekUtc(string weekIso)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);

        // Shape is exactly {4-digit year}-W{2-digit week}; anything else is a
        // client-supplied malformed value.
        var separator = weekIso.IndexOf("-W", StringComparison.Ordinal);
        if (separator != 4 || weekIso.Length != 8)
        {
            throw new FormatException(
                $"'{weekIso}' is not a valid ISO year-week string (expected '{{year}}-W{{week}}', for example '2026-W29').");
        }

        if (!int.TryParse(
                weekIso.AsSpan(0, 4),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var year) ||
            !int.TryParse(
                weekIso.AsSpan(6, 2),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var week))
        {
            throw new FormatException(
                $"'{weekIso}' is not a valid ISO year-week string (expected '{{year}}-W{{week}}', for example '2026-W29').");
        }

        if (week < 1 || week > ISOWeek.GetWeeksInYear(year))
        {
            throw new FormatException(
                $"'{weekIso}' names ISO week {week}, which is outside the valid range for {year}.");
        }

        // ISOWeek.ToDateTime yields a DateTime with Unspecified kind; the value is
        // the calendar date of that ISO week's Monday, which we pin to UTC.
        var monday = ISOWeek.ToDateTime(year, week, DayOfWeek.Monday);
        return new DateTimeOffset(monday, TimeSpan.Zero);
    }
}
