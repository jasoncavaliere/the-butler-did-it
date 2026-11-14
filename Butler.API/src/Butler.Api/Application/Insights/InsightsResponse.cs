namespace Butler.Api.Application.Insights;

/// <summary>
/// The organizer's insights read model (#123): four time series over a trailing
/// ISO-week window anchored to the injected clock's current week. Every bucket is
/// in UTC, like <c>WeekIso</c> and the fairness view. Series are ordered oldest
/// first and zero-filled, so a quiet week, day or month still appears with a
/// zero value rather than being absent.
/// </summary>
/// <param name="WindowStartWeekIso">The earliest ISO year-week in the window (for example <c>2026-W27</c>).</param>
/// <param name="WindowEndWeekIso">The latest (current) ISO year-week in the window (for example <c>2026-W29</c>).</param>
/// <param name="WindowWeeks">The number of trailing ISO weeks the window spans.</param>
/// <param name="Members">
/// The people the per-person series cover: the non-organizer roster plus any
/// person on the completions ledger who has since left the roster, ordered by
/// display name then id.
/// </param>
/// <param name="Weeks">One entry per ISO week in the window, oldest first.</param>
/// <param name="GlancesPerDay">
/// Hub glances per UTC day from the window's first Monday through today, oldest
/// first, counted from the <c>Events</c> table (#122).
/// </param>
/// <param name="CartsConfirmedPerMonth">
/// Confirmed carts per UTC month from the window-start month through the current
/// month, oldest first.
/// </param>
public sealed record InsightsResponse(
    string WindowStartWeekIso,
    string WindowEndWeekIso,
    int WindowWeeks,
    IReadOnlyList<InsightsMember> Members,
    IReadOnlyList<WeeklyInsight> Weeks,
    IReadOnlyList<DailyCount> GlancesPerDay,
    IReadOnlyList<MonthlyCount> CartsConfirmedPerMonth);

/// <summary>A person the per-person insights series cover.</summary>
/// <param name="PersonId">The person's id.</param>
/// <param name="DisplayName">The person's display name (falls back to the id when the person is no longer on the roster).</param>
/// <param name="ClaimColor">The person's claim colour, or <c>null</c> when none is chosen (or the person left the roster).</param>
public sealed record InsightsMember(
    string PersonId,
    string DisplayName,
    string? ClaimColor);

/// <summary>
/// One ISO week of the insights window: the household's net completed effort,
/// the top contributor's share of it, and each member's net completion count.
/// </summary>
/// <param name="WeekIso">The ISO year-week (for example <c>2026-W29</c>).</param>
/// <param name="TotalEffort">The week's net completed effort across members (undo reversals subtract).</param>
/// <param name="TopContributorPersonId">
/// The member with the greatest effort that week (ties broken by id), or
/// <c>null</c> when the week's total is not positive.
/// </param>
/// <param name="TopContributorShare">
/// The top contributor's effort as a fraction of <see cref="TotalEffort"/>, in
/// <c>[0, 1]</c>; <c>0</c> when there is no top contributor.
/// </param>
/// <param name="Completions">Every member's net completion count for the week, in <c>Members</c> order.</param>
public sealed record WeeklyInsight(
    string WeekIso,
    int TotalEffort,
    string? TopContributorPersonId,
    double TopContributorShare,
    IReadOnlyList<MemberCompletions> Completions);

/// <summary>One member's net completion count for a week (an undone completion does not count).</summary>
/// <param name="PersonId">The member's id.</param>
/// <param name="Completions">The member's net completions that week, never below zero.</param>
public sealed record MemberCompletions(
    string PersonId,
    int Completions);

/// <summary>A count for one UTC calendar day.</summary>
/// <param name="Date">The UTC date, formatted <c>yyyy-MM-dd</c>.</param>
/// <param name="Count">The number of events that day.</param>
public sealed record DailyCount(
    string Date,
    int Count);

/// <summary>A count for one UTC calendar month.</summary>
/// <param name="Month">The UTC month, formatted <c>yyyy-MM</c>.</param>
/// <param name="Count">The number of items that month.</param>
public sealed record MonthlyCount(
    string Month,
    int Count);
