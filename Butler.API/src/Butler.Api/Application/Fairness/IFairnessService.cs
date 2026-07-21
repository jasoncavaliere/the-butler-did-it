namespace Butler.Api.Application.Fairness;

/// <summary>
/// Computes the household's contribution balance (C6, journey 6.3): a read-only
/// aggregate of completed <c>Effort</c> per person over a trailing ISO-week
/// window, and each person's share of the household total. It reads only the
/// household's <c>ChoreCompletions</c> partition (<c>PartitionKey = householdId</c>,
/// Engineering Contract 7.3) - there is no cross-household query - and introduces
/// no write path. Time arrives through the injected <see cref="TimeProvider"/>
/// seam so the trailing window stays deterministically testable (7.5).
/// </summary>
public interface IFairnessService
{
    /// <summary>
    /// Aggregates the household's completed effort over the trailing
    /// <paramref name="windowWeeks"/> ISO weeks (the current week from the injected
    /// clock and the weeks before it), returning each person's total and share.
    /// </summary>
    /// <remarks>
    /// The result is total-safe: a window with no completions returns a well-formed
    /// zero result (every share <c>0</c>, no top contributor) rather than failing.
    /// </remarks>
    /// <param name="householdId">The household whose balance to compute.</param>
    /// <param name="windowWeeks">The number of trailing ISO weeks to aggregate (must be at least 1).</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// The contribution balance, or <c>null</c> when no household with
    /// <paramref name="householdId"/> exists (the controller maps that to a <c>404</c>).
    /// </returns>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="windowWeeks"/> is less than 1.
    /// </exception>
    Task<FairnessResponse?> GetAsync(
        string householdId,
        int windowWeeks,
        CancellationToken cancellationToken = default);
}
