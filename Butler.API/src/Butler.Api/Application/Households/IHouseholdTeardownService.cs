namespace Butler.Api.Application.Households;

/// <summary>
/// Application service for tearing a household down (#124): deleting every row
/// it owns in every registered table, after the organizer confirms the name.
/// </summary>
public interface IHouseholdTeardownService
{
    /// <summary>
    /// Deletes every row in the household's partition of every registered table:
    /// it sweeps every other table, then deletes the <c>Households</c> row, then
    /// sweeps every other table again (#223). Nothing is deleted when the
    /// household does not exist or <paramref name="confirmName"/> is not an exact
    /// (ordinal, case-sensitive) match for its stored name.
    /// </summary>
    /// <param name="householdId">The household to tear down.</param>
    /// <param name="confirmName">The household name the organizer typed to confirm.</param>
    /// <param name="cancellationToken">Cancels the teardown.</param>
    /// <exception cref="HouseholdTeardownIncompleteException">
    /// The household purge or the second sweep failed, or was cancelled other than
    /// through <paramref name="cancellationToken"/>. The <c>Households</c> row has
    /// been restored, so a retry finishes the purge (#294).
    /// </exception>
    /// <exception cref="OperationCanceledException">
    /// <paramref name="cancellationToken"/> was cancelled. If that happened during
    /// the household purge or the second sweep, the <c>Households</c> row was
    /// restored first, so a retry finishes the purge (#336).
    /// </exception>
    /// <remarks>
    /// When the household purge or the second sweep fails and the restore of the
    /// <c>Households</c> row (its read or its write) then also fails, the restore
    /// exception propagates and the original failure is logged at Error first
    /// (#337). Other exceptions (argument validation, the initial read of the
    /// household, or the first sweep) propagate unchanged: nothing has been
    /// deleted from <c>Households</c> yet, so no restore is attempted and nothing
    /// is logged here.
    /// </remarks>
    Task<HouseholdTeardownResult> TeardownAsync(
        string householdId,
        string confirmName,
        CancellationToken cancellationToken = default);
}
