namespace Butler.Api.Application.Fairness;

/// <summary>
/// The household's contribution balance over a trailing ISO-week window (C6,
/// journey 6.3). It is a read-only aggregate over the household's
/// <c>ChoreCompletions</c> ledger - the Section 10 fairness guardrail - carrying
/// the window it was computed over, the household's total completed effort, the
/// top contributor, and every person's completed effort and share of that total.
/// The share math is total-safe: with no completions in the window the total is
/// zero, every share is zero, and <see cref="TopContributorPersonId"/> is
/// <c>null</c> (never a divide-by-zero). Shares are ordered by effort descending,
/// then by <c>PersonId</c>, so the payload is deterministic.
/// </summary>
/// <param name="WindowStartWeekIso">The earliest ISO year-week in the window (for example <c>2026-W26</c>).</param>
/// <param name="WindowEndWeekIso">The latest (current) ISO year-week in the window (for example <c>2026-W29</c>).</param>
/// <param name="WindowWeeks">The number of trailing ISO weeks the window spans.</param>
/// <param name="TotalEffort">The household's total completed effort over the window.</param>
/// <param name="TopContributorPersonId">
/// The person with the greatest completed effort, or <c>null</c> when there were
/// no completions in the window.
/// </param>
/// <param name="Shares">Each person's completed effort and share, ordered by effort descending.</param>
public sealed record FairnessResponse(
    string WindowStartWeekIso,
    string WindowEndWeekIso,
    int WindowWeeks,
    int TotalEffort,
    string? TopContributorPersonId,
    IReadOnlyList<PersonShare> Shares);

/// <summary>
/// One person's slice of the household's contribution balance: their completed
/// effort over the window and that effort as a fraction (<see cref="Share"/>,
/// <c>0</c>..<c>1</c>) and percentage (<see cref="SharePercent"/>, <c>0</c>..<c>100</c>)
/// of the household total. Both are zero when the household total is zero.
/// </summary>
/// <param name="PersonId">The person the slice belongs to.</param>
/// <param name="DisplayName">The person's display name (falls back to the id when the person is no longer on the roster).</param>
/// <param name="TotalEffort">The person's completed effort over the window.</param>
/// <param name="Share">The person's share of the household total, as a fraction in <c>[0, 1]</c>.</param>
/// <param name="SharePercent">The person's share as a percentage in <c>[0, 100]</c>, rounded to one decimal.</param>
public sealed record PersonShare(
    string PersonId,
    string DisplayName,
    int TotalEffort,
    double Share,
    double SharePercent);
