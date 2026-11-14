namespace Butler.Api.Application.Households;

/// <summary>
/// Application service for tearing a household down (#124): deleting every row
/// it owns in every registered table, after the organizer confirms the name.
/// </summary>
public interface IHouseholdTeardownService
{
    /// <summary>
    /// Deletes every row in the household's partition of every registered table,
    /// the <c>Households</c> row last. Nothing is deleted when the household does
    /// not exist or <paramref name="confirmName"/> is not an exact (ordinal,
    /// case-sensitive) match for its stored name.
    /// </summary>
    /// <param name="householdId">The household to tear down.</param>
    /// <param name="confirmName">The household name the organizer typed to confirm.</param>
    /// <param name="cancellationToken">Cancels the teardown.</param>
    Task<HouseholdTeardownResult> TeardownAsync(
        string householdId,
        string confirmName,
        CancellationToken cancellationToken = default);
}
